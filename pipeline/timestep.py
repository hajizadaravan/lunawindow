"""Time-step sensitivity: 10-minute + linear interpolation vs a 1-minute Horizons series.

Usage:  .venv/bin/python -m pipeline.timestep [--site demo-a] [--offline]
Picks the 3-day span (on whole days) of the supported range with the most Sun+Earth transitions for the
site's horizons, fetches 1-minute topocentric series for it (cached), and compares transition times.
"""

from __future__ import annotations

import argparse
import json

import numpy as np

from . import config, ephemeris, horizons
from .analysis import analyze
from .timeutil import horizons_time, iso_seconds, parse_utc

SPAN_DAYS = 3


def _transitions(result) -> list[float]:
    out = []
    for a, b in zip(result["intervals"], result["intervals"][1:]):
        if {a["state"], b["state"]} == {"visible", "blocked"}:
            out.append(parse_utc(a["endUtc"]))
    return out


def _uncertainty_shift_hours(ds, body, hz, transitions) -> list[float]:
    from .analysis import horizon_lookup
    unc = float(hz["uncertaintyDeg"])
    if unc == 0:
        return []
    H = horizon_lookup(hz)
    tr = ds["ephemeris"]["bodies"][body]
    t0 = parse_utc(ds["time"]["startUtc"])
    step = ds["time"]["stepSeconds"]
    out = []
    def m(i):
        return tr["elDeg"][i] - H(tr["azDeg"][i])

    for t in transitions:
        base = int((t - t0) // step)
        # ms-rounded crossing times can land just across a grid line: pick the neighbouring segment whose
        # margin actually changes state.
        cands = [i for i in (base, base - 1, base + 1) if 0 <= i < len(tr["elDeg"]) - 1
                 and (m(i) > 0) != (m(i + 1) > 0)]
        if not cands:
            out.append(None)
            continue
        i = cands[0]
        rate = abs(m(i + 1) - m(i)) / step                    # deg per second
        out.append(round(unc / rate / 3600.0, 3) if rate > 0 else None)
    return out


def run(site_id: str, offline: bool = False) -> dict:
    site = config.site_by_id(site_id)
    ds = json.loads((config.WEB_DATA_DIR / "sites" / f"{site_id}.json").read_text())
    hzs = [ds["horizons"]["geometric"]] + ([ds["horizons"]["terrain"]] if ds["horizons"]["terrain"] else [])
    t0 = parse_utc(ds["time"]["startUtc"])
    step = ds["time"]["stepSeconds"]
    n = ds["time"]["count"]
    full_h = (n - 1) * step / 3600
    # Count transitions per day across both bodies and horizons, choose the best SPAN_DAYS window.
    trans_all = []
    for body in ("sun", "earth"):
        for hz in hzs:
            r = analyze(ds["time"], ds["ephemeris"]["bodies"][body], hz, body, ds["time"]["startUtc"], full_h)
            trans_all += _transitions(r)
    days = int(full_h // 24)
    counts = np.zeros(days)
    for t in trans_all:
        counts[min(days - 1, int((t - t0) // 86400))] += 1
    best = int(np.argmax([counts[i:i + SPAN_DAYS].sum() for i in range(days - SPAN_DAYS + 1)]))
    ws = t0 + best * 86400
    we = ws + SPAN_DAYS * 86400
    alt = ds["site"]["observerAltitudeM"]
    time1 = {"startUtc": iso_seconds(ws), "stepSeconds": 60, "count": SPAN_DAYS * 1440 + 1, "scale": "UTC"}
    out = {"siteId": site_id, "windowStartUtc": iso_seconds(ws), "windowEndUtc": iso_seconds(we), "bodies": {}}
    max_dt = 0.0
    for body in ("sun", "earth"):
        params = horizons.observer_params(config.BODY_COMMANDS[body], site.lon_east_deg, site.lat_deg, alt,
                                          horizons_time(ws), horizons_time(we), step="1 m")
        f = horizons.fetch(f"{site_id}_{body}_1min_{iso_seconds(ws)[:10]}", params, offline=offline)
        s = horizons.parse_azel(f.text)
        horizons.check_observer_header(s.header, site.lon_east_deg, site.lat_deg, alt,
                                       {"sun": "Sun", "earth": "Earth"}[body])
        if not (s.times[0] == ws and len(s.times) == time1["count"] and np.all(np.diff(s.times) == 60)):
            raise ValueError("1-minute Horizons series is not on the expected grid")
        tr1 = {"azDeg": [None if v is None else round(v, 4) for v in s.az],
               "elDeg": [None if v is None else round(v, 4) for v in s.el],
               "angularRadiusDeg": ds["ephemeris"]["bodies"][body]["angularRadiusDeg"]}
        # Direct interpolation error of elevation at the 1-minute points.
        i0 = int((ws - t0) // step)
        el10 = np.array(ds["ephemeris"]["bodies"][body]["elDeg"][i0:i0 + SPAN_DAYS * 144 + 1], float)
        t10 = np.arange(el10.size) * step
        el_i = np.interp(np.arange(time1["count"]) * 60.0, t10, el10)
        el_err = float(np.max(np.abs(el_i - np.array(tr1["elDeg"], float))))
        bres = {"rawFile": str(f.path.relative_to(config.REPO_ROOT)), "maxElevationInterpErrorDeg": el_err,
                "horizons": {}}
        for hz in hzs:
            r10 = analyze(ds["time"], ds["ephemeris"]["bodies"][body], hz, body, iso_seconds(ws), SPAN_DAYS * 24)
            r1 = analyze(time1, tr1, hz, body, iso_seconds(ws), SPAN_DAYS * 24)
            a, b = _transitions(r10), _transitions(r1)
            diffs = [min(abs(x - y) for y in b) for x in a] if b else []
            unmatched = abs(len(a) - len(b))
            md = max(diffs) if diffs else 0.0
            max_dt = max(max_dt, md)
            # How far each transition would move if the horizon were shifted by its stated uncertainty.
            shifts = _uncertainty_shift_hours(ds, body, hz, a)
            bres["horizons"][hz["id"]] = {
                                          "transitionShiftPerUncertaintyHours": shifts,"transitions10min": len(a), "transitions1min": len(b),
                                          "countMismatch": unmatched, "maxTransitionDiffSeconds": md,
                                          "meanTransitionDiffSeconds": float(np.mean(diffs)) if diffs else 0.0}
        out["bodies"][body] = bres
    out["maxTransitionDiffSeconds"] = max_dt
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--site", default=config.SITES[0].id)
    ap.add_argument("--offline", action="store_true")
    args = ap.parse_args()
    out = run(args.site, args.offline)
    p = config.REPO_ROOT / "data" / "derived" / f"timestep_{args.site}.json"
    p.write_text(json.dumps(out, indent=2) + "\n")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
