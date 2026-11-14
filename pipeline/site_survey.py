"""Survey candidate demonstration points on the DEM before committing to Horizons requests.

Usage:  .venv/bin/python -m pipeline.site_survey LAT,LON [LAT,LON ...]
Sun/Earth directions here are *derived* from the cached sub-solar/sub-Earth table (pipeline.crosscheck,
agreement with topocentric Horizons < 0.01 deg) so that many candidates can be screened offline; the
exported datasets always use true topocentric Horizons series for the final points.
"""

from __future__ import annotations

import sys

import numpy as np

from . import config, dem
from .analysis import analyze
from .crosscheck import AU_M, derived_azel, load_subpoints
from .terrain import compute_horizon
from .timeutil import iso_seconds


def survey(grid: dem.Grid, candidates: list[tuple[float, float]], az_step: float = 1.0) -> list[dict]:
    _, times, sub = load_subpoints(offline=True)
    hmax = float(np.nanmax(grid.data))
    time = {"startUtc": config.RANGE_START_UTC, "stepSeconds": config.STEP_SECONDS, "count": len(times),
            "scale": "UTC"}
    out = []
    for lat, lon in candidates:
        x, y = dem.xy_from_unit(dem.unit_from_latlon(lat, lon))
        h0 = float(grid.bilinear(x, y))
        if not np.isfinite(h0):
            out.append({"lat": lat, "lon": lon, "error": "outside coverage"})
            continue
        prof = compute_horizon(grid, lat, lon, az_step_deg=az_step, near_m=80.0, extent_m=300_000.0, hmax_m=hmax,
                               surface_m=h0)
        hz = {"kind": "terrain", "id": "terrain-lola", "azimuthStepDeg": az_step,
              "elevationDeg": prof.elevation_deg.tolist(), "uncertaintyDeg": 0.0}
        geo = {"kind": "geometric", "id": "geometric-reference", "elevationDeg": 0, "uncertaintyDeg": 0}
        alt = h0 + 2.0
        rec = {"lat": lat, "lon": lon, "h0": round(h0, 1), "horizonMin": float(np.nanmin(prof.elevation_deg)),
               "horizonMax": float(np.nanmax(prof.elevation_deg)), "covLimited": int(prof.coverage_limited.sum())}
        for body, (lo, la, dist) in {"sun": (sub[:, 2], sub[:, 3], np.full(len(times), AU_M)),
                                     "earth": (sub[:, 0], sub[:, 1], sub[:, 4] * AU_M)}.items():
            az, el = derived_azel(lat, lon, alt, la, lo, dist)
            tr = {"azDeg": az.tolist(), "elDeg": el.tolist(), "angularRadiusDeg": {"min": 0, "mean": 0, "max": 0}}
            dur = (len(times) - 1) * config.STEP_SECONDS / 3600
            for name, h in (("geo", geo), ("ter", hz)):
                r = analyze(time, tr, h, body, iso_seconds(times[0]), dur)
                li = r["longestInterruption"]
                rec[f"{body}_{name}_vis"] = round(r["visibleHours"] / dur, 3)
                rec[f"{body}_{name}_longest_h"] = round(li["durationHours"], 1) if li else 0.0
        out.append(rec)
        print(rec, flush=True)
    return out


def main() -> None:
    cands = [tuple(float(v) for v in a.split(",")) for a in sys.argv[1:]]
    survey(dem.load_grid(), cands)


if __name__ == "__main__":
    main()
