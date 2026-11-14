"""Fetch (once) and load the supported-range Sun/Earth topocentric series for every demonstration point.

Usage:  .venv/bin/python -m pipeline.ephemeris [--offline]
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass

from . import config, horizons
from .timeutil import horizons_time, parse_utc

TARGET_NAMES = {"sun": "Sun", "earth": "Earth"}


def derived_terrain_path(site_id: str):
    return config.REPO_ROOT / "data" / "derived" / "terrain" / f"{site_id}.json"


def surface_elevation_m(site_id: str) -> float | None:
    """DEM-derived surface height (m above the 1 737 400 m sphere), or None before the terrain stage."""
    p = derived_terrain_path(site_id)
    if not p.exists():
        return None
    return float(json.loads(p.read_text())["surfaceElevationM"])


def observer_altitude_m(site_id: str) -> float:
    h = surface_elevation_m(site_id)
    # Rounded to the millimetre that is actually sent to Horizons (km with 6 decimals).
    return round((h or 0.0) + config.OBSERVER_HEIGHT_M, 3)


@dataclass
class BodySeries:
    body: str
    params: dict[str, str]
    fetched: horizons.Fetched
    series: horizons.AzElSeries


def range_params(site: config.SiteSpec, body: str, alt_m: float) -> dict[str, str]:
    return horizons.observer_params(
        config.BODY_COMMANDS[body], site.lon_east_deg, site.lat_deg, alt_m,
        horizons_time(parse_utc(config.RANGE_START_UTC)), horizons_time(parse_utc(config.RANGE_END_UTC)),
        step=f"{config.STEP_SECONDS // 60} m")


def load_site(site: config.SiteSpec, offline: bool = False) -> dict[str, BodySeries]:
    alt_m = observer_altitude_m(site.id)
    out: dict[str, BodySeries] = {}
    for body in ("sun", "earth"):
        params = range_params(site, body, alt_m)
        f = horizons.fetch(f"{site.id}_{body}_range", params, offline=offline)
        s = horizons.parse_azel(f.text)
        horizons.check_observer_header(s.header, site.lon_east_deg, site.lat_deg, alt_m, TARGET_NAMES[body])
        out[body] = BodySeries(body, params, f, s)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--offline", action="store_true", help="fail instead of fetching if a cache is missing")
    ap.add_argument("--site", action="append", help="limit to these site ids")
    args = ap.parse_args()
    for site in config.SITES:
        if args.site and site.id not in args.site:
            continue
        data = load_site(site, offline=args.offline)
        for body, bs in data.items():
            print(f"{site.id} {body}: {len(bs.series.times)} rows, alt {observer_altitude_m(site.id)} m, "
                  f"cache {bs.fetched.path.relative_to(config.REPO_ROOT)}")


if __name__ == "__main__":
    main()
