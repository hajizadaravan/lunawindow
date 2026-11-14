"""Write web/public/data/manifest.json and web/public/data/sites/<id>.json from cached inputs only.

Usage:  .venv/bin/python -m pipeline.export
Never performs a network request (ephemeris is loaded with offline=True).
"""

from __future__ import annotations

import json
import math
import statistics
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import __version__, config, ephemeris
from .timeutil import parse_utc

GENERATOR = {"name": "lunawindow-pipeline", "version": __version__}

FRAME = "Moon ME (Horizons MEAN_ME; LOLA MOON_ME)"
FRAME_NOTE = (
    "Horizons reports the observer frame as 'MEAN_ME (high precision)' (ephemeris source DE441). "
    "The LOLA polar DEM is stated by its producer to be in the MOON_ME frame of JPL DE421. The residual "
    "difference between these two ME realisations was not quantified in this prototype; it is assumed "
    "(unchecked) to be small compared with the stated terrain-horizon uncertainty."
)

GEOMETRIC_HORIZON = {
    "kind": "geometric",
    "id": "geometric-reference",
    "label": "Geometric reference horizon (no terrain)",
    "elevationDeg": 0,
    "uncertaintyDeg": 0,
    "assumptions": [
        "Horizon is the local horizontal plane (elevation 0 deg) in every azimuth.",
        "No terrain, no horizon dip and no lunar-curvature dip are modelled.",
        "Body-centre direction only; a body whose centre is below 0 deg may still be partly above it.",
    ],
}

DISCLAIMERS = [
    "Exploratory educational prototype. Nothing here certifies landing safety, power availability or "
    "communication availability.",
    "Demo points A, B and C are demonstration coordinates chosen for this prototype. They are not NASA "
    "landing sites and are not approved, selected or recommended by NASA or anyone else.",
    "Visibility refers to the direction of the body centre only. Sun-centre visible does not mean power "
    "is available; Earth-centre visible does not mean a radio link is available.",
    "Gaps are reported within the selected analysis interval. A gap that touches the start or end of the "
    "interval may continue outside it.",
    "Limits entered by the user are user-defined tolerances, not computed battery or link budgets.",
    "Sun and Earth directions are JPL Horizons airless apparent topocentric azimuth/elevation of the body "
    "centre, sampled every 10 minutes and linearly interpolated between samples.",
    "The geometric reference horizon ignores terrain. The terrain horizon is derived from LOLA elevation "
    "data at finite resolution and carries the stated uncertainty; results near the horizon are flagged.",
    "Horizons UTC time tags after the last known leap second assume no further leap seconds.",
]


def _round_list(xs: list[float | None], nd: int) -> list[float | None]:
    out: list[float | None] = []
    for x in xs:
        if x is None or (isinstance(x, float) and math.isnan(x)):
            out.append(None)
        else:
            out.append(round(x, nd))
    return out


def _sources(terrain_used: bool, retrieved: str) -> list[dict[str, Any]]:
    src = [{
        "id": "jpl-horizons",
        "title": "JPL Horizons On-Line Ephemeris System (API v1.2), observer tables for a site on the Moon",
        "url": "https://ssd.jpl.nasa.gov/horizons/",
        "usedFor": "Sun (10) and Earth (399) airless apparent topocentric azimuth/elevation, angular diameter",
        "retrievedAtUtc": retrieved,
        "citation": "Giorgini, J.D. et al., JPL Solar System Dynamics Group, Horizons system; DE441 ephemeris",
        "sha256": None,
    }]
    info_path = config.REPO_ROOT / "data" / "derived" / "dem_info.json"
    if terrain_used and not info_path.exists():
        raise FileNotFoundError("terrain or map output present but data/derived/dem_info.json is missing")
    if terrain_used:
        info = json.loads(info_path.read_text())
        src.append({
            "id": "lola-ldem-80s-40mpp",
            "title": "LOLA south-pole DEM " + config.DEM_PRODUCT + " (A New View of the Lunar South Pole from LOLA)",
            "url": config.DEM_URL,
            "usedFor": "Surface elevation at the demonstration points, terrain horizon profiles, overview map",
            "retrievedAtUtc": info["retrievedAtUtc"],
            "citation": "Barker, M.K. et al. (2023), Planet. Sci. J. 4, 183, doi:10.3847/PSJ/acf3e1; "
                        "data doi:10.60903/gsfcpgda-lola-spole",
            "sha256": info["sha256"],
        })
    return src


def build_site(site: config.SiteSpec) -> dict[str, Any]:
    data = ephemeris.load_site(site, offline=True)
    terrain_path = ephemeris.derived_terrain_path(site.id)
    terrain = json.loads(terrain_path.read_text()) if terrain_path.exists() else None
    surface = terrain["surfaceElevationM"] if terrain else None
    alt_m = ephemeris.observer_altitude_m(site.id)

    start = parse_utc(config.RANGE_START_UTC)
    end = parse_utc(config.RANGE_END_UTC)
    count = int(round((end - start) / config.STEP_SECONDS)) + 1

    bodies: dict[str, Any] = {}
    for body, bs in data.items():
        s = bs.series
        expected = [start + i * config.STEP_SECONDS for i in range(count)]
        if s.times != expected:
            raise ValueError(f"{site.id} {body}: Horizons time tags are not the expected UTC grid")
        radii = [d / 2.0 / 3600.0 for d in s.ang_diam_arcsec if d is not None]
        bodies[body] = {
            "horizonsCommand": config.BODY_COMMANDS[body],
            "azDeg": [None if v is None else v % 360.0 for v in _round_list(s.az, 4)],
            "elDeg": _round_list(s.el, 4),
            "angularRadiusDeg": {"min": round(min(radii), 6), "mean": round(statistics.fmean(radii), 6),
                                 "max": round(max(radii), 6)},
            "rawFile": str(bs.fetched.path.relative_to(config.REPO_ROOT)),
            "rawSha256": bs.fetched.meta["sha256"],
        }

    query = {k: v for k, v in data["sun"].params.items() if k != "COMMAND"}
    if query != {k: v for k, v in data["earth"].params.items() if k != "COMMAND"}:
        raise ValueError("Sun and Earth queries differ beyond COMMAND")

    site_checks = terrain["siteChecks"] if terrain else [
        "No DEM check yet: surface elevation unknown, observer placed 2 m above the reference sphere."]

    return {
        "contractVersion": config.CONTRACT_VERSION,
        "synthetic": False,
        "site": {
            "id": site.id,
            "name": site.name,
            "locationHint": site.location_hint,
            "description": site.description,
            "latDeg": site.lat_deg,
            "lonEastDeg": site.lon_east_deg,
            "frame": FRAME,
            "frameNote": FRAME_NOTE,
            "referenceRadiusM": int(config.REFERENCE_RADIUS_M),
            "surfaceElevationM": None if surface is None else round(alt_m - config.OBSERVER_HEIGHT_M, 3),
            "observerHeightM": config.OBSERVER_HEIGHT_M,
            "observerAltitudeM": round(alt_m, 3),
            "siteChecks": site_checks,
        },
        "time": {"startUtc": config.RANGE_START_UTC, "stepSeconds": config.STEP_SECONDS, "count": count,
                 "scale": "UTC"},
        "ephemeris": {
            "sourceId": "jpl-horizons",
            "query": query,
            "retrievedAtUtc": data["sun"].fetched.meta["retrievedAtUtc"],
            "corrections": "Airless apparent topocentric direction of the body centre (Horizons quantity 4: "
                           "light-time, gravitational light deflection, stellar aberration; no refraction). "
                           "Azimuth clockwise from north through east; elevation above the plane "
                           "perpendicular to the local radial zenith of the 1737.4 km sphere.",
            "bodies": bodies,
        },
        "horizons": {
            "geometric": GEOMETRIC_HORIZON,
            "terrain": terrain["horizon"] if terrain else None,
        },
    }


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False, allow_nan=False) + "\n")


def main() -> None:
    sites_out = []
    datasets = {}
    for site in config.SITES:
        ds = build_site(site)
        datasets[site.id] = ds
        rel = f"sites/{site.id}.json"
        write_json(config.WEB_DATA_DIR / rel, ds)
        sites_out.append({
            "id": site.id,
            "name": site.name,
            "locationHint": site.location_hint,
            "latDeg": site.lat_deg,
            "lonEastDeg": site.lon_east_deg,
            "file": rel,
            "hasTerrainHorizon": ds["horizons"]["terrain"] is not None,
        })
    terrain_used = any(s["hasTerrainHorizon"] for s in sites_out)
    map_info_path = config.REPO_ROOT / "data" / "derived" / "map_info.json"
    map_info = None
    if map_info_path.exists():
        cand = json.loads(map_info_path.read_text())
        img = (config.WEB_DATA_DIR / cand["image"]).resolve()
        if config.WEB_DATA_DIR.resolve() not in img.parents:
            raise ValueError("map image path escapes the web data directory")
        if img.exists():
            map_info = cand
    retrieved = min(ds["ephemeris"]["retrievedAtUtc"] for ds in datasets.values())
    manifest = {
        "contractVersion": config.CONTRACT_VERSION,
        "synthetic": False,
        "generatedAtUtc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "generator": GENERATOR,
        "supportedRange": {"startUtc": config.RANGE_START_UTC, "endUtc": config.RANGE_END_UTC,
                           "stepSeconds": config.STEP_SECONDS},
        "defaults": {"siteId": config.SITES[0].id, "durationHours": config.DEFAULT_DURATION_HOURS,
                     "shiftHours": config.DEFAULT_SHIFT_HOURS},
        "sites": sites_out,
        "map": map_info,
        "sources": _sources(terrain_used or map_info is not None, retrieved),
        "disclaimers": DISCLAIMERS,
    }
    write_json(config.WEB_DATA_DIR / "manifest.json", manifest)
    # Remove stale site files for sites no longer configured.
    for p in (config.WEB_DATA_DIR / "sites").glob("*.json"):
        if p.stem not in datasets:
            p.unlink()
    print(f"wrote manifest + {len(datasets)} site file(s); terrain for "
          f"{[s['id'] for s in sites_out if s['hasTerrainHorizon']]}; map={'yes' if map_info else 'no'}")


if __name__ == "__main__":
    main()
