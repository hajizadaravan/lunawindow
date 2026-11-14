# LunaWindow data pipeline

Python reference pipeline in `pipeline/` that turns cached NASA data into the files the web app reads
(`web/public/data/`) and the cross-language analysis fixture (`fixtures/analysis-golden.json`).
The normative shapes and the analysis algorithm are in `docs/data-contract.md`; verification results are in
`docs/verification-data.md`.

## Reproduce from an empty checkout

All commands run from the repository root.

```sh
# 1. Environment (Python 3.15 was used; only pure-pip wheels, no GDAL)
python3 -m venv .venv
.venv/bin/pip install -r pipeline/requirements.txt

# 2. Rasters (git-ignored, ~1.0 GB total). Expected sha256 below, pinned in pipeline/config.py RASTER_SHA256.
#    pipeline.dem.verify_raster runs on every load (terrain build, map render, site survey, tests) and refuses
#    a file whose hash differs or that has no pinned hash, including the committed PDS label.
mkdir -p data/dem
curl -f -C - -o data/dem/LDEM_80S_40MPP_ADJ.TIF     https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_40MPP_ADJ.TIF
curl -f -C - -o data/dem/LDEM_80S_80MPP_ADJ_ERR.TIF https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ_ERR.TIF
curl -f -C - -o data/dem/LDEM_75S_240M.IMG          https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/LDEM_75S_240M.IMG
shasum -a 256 data/dem/*
# b7f3567bfa405dbcb42f867f6cd3c9932ca9752b4363ce1eef835f9115c1dd76  LDEM_80S_40MPP_ADJ.TIF      (716 299 920 B)
# e89306914bb209143f61ba66d341703d75221339424b774c6a1eb3c6c370ffc6  LDEM_80S_80MPP_ADJ_ERR.TIF  (254 808 965 B)
# d031efe2611b17dfbf3c158f5e15dc04cd5719349dcbf6384bb21fd97697c490  LDEM_75S_240M.IMG           (29 062 688 B)
# The PDS label is committed at data/raw/lola_pds/LDEM_75S_240M.LBL
# (https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/LDEM_75S_240M.LBL, sha256 ec07239f...0422e02).

# 3. Terrain: surface heights, horizon profiles, site checks -> data/derived/terrain/<site>.json
.venv/bin/python -m pipeline.build_terrain

# 4. Ephemeris: Sun/Earth topocentric series at the DEM-derived observer altitude (cached; serialised,
#    2 s pause between live requests, a cached response is never re-fetched)
.venv/bin/python -m pipeline.ephemeris
.venv/bin/python -m pipeline.crosscheck          # independent sub-point cross-check (1 cached request)

# 5. Overview map -> web/public/data/map/south-pole-hillshade.png + data/derived/map_info.json
.venv/bin/python -m pipeline.maprender

# 6. Export (offline: never touches the network) and golden fixture
.venv/bin/python -m pipeline.export
.venv/bin/python -m pipeline.golden

# 7. Time-step sensitivity (fetches and caches 1-minute series once per site)
.venv/bin/python -m pipeline.timestep --site demo-a
.venv/bin/python -m pipeline.timestep --site demo-b
.venv/bin/python -m pipeline.timestep --site demo-c

# 8. Tests (DEM tests are skipped when data/dem/ is empty)
.venv/bin/python -m pytest -q pipeline/tests
```

Everything needed by the web app and by steps 4–8 is committed (`data/raw/`, `data/derived/`), so with a
fresh checkout `pipeline.ephemeris --offline`, `pipeline.crosscheck --offline`, export, golden,
`pipeline.timestep --site <id> --offline` and the tests run without network access and without the DEM
(the DEM tests are then skipped). Only steps 2, 3 and 5 need the rasters. Cached Horizons responses are
checked against the sha256 and parameters in their `.meta.json` on every use.

Survey tool used to choose the demonstration points (screens candidates offline from the DEM and the cached
sub-point table): `.venv/bin/python -m pipeline.site_survey LAT,LON [LAT,LON ...]`.

## 3D terrain display assets

The 3D view's display meshes (`web/public/data/terrain3d/<siteId>.glb` and `.json`, contract section 6) and the
skyline comparison are made by two modules. Neither touches the visibility data or the network.

```sh
# a. Display meshes. Needs the 40 m raster from step 2 (verified by pipeline.dem.verify_raster before any read).
#    Refuses a site whose surface height differs from web/public/data/sites/<id>.json by more than 0.01 m.
#    Writes web/public/data/terrain3d/<id>.glb + <id>.json and data/derived/terrain3d-verification.json.
.venv/bin/python -m pipeline.export_terrain3d

# b. Skyline check: the display mesh's skyline from the 2 m mast minus the analysis terrain horizon, per
#    azimuth bin. Reads only the committed GLBs and site files (no DEM, no network); deterministic.
#    Writes data/derived/terrain3d-skyline.json, and web/public/data/terrain3d/<id>.skyline.json (the drawn
#    surface's skyline, bound to the GLB sha256). Rerun after every export_terrain3d: the 3D view refuses a
#    skyline whose GLB hash does not match.
.venv/bin/python -m pipeline.terrain3d_skyline

# c. Tests (pipeline/tests/test_terrain3d.py, test_terrain3d_skyline.py) run with step 8.
```

**Regenerate together.** Each `.json` holds its GLB's byte length and sha256, and the web app refuses a GLB that
does not match. Always regenerate and commit the GLB and its `.json` together, then rerun step b. On 2026-11-14,
re-running `pipeline.export_terrain3d` once with a different numpy build reproduced the vertices to within 9e-12 m
but not byte for byte, so the GLB hashes changed. That was a single observation, not a repeatable check: do not
expect identical bytes across environments.

## Modules

| Module | Purpose |
|---|---|
| `config.py` | Fixed decisions: range, step, observer height, sites, product names/URLs |
| `horizons.py` | Horizons request builder, cache (`data/raw/horizons/<label>__<hash>.txt` + `.meta.json`), parser, header checks |
| `ephemeris.py` | Range series per site/body at `observerAltitudeM` |
| `analysis.py` | Reference implementation of contract section 4 |
| `dem.py` | GeoTIFF metadata validation, polar-stereographic projection, bilinear sampling, PDS GDR reader |
| `terrain.py` | 3-D ray-marched terrain horizon on the sphere |
| `build_terrain.py` | Per-site surface height, horizon, uncertainty, site checks |
| `crosscheck.py` | Independent Sun/Earth az/el from sub-point products |
| `timestep.py` | 10-minute vs 1-minute transition comparison |
| `maprender.py` | Hillshade overview + exact map extents |
| `export.py`, `golden.py` | Write `web/public/data/**` and `fixtures/analysis-golden.json` |
| `export_terrain3d.py` | 3D display meshes `web/public/data/terrain3d/<id>.glb` + `.json` (display only) |
| `terrain3d_skyline.py` | Display-mesh skyline vs analysis terrain horizon -> `data/derived/terrain3d-skyline.json`, `web/public/data/terrain3d/<id>.skyline.json` |

## Data sources

| What | URL | Notes |
|---|---|---|
| JPL Horizons API | https://ssd.jpl.nasa.gov/api/horizons.api | Observer tables, `CENTER='coord@301'`, `COORD_TYPE='GEODETIC'`, quantities 4,13,20; DE441 |
| LOLA south-pole DEM 40 m | https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_40MPP_ADJ.TIF | PGDA product 90, Barker et al. 2023 (doi:10.3847/PSJ/acf3e1), data doi:10.60903/gsfcpgda-lola-spole |
| LOLA height-error map 80 m | https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ_ERR.TIF | Used only for the `uncertaintyDeg` estimate |
| PDS LOLA polar GDR 240 m | https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/LDEM_75S_240M.IMG (+ `.LBL`, cached in `data/raw/lola_pds/`) | Independent check of height reference and registration |

## Assumptions (all of them)

- Supported range 2027-01-01T00:00:00Z … 2027-04-01T00:00:00Z inclusive, 600 s step, 12 961 samples.
- Observer 2.0 m above the DEM surface; `observerAltitudeM = surfaceElevationM + 2.0`, sent to Horizons in km
  with 6 decimals (1 mm). Surface elevation is the bilinear DEM height at the point.
- Reference body: sphere of radius 1 737 400 m (Horizons states 1737.4 km radii for the Moon; the DEM's
  GeoKeys state a 1 737 400 m sphere; the PDS label states heights relative to 1737.4 km).
- Frame: Horizons `MEAN_ME (high precision)` and LOLA `MOON_ME` (DE421) are treated as identical; the
  residual is not quantified.
- Sun/Earth direction: Horizons quantity 4 (airless apparent az/el of the body centre). Horizons UTC tags
  for 2027 assume no new leap second; its EOP predictions (to 2027-02-07) do not affect a lunar observer.
- Between samples the analysis interpolates the *margin* linearly (contract section 4).
- Geometric reference horizon: 0° in every azimuth (no terrain, no dip).
- Terrain horizon: see the `assumptions` and `curvatureModel` fields of each site's `horizons.terrain`.
- Map: hillshade is illustrative only (not a real illumination state).
- Demonstration points are not NASA landing sites and are never described as approved/selected/best.
