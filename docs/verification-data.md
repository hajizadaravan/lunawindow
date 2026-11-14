# Data verification record

Numbers below come from the final pipeline run of 2026-11-14 (commands in `docs/data-pipeline.md`). Most
are also asserted in `pipeline/tests/`. Where a number exists only in this document, the text says so.

**Test suite:** `.venv/bin/python -m pytest -q pipeline/tests` → **36 passed**

| File | Tests |
|---|---|
| `test_analysis.py` | 12 |
| `test_terrain_synthetic.py` | 8 |
| `test_ephemeris.py` | 6 |
| `test_exports.py` | 5 |
| `test_dem_real.py` | 5 (skipped when `data/dem/` is empty) |

**Golden fixture:** `fixtures/analysis-golden.json` holds **43 cases**: 19 inline and 24 site cases. The site cases cover 3 sites × 2 bodies × 2 horizon kinds × 2 windows (2027-01-08 and the +24 h shift, 168 h each, 24 h limit).

## 1. Ephemeris parse fidelity and time grid

For every site and body, `test_export_matches_raw_horizons` checks the following against the cached raw Horizons response:

- **Values:** each exported `azDeg[i]` and `elDeg[i]` equals the raw CSV value rounded to 4 decimals, for all 12 961 rows.
- **Angular radius:** `angularRadiusDeg` min/max equal the raw `Ang-diam`/7200.
- **Integrity:** `rawSha256` matches the cached file.
- **Raw header:** the observer frame is `MEAN_ME (high precision)`, refraction is `NO (AIRLESS)`, the radii are 1737.4 km, and the target is as requested. The echoed site coordinates match the request to 1e-6° and 1 mm.
- **Time grid:** time tags start at 2027-01-01T00:00:00Z and end at 2027-04-01T00:00:00Z. Every step is exactly 600 s, so there are no gaps or duplicates.
- **Query:** `SITE_COORD` in `ephemeris.query` equals the site's lat/lon and `observerAltitudeM` (km, 1 mm).
- **Altitude:** `observerAltitudeM = surfaceElevationM + 2.0` holds exactly.

On a cache hit, `fetch()` checks that the cached file's sha256 and request parameters match its `.meta.json`, and stops with an error if they do not.

## 2. Independent ephemeris cross-check (`pipeline/crosscheck.py`)

**Method.** I made one additional Horizons request: the Moon (301) seen from the geocentre (500@399), quantities 14, 15 and 20. That gives the sub-Earth point, the sub-solar point (both in MOON_ME, east-positive) and the Earth–Moon range, on the same 10-minute grid.

From those, our own vector geometry gives the topocentric azimuth and elevation. The body vector is range × unit(sub-lat, sub-lon), minus the site vector (R + observerAltitude) × unit(lat, lon). Azimuth is `atan2(E, N)`; elevation is measured from the local horizontal. This includes the finite Earth distance. For the Sun, the range comes from the topocentric `delta`; it enters only through a parallax term of about 0.0007°.

All 12 961 samples per site and body were compared with the Horizons topocentric azimuth and elevation.

| Site | Body | Max separation | RMS | Max \|Δel\| | Control: no parallax | Control: west longitude | Control: CCW azimuth |
|---|---|---|---|---|---|---|---|
| demo-a | Earth | 0.0060° | 0.0041° | 0.0006° | 0.279° | 85.4° | 100.3° |
| demo-a | Sun | 0.0002° | 0.0002° | <0.0001° | 0.0007° | 85.4° | 179.9° |
| demo-b | Earth | 0.0060° | 0.0041° | 0.0006° | 0.278° | 4.13° | 19.6° |
| demo-b | Sun | 0.0002° | 0.0002° | <0.0001° | 0.0007° | 4.13° | 179.9° |
| demo-c | Earth | 0.0060° | 0.0041° | 0.0006° | 0.278° | 146.4° | 158.3° |
| demo-c | Sun | 0.0002° | 0.0002° | <0.0001° | 0.0007° | 146.4° | 179.7° |

What this shows:

- **Conventions confirmed:** azimuth runs clockwise from north, longitude is east-positive, the frame is ME, and units are degrees and metres-to-km.
- **Parallax matters for Earth:** leaving it out costs about 0.28°.
- **Residual:** the remaining 0.006° for Earth is almost entirely in azimuth. It is the size expected from the different aberration and light-time treatment of the two products; this explanation is not separately verified.

The test `test_independent_crosscheck_residuals` asserts less than 0.01° and that every control exceeds its threshold.

## 3. Terrain geometry on synthetic DEMs (`test_terrain_synthetic.py`)

The synthetic site is at −89.0°, 45°E, on a curved Moon with R = 1 737 400 m, using a 50 m grid. The observer is 2 m above the surface.

| Case | Analytic | Ray march |
|---|---|---|
| Flat sphere | dip = −acos(R/(R+2)) = −0.08694° at tangent distance 2636 m | within 2e-4° and 60 m, all azimuths; all rays proven complete |
| Plateau of 1500 m starting at 20 km ground distance | 3.9518° (exact curved Moon; a flat-earth atan would give 4.2835°) | within 0.02° and 100 m, all azimuths |
| 800 m wall at 10–10.4 km spanning azimuths 357°–3° | 4.3966° | bins 358°, 359°, 0°, 1°, 2° within 0.1°; bins 5°, 90°, 180°, 270° and 355° below 0°; `H(359.5°)` equals the mean of bins 359 and 0, and `H(360°)` equals bin 0 |
| NaN sector at azimuths 80°–100° beyond 5 km | — | azimuth 90° is flagged `coverageLimited`, not proven, and its horizon distance is under 5 km; azimuth 0° is proven |
| Raster edge at 110 km with a 7 km bound | — | rays toward the edge (azimuth 0°) are flagged; the ray over the pole (azimuth 180°) is proven; `coverageLimited` equals not-proven for every ray |
| Site with no data | — | raises `ValueError` |

Projection round trips are tested at latitudes −89.999° to −80°, including longitudes 359.99° and 222.7°:

- lat/lon → x/y → lat/lon agrees to 1e-10° in latitude and 1e-8° in longitude;
- unit vector → x/y agrees with the contract formula to 1e-6 m;
- pixel → x/y → pixel is exact;
- longitude 0° maps to +y and 90°E to +x;
- bilinear sampling returns NaN when a neighbour is NaN or the point is off the raster.

## 4. LOLA DEM metadata and independent height check

**Product:** `LDEM_80S_40MPP_ADJ.TIF` from PGDA product 90, 716 299 920 bytes, sha256 `b7f3567bfa405dbcb42f867f6cd3c9932ca9752b4363ce1eef835f9115c1dd76`. The hash is pinned in `config.RASTER_SHA256` and checked before use.

`dem.read_geotiff_info` reads these values from the file's own GeoKeys and GDAL tags and stops with an error on any mismatch:

| Property | Value read from the file |
|---|---|
| Grid | 15200 × 15200 float32, deflate with floating-point predictor, cloud-optimised GeoTIFF with 5 overviews |
| Projection | Projected, `PolarStereographic` |
| Natural origin latitude | −90 |
| Scale at origin | 1.0 (true scale at the pole) |
| Straight vertical pole longitude | 0 |
| False easting/northing | 0 |
| Units | metres |
| Datum | "Moon (2015) - Sphere / Ocentric", semi-axes 1 737 400 / 1 737 400 m, prime meridian 0 |
| Raster type | PixelIsArea |
| ModelPixelScale | 40 × 40 m |
| ModelTiepoint | pixel (0, 0) → (−304000, 304000) m |
| Height range (GDAL metadata) | −7296.5 to 7026.8 m; history `grdmath … 1000.0 MUL` (km → m) |
| Scale/offset | none |
| Nodata | `GDAL_NODATA = nan` |

The full-resolution raster has **0** NaN pixels, so valid coverage is the whole ±304 km square, and rays end only at the raster edge.

The product page states the files are in "the MOON_ME reference frame of the JPL DE421 ephemeris". The page does not state the height reference. It is established by the next check.

**Independent check against the PDS LOLA GDR `LDEM_75S_240M.IMG`.** Its label states "Map values are relative to a radius of 1737.4 km" and "MEAN EARTH/POLAR AXIS OF DE421". It was downloaded over HTTPS; sha256 `d031efe2…7c490`. I sampled 20 000 random points between 89.9°S and 80.5°S in both grids using the same projection code:

- Median difference (40 m − 240 m) is **−0.05 m**, mean −0.25 m, and the 90th percentile of |Δ| is **5.1 m**. This confirms the same height reference.
- Shifting the PDS grid by 240 m in x or y raises the 90th percentile to 61 m and 60 m, and a 120 m shift gives 31 m. This confirms registration to well under half a 240 m pixel, including the PDS pixel-centre convention.
- Mirroring y raises it to 4552 m, which confirms axis orientation.

The test asserts a median under 5 m, a 90th percentile under 150 m, and that a shifted grid does worse, using 4000 points on the 80 m overview.

**Known feature: Shackleton crater** (nominal centre 89.67°S, 129.8°E). The DEM gives −2788.9 m at the nominal centre and a median of +1175.2 m on a ring at 10.5 km. The resulting bowl depth of about 3964 m is centred on the projected coordinates. The lowest pixel within 5 km lies 2.5 km from the nominal centre, at −2871.9 m. The mirrored longitude (230.2°E) differs by more than 1 km.

**Overview map.** `web/public/data/map/south-pole-hillshade.png` is 621 × 1317 px and 379 KB. It is a 3 × 3 block mean at 120 m per pixel.

- **Extents:** x from −23 320 to 51 200 m, y from −24 320 to 133 720 m. These are exact multiples of the DEM grid.
- **Test checks:** the image size matches `manifest.map`, pixels are square at a multiple of 40 m, and all three sites fall inside the image. The hillshade asymmetry of the Shackleton bowl appears at the pixel predicted by the contract formula.

## 5. Real-site terrain horizons

**Method:** azimuth step 0.5° (720 bins), samples every 20 m from 80 m out, a 300 km cap, and the proven-complete bound using the DEM maximum of 7026.8 m.

| | demo-a | demo-b | demo-c |
|---|---|---|---|
| Location | −89.45, 222.7 (ridge between Shackleton and de Gerlache) | −85.9883, 2.0625 (Malapert massif summit) | −88.65, 106.8 (lower-lying terrain, 32 km from Shackleton's centre) |
| Surface height | 1955.239 m | 5173.17 m | −376.64 m |
| Local slope | 3.1° | 0.7° | 4.8° |
| Within ±1 km | 3.4 m below the local high, which is 338 m away | is the highest 40 m pixel | 109.7 m below a high 1.4 km away |
| PDS 240 m height at the point | 1950.7 m | 5168.1 m | −375.4 m |
| Horizon min / median / max | −2.85° / −1.14° / +0.22° | −2.69° / −2.07° / −0.07° | −0.47° / +1.35° / +9.58° |
| Azimuths proven complete | 720 / 720 | 720 / 720 | 720 / 720 |
| Azimuths flagged `coverageLimited` | 0 | 0 | 0 |
| Farthest stopping distance | 244 km | 196 km | 175 km |
| Horizon set within 200 m (≤ 1 km) | 220 (461) azimuths | 295 (516) azimuths | 0 (84) azimuths |
| 40 m vs 80 m horizon, RMS (max) | 0.105° (0.319°) | 0.163° (0.527°) | 0.020° (0.125°) |
| Height error at the site (error map) | 0.06 m | 0.11 m | 0.09 m |
| Height error propagated to the horizon, RMS | 0.036° | 0.037° | 0.010° |
| **`uncertaintyDeg`** | **0.12** | **0.17** | **0.05** (floor) |

**How `uncertaintyDeg` is computed:** max(0.05, √(resolution² + height-error²)), rounded up to 0.01°.

- **Resolution term:** the RMS difference between horizons computed on the 40 m DEM and on its 2 × 2-averaged 80 m version, including that grid's own observer height.
- **Height-error term:** the producer's `LDEM_80S_80MPP_ADJ_ERR.TIF` (sha256 `e8930691…70ffc6`; 0.02–8.96 m, median 0.29 m), propagated as atan(√(σ_site² + σ_point²)/d).

This is an estimate, not a validated error bound.

**Main limitation.** At the two summit points, 30–40 % of the azimuths have their horizon set by the DEM surface within 200 m. That horizon is the convex local slope seen over a 2 m mast. A 40 m grid cannot represent metre-scale relief there: boulders, small craters, slope breaks. The real near-field horizon can differ by more than the stated uncertainty.

## 6. Time-step sensitivity (`pipeline/timestep.py`)

**Method.** For each site, the pipeline chose the 3-day span with the most Sun + Earth transitions and fetched 1-minute Horizons series for it (cached). Transition times were then computed two ways:

- the shipped 10-minute data with linear margin interpolation;
- the 1-minute data, through the same analysis.

| Site | Span | Transitions (Sun / Earth, both horizons) | Max \|Δt\| | Count mismatches |
|---|---|---|---|---|
| demo-a | 2027-02-17 to 02-20 | 3 terrain Sun, 1 geometric Earth | 4.0 s | 0 |
| demo-b | 2027-02-11 to 02-14 | 5 terrain + 1 geometric Sun | 6.4 s | 0 |
| demo-c | 2027-01-21 to 01-24 | 4 terrain + 1 geometric Sun, 1 + 1 Earth | 4.1 s | 0 |

The maximum elevation interpolation error at the 1-minute points is 9e-5°, which equals the 4-decimal rounding of the exported values. Across 20 transitions the maximum difference is **6.4 s**.

**Horizon-uncertainty sensitivity** is the larger effect. I computed how far each terrain transition moves when the horizon shifts by its `uncertaintyDeg`, using uncertainty divided by the margin rate:

- demo-a: Sun 5.1, 3.9 and 7.6 h;
- demo-b: Sun 6.2, 6.2, 3.8, 2.4 and 3.2 h;
- demo-c: Sun 0.5, 0.5, 0.5 and 1.6 h; Earth 0.7 h.

**What the UI may honestly show:** sampling error is seconds, but terrain transitions are uncertain by **hours** near the pole, because the Sun and Earth skim the horizon. Display transition times and gap durations at most to the nearest 10 minutes, label them approximate, and rely on the near-horizon flags. This figure is computed by `pipeline/timestep.py` but not asserted by any test.

## 7. Analysis (`test_analysis.py`, golden fixture)

The golden fixture is regenerated and reproduced exactly (to 1e-9 h) by the reference implementation. The tests also check:

- every interval list exactly covers the window and alternates states;
- visible + blocked + unknown hours equal the window duration;
- the limit is strict: equal to the gap gives `within`, 2.999999 h against a 3 h gap gives `exceeded`;
- truncated gaps give `not-exceeded-truncated` with `boundaryTruncated`;
- missing data gives `indeterminate-missing-data` and sets `adjacentToUnknown`;
- status precedence is exceeded, then truncated, then missing data;
- shifting the window by +24 h moves only the window;
- on a tie, the earliest gap wins;
- invalid windows (off-grid, beyond the range, not whole steps) raise errors;
- the near-horizon band equals angular radius plus uncertainty.

## 8. Not verified

- **Frame residual:** the difference between Horizons MEAN_ME (DE441) and LOLA MOON_ME (DE421) is not quantified.
- **Earth cross-check residual:** attributing the 0.006° to aberration and light-time differences is not separately verified.
- **Near-field relief:** relief below 40 m around a 2 m mast is not represented (see section 5). `uncertaintyDeg` comes from the DEM's own data and is not checked against images or independent topography.
- **Leap seconds:** Horizons UTC tags for 2027 assume no new leap second.
- **Error-map hash:** the pinned sha256 is for the copy downloaded on 2026-11-14. There is no producer-published checksum to compare it with, and the same is true for the other rasters.
