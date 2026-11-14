"""Generate fixtures/analysis-golden.json (contract section 5).

Usage:  .venv/bin/python -m pipeline.golden
Inline cases use a 1-hour grid and margins chosen so that crossings fall on exact binary fractions of an
hour; site cases reference the exported datasets under web/public/data/sites/ by repo-relative path.
"""

from __future__ import annotations

import json
from typing import Any

from . import __version__, config
from .analysis import GENERATED_BY, analyze
from .export import GEOMETRIC_HORIZON, write_json

START = "2027-01-01T00:00:00Z"
STEP = 3600
ANG = {"min": 0.25, "mean": 0.26, "max": 0.27}
GEO = {k: GEOMETRIC_HORIZON[k] for k in ("kind", "id", "label", "elevationDeg", "uncertaintyDeg", "assumptions")}


def _time(n: int) -> dict[str, Any]:
    return {"startUtc": START, "stepSeconds": STEP, "count": n, "scale": "UTC"}


def _inline(name: str, el: list[float | None], *, az: list[float | None] | None = None, horizon=None,
            window: str = START, duration: float | None = None, limit: float | None = None,
            body: str = "sun", ang=None) -> dict[str, Any]:
    n = len(el)
    az = az if az is not None else [180.0] * n
    track = {"azDeg": az, "elDeg": el, "angularRadiusDeg": ang or ANG}
    horizon = horizon or GEO
    time = _time(n)
    duration = duration if duration is not None else (n - 1) * STEP / 3600
    expected = analyze(time, track, horizon, body, window, duration, limit)
    return {
        "name": name,
        "input": {"kind": "inline", "time": time, "track": track, "horizon": horizon},
        "body": body,
        "windowStartUtc": window,
        "durationHours": duration,
        "limitHours": limit,
        "expected": expected,
    }


def inline_cases() -> list[dict[str, Any]]:
    cases = []
    cases.append(_inline("always visible", [5.0] * 25, limit=1.0))
    cases.append(_inline("always blocked (truncated at both ends)", [-5.0] * 25, limit=48.0))
    # Interior gap: crossings at 02:30 and 05:30 -> exactly 3 h blocked. Near-horizon samples (|m|<0.27).
    interior = [2.0, 2.0, 1.0, -1.0, -1.0, -1.0, 1.0, 0.2] + [2.0] * 17
    cases.append(_inline("one interior gap, limit 2 h exceeded", interior, limit=2.0))
    cases.append(_inline("gap touching window start", [-3.0, -1.0, -1.0, 1.0] + [2.0] * 21, limit=10.0))
    cases.append(_inline("gap touching window end", [2.0] * 21 + [1.0, -1.0, -3.0, -3.0], limit=10.0))
    split = [2.0, 1.0, -1.0, -1.0, None, -1.0, -1.0, 1.0] + [2.0] * 17
    cases.append(_inline("missing sample splits a gap", split, limit=10.0))
    cases.append(_inline("missing azimuth only (elevation present)",
                         [2.0, 1.0, -1.0, -1.0, -1.0, 1.0] + [2.0] * 19,
                         az=[180.0, 180.0, 180.0, None, 180.0, 180.0] + [180.0] * 19, limit=10.0))
    # Terrain ridge across azimuth 0/360: bins every 10 deg, 8 deg at 0, 4 deg at 350, 0 elsewhere.
    ridge = [0.0] * 36
    ridge[0] = 8.0
    ridge[35] = 4.0
    terrain = {"kind": "terrain", "id": "terrain-lola", "azimuthStepDeg": 10.0, "elevationDeg": ridge,
               "uncertaintyDeg": 0.5}
    az_sweep = [(330.0 + 5.0 * i) % 360.0 for i in range(25)]  # 330 ... 355, 0, 5, ... 90
    cases.append(_inline("terrain ridge with azimuth wrap-around", [3.0] * 25, az=az_sweep, horizon=terrain,
                         limit=3.0))
    cases.append(_inline("exact-zero margin (single zero sample, then a run of zeros)",
                         [1.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0] + [1.0] * 18, limit=0.5))
    cases.append(_inline("limit exactly equal to the longest gap (strict >, within)", interior, limit=3.0))
    # +24 h shift: 49-sample track, base window 0-24 h, shifted window 24-48 h.
    two_day = interior + [2.0, 2.0, 1.0, -1.0, -1.0, -1.0, -1.0, -1.0, 1.0] + [2.0] * 15  # 5 h gap 27.5-32.5 h
    assert len(two_day) == 49
    cases.append(_inline("two-day track, base window (0-24 h)", two_day, duration=24.0, limit=4.0))
    cases.append(_inline("two-day track, window shifted +24 h", two_day, window="2027-01-02T00:00:00Z",
                         duration=24.0, limit=4.0))
    cases.append(_inline("earth body, flat terrain horizon, non-binary crossing times, wide near-horizon band",
                         [0.5, 0.2, -0.3, -0.6, -0.3, 0.2, 0.5] + [0.5] * 18, body="earth",
                         horizon={"kind": "terrain", "id": "terrain-lola", "azimuthStepDeg": 90.0,
                                  "elevationDeg": [0.0, 0.0, 0.0, 0.0], "uncertaintyDeg": 0.1},
                         ang={"min": 0.9, "mean": 0.95, "max": 1.0}, limit=1.0))
    # Precedence and edge rules a port could otherwise get wrong.
    cases.append(_inline("status precedence: truncated beats missing data",
                         [-1.0, -1.0, 1.0, None, 1.0] + [2.0] * 20, limit=10.0))
    cases.append(_inline("status precedence: exceeded beats truncated and missing data",
                         [-1.0] * 5 + [1.0, None, 1.0] + [2.0] * 17, limit=2.0))
    cases.append(_inline("null sample breaks a near-horizon run",
                         [0.1, None, 0.1, 0.2, 2.0] + [2.0] * 20, limit=None))
    cases.append(_inline("near-horizon run clipped at a window start that is not sample 0",
                         [0.1, 0.1, 0.1, 0.1, 2.0] + [2.0] * 20, window="2027-01-01T02:00:00Z", duration=20.0))
    cases.append(_inline("zero margin at the first and last window samples",
                         [0.0, 1.0] + [1.0] * 21 + [1.0, 0.0], limit=0.0))
    cases.append(_inline("zero-margin runs at both window edges are truncated blocked intervals",
                         [0.0, 0.0, 1.0] + [1.0] * 19 + [1.0, 0.0, 0.0], limit=5.0))
    return cases


SITE_WINDOWS = [
    ("2027-01-08T00:00:00Z", 168.0, 24.0),
    ("2027-01-09T00:00:00Z", 168.0, 24.0),  # +24 h shift of the above
]


def site_cases() -> list[dict[str, Any]]:
    cases = []
    for site in config.SITES:
        rel = f"web/public/data/sites/{site.id}.json"
        path = config.REPO_ROOT / rel
        if not path.exists():
            continue
        ds = json.loads(path.read_text())
        horizons = [("geometric-reference", ds["horizons"]["geometric"])]
        if ds["horizons"]["terrain"] is not None:
            horizons.append(("terrain-lola", ds["horizons"]["terrain"]))
        for hid, hz in horizons:
            for body in ("sun", "earth"):
                track = ds["ephemeris"]["bodies"][body]
                for win, dur, lim in SITE_WINDOWS:
                    cases.append({
                        "name": f"site {site.id} {body} {hid} {win[:10]} {int(dur)} h",
                        "input": {"kind": "site", "siteFile": rel, "horizonId": hid},
                        "body": body,
                        "windowStartUtc": win,
                        "durationHours": dur,
                        "limitHours": lim,
                        "expected": analyze(ds["time"], track, hz, body, win, dur, lim),
                    })
    return cases


def build() -> dict[str, Any]:
    return {
        "contractVersion": config.CONTRACT_VERSION,
        "generatedBy": f"{GENERATED_BY} (lunawindow-pipeline {__version__})",
        "toleranceHours": 1e-6,
        "cases": inline_cases() + site_cases(),
    }


def main() -> None:
    g = build()
    write_json(config.FIXTURES_DIR / "analysis-golden.json", g)
    print(f"wrote {len(g['cases'])} golden cases")


if __name__ == "__main__":
    main()
