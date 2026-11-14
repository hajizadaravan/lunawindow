"""Independent ephemeris cross-check.

Derive Sun and Earth azimuth/elevation at each demonstration point from a *different* Horizons product —
the sub-Earth point (ObsSub-LON/LAT, quantity 14), sub-solar point (SunSub-LON/LAT, quantity 15) and
Earth-Moon range (quantity 20) of the Moon as seen from the geocentre, in the Moon's MOON_ME frame — with
our own vector geometry including the finite Earth distance, and compare with the topocentric az/el.

Usage:  .venv/bin/python -m pipeline.crosscheck [--offline]
"""

from __future__ import annotations

import argparse
import json

import numpy as np

from . import config, ephemeris, horizons
from .terrain import local_frame
from .timeutil import horizons_time, parse_utc

AU_M = 149_597_870_700.0


def subpoint_params() -> dict[str, str]:
    return {
        "format": "text",
        "COMMAND": "'301'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'500@399'",
        "START_TIME": f"'{horizons_time(parse_utc(config.RANGE_START_UTC))}'",
        "STOP_TIME": f"'{horizons_time(parse_utc(config.RANGE_END_UTC))}'",
        "STEP_SIZE": f"'{config.STEP_SECONDS // 60} m'",
        "QUANTITIES": "'14,15,20'",
        "CSV_FORMAT": "'YES'",
        "ANG_FORMAT": "'DEG'",
        "TIME_DIGITS": "'SECONDS'",
    }


def load_subpoints(offline: bool = False):
    f = horizons.fetch("moon_from_geocentre_subpoints", subpoint_params(), offline=offline)
    t = horizons.parse_table(f.text)
    if not t.header.get("Target pole/equ", "").startswith("MOON_ME"):
        raise ValueError(f"unexpected target frame {t.header.get('Target pole/equ')!r}")
    cols = t.columns
    want = ["Date__(UT)__HR:MN:SS", "", "", "ObsSub-LON", "ObsSub-LAT", "SunSub-LON", "SunSub-LAT", "delta",
            "deldot"]
    if cols != want:
        raise ValueError(f"unexpected columns {cols}")
    arr = np.array([[float(r[2]), float(r[3]), float(r[4]), float(r[5]), float(r[6])] for r in t.rows])
    return f, np.array(t.times), arr


def azel_from_vector(v, p0, north, east):
    vn = v @ north
    ve = v @ east
    vu = v @ p0
    az = np.degrees(np.arctan2(ve, vn)) % 360.0
    el = np.degrees(np.arctan2(vu, np.hypot(vn, ve)))
    return az, el


def derived_azel(lat, lon, alt_m, sub_lat, sub_lon, dist_m):
    p0, north, east = local_frame(lat, lon)
    sl, so = np.radians(sub_lat), np.radians(sub_lon)
    b = np.stack([np.cos(sl) * np.cos(so), np.cos(sl) * np.sin(so), np.sin(sl)], axis=-1)
    site = (config.REFERENCE_RADIUS_M + alt_m) * p0
    v = (dist_m[:, None] * b - site[None, :]) if dist_m is not None else b
    return azel_from_vector(v, p0, north, east)


def separation_deg(az1, el1, az2, el2):
    a1, e1, a2, e2 = (np.radians(x) for x in (az1, el1, az2, el2))
    c = np.sin(e1) * np.sin(e2) + np.cos(e1) * np.cos(e2) * np.cos(a1 - a2)
    return np.degrees(np.arccos(np.clip(c, -1, 1)))


def run(offline: bool = False) -> dict:
    f, times, sub = load_subpoints(offline)
    out = {"subpointRawFile": str(f.path.relative_to(config.REPO_ROOT)), "rawSha256": f.meta["sha256"],
           "method": __doc__.strip().splitlines()[2:6], "sites": {}}
    for site in config.SITES:
        data = ephemeris.load_site(site, offline=True)
        alt = ephemeris.observer_altitude_m(site.id)
        res = {}
        for body in ("earth", "sun"):
            s = data[body].series
            if not np.array_equal(np.array(s.times), times):
                raise ValueError("time grids differ")
            az_h = np.array(s.az, float)
            el_h = np.array(s.el, float)
            if body == "earth":
                sub_lon, sub_lat, dist = sub[:, 0], sub[:, 1], sub[:, 4] * AU_M
            else:
                # Sun range: topocentric delta (only enters via a ~0.0007 deg parallax term).
                sub_lon, sub_lat, dist = sub[:, 2], sub[:, 3], np.array(s.delta_au, float) * AU_M
            az_d, el_d = derived_azel(site.lat_deg, site.lon_east_deg, alt, sub_lat, sub_lon, dist)
            sep = separation_deg(az_h, el_h, az_d, el_d)
            daz = (az_d - az_h + 180) % 360 - 180
            # Controls: what the same comparison gives with a deliberate mistake.
            az_inf, el_inf = derived_azel(site.lat_deg, site.lon_east_deg, alt, sub_lat, sub_lon, None)
            az_w, el_w = derived_azel(site.lat_deg, -site.lon_east_deg % 360, alt, sub_lat, sub_lon, dist)
            az_ccw = (360.0 - az_d) % 360.0
            res[body] = {
                "n": int(len(times)),
                "maxSeparationDeg": float(sep.max()),
                "rmsSeparationDeg": float(np.sqrt(np.mean(sep ** 2))),
                "maxAbsDeltaElDeg": float(np.abs(el_d - el_h).max()),
                "meanDeltaElDeg": float(np.mean(el_d - el_h)),
                "maxAbsDeltaAzTimesCosElDeg": float(np.abs(daz * np.cos(np.radians(el_h))).max()),
                "controlNoParallaxMaxSeparationDeg": float(separation_deg(az_h, el_h, az_inf, el_inf).max()),
                "controlWestLongitudeMaxSeparationDeg": float(separation_deg(az_h, el_h, az_w, el_w).max()),
                "controlCounterClockwiseAzimuthMaxSeparationDeg": float(
                    separation_deg(az_h, el_h, az_ccw, el_d).max()),
            }
        out["sites"][site.id] = res
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--offline", action="store_true")
    args = ap.parse_args()
    out = run(args.offline)
    p = config.REPO_ROOT / "data" / "derived" / "crosscheck.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(out, indent=2) + "\n")
    print(json.dumps(out["sites"], indent=1))


if __name__ == "__main__":
    main()
