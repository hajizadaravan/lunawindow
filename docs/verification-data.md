# Data verification record

Numbers below come from the final pipeline run of 2026-11-14 (commands in `docs/data-pipeline.md`). Most
are also asserted in `pipeline/tests/`. Where a number exists only in this document, the text says so.

**Test suite:** `.venv/bin/python -m pytest -q pipeline/tests` → **47 passed** (rerun 2026-11-14 after the 3D
terrain work, with `data/dem/` present; 36 before it, the 11 new tests are the two `test_terrain3d*` files)

| File | Tests |
|---|---|
| `test_analysis.py` | 12 |
| `test_terrain_synthetic.py` | 8 |
| `test_terrain3d.py` | 7 |
| `test_ephemeris.py` | 6 |
| `test_exports.py` | 5 |
| `test_dem_real.py` | 5 (skipped when `data/dem/` is empty) |
| `test_terrain3d_skyline.py` | 4 |

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

## 9. Web app and landing page (2026-11-14)

Measured by the integrator on the final working tree, from `web/`. The pipeline, the contract, `web/src/analysis/`
and the generated data were not changed by this work, so `pytest` was not rerun after it (36 passed in the
earlier run today, see the top of this file).

**Commands**

- `npx tsc -b`: clean.
- `npm test` (Vitest): **9 files, 118 passed**, including `fixtures/analysis-golden.json`.
- `npm run build`: passed.
- `npm run test:e2e` (Playwright, Chromium): **21 passed**.

| Spec | Tests |
|---|---|
| `landing.spec.ts` | 9 |
| `routing.spec.ts` | 5 |
| `hero-media.spec.ts` | 3 |
| `flow.spec.ts` | 2 |
| `landing-failure.spec.ts` | 2 |

The earlier failure of `flow.spec.ts` on its stale `/Start 24 hours later/` checkbox locator is fixed; the test now
uses the current label "Also check a start 24 hours later".

**Hero clip.** `web/public/media/hero-loop.mp4` was generated earlier today with Higgsfield Seedance 2.5 from the
existing poster as start frame. Local H.264 copy, no audio: 1280×720, 5.041667 s, 774,266 bytes (`ffprobe`). No
further Higgsfield media was generated (refused from Claude Code); `docs/media-prompts.md` holds the prompt pack.

**Visual pass.** An Opus lane took Playwright screenshots on real cached data and read them; the integrator checked
the hero at 1440×900 and 1366×768, the replay, and the synthetic banner. Covered: `#/` and `#/app` at 1440, 1024 and
390 px, OS light and dark, motion allowed and reduced.

- No horizontal overflow. The landing stays dark in light mode (background rgb(10,11,13)).
- Layout shift when data arrives: at most 0.0002.
- Headline: 2 lines at 1440 and 1024 px, 3 lines at 390 px. No wrapped button labels at 1440 and 1024 px.
- Replay autoplays once in view; play, pause and scrub work; reduced motion starts paused at the gap start.
- Daily-start strips and the A/B/C map markers render. CTAs land on `#/app`. Focus ring is visible (2 px).

Hero fits the first viewport (a `max-height: 820px` media block in `web/src/landing/styles/hero.css`). Lowest hero
element against viewport height:

| Viewport | Lowest element / height |
|---|---|
| 1440×900 | 882 / 900 |
| 1366×768 | 756 / 768 |
| 1280×800 | 788 / 800 |
| 1280×720 | 708 / 720 |
| 1024×768 | 756 / 768 |

**Synthetic mode** (`npm run dev:synthetic`): the banner stays above the landing nav at scroll 0, 300, 1500 and
4000 px, at 1440 and 390 px width.

**Wording pre-flight on `web/src/landing/`:** zero em or en dashes in visible strings, zero uppercase eyebrow labels,
no scroll listener. "landing sites" and "safe" occur only in required negations and the challenge name.

**Example ties out on real data.** Demo point A, start 2027-02-10 00:00 UTC, 7 days, terrain horizon: longest Sun
gap 0 h at baseline and 8.9 h with a 24 h delay, gap 2027-02-17 09:31 to 18:22 UTC, which exceeds the example 6 h
limit by 2.9 h.

**Reviews** (two independent Opus agents, read-only, over the uncommitted diff):

- Security review, high effort, done by hand because the `security-review` skill needs an `origin` remote: nothing
  exploitable. Hygiene note: `resume.md` is an internal handoff note with no secrets.
- Code review, `code-review` skill at high: four correctness defects, all fixed. (1) Landing verdicts compared gap
  hours with the limit and ignored `not-exceeded-truncated` and `indeterminate-missing-data`; they are now worded
  from `LimitStatus` (`web/src/landing/verdict.ts`, new fields in `web/src/landing/types.ts`); no effect on the
  current data. (2) The landing nav covered the synthetic-data banner. (3) A scroll target that never rendered stayed
  set and blocked scroll-to-top and heading focus on later route changes. (4) Load failures showed as endless
  `aria-busy` skeletons; now a `role="status"` message (`storyFailed`, `PointSummary.failed`). Also fixed: when the
  selected point failed to load, the other points never loaded.
- Not acted on, by decision: fixed "24 h" labels (approved labels, both manifests use 24 h); the "0.5 to 7.6 h"
  sensitivity text (documented estimate, section 6); repeated analyses in `buildPoints`/`computeStrip` and
  duplicated scroll-and-focus code (performance and cleanup, not correctness).
- Second, narrower review pass over the fix round (two Opus sub-agents, medium effort, by hand because the round
  has no diff baseline): security found nothing. Code found one wording defect, fixed: the `Features.tsx` delay
  cell said "does not exceed" for a window with missing data; it now says "no Sun interruption found exceeds".
  Not acted on: with a computed story and no replay the replay block is left out without a message, which is what
  `web/src/landing/types.ts` defines for a null replay. The web checks above were rerun after this fix.

**Not run for the web app:** contrast tooling, Lighthouse, screen-reader pass, browsers other than Chromium.

## 10. 3D terrain view and app redesign (2026-11-14)

Measured by the integrator on the final working tree of the `integrate/3d-terrain` branch (the merge of
`feature/3d-terrain-visualization` plus the playback, skyline check and `#/app` redesign work). The analysis
(`pipeline/analysis.py`, `web/src/analysis/`), the visibility data and `fixtures/analysis-golden.json` were not
changed; `web/public/data/manifest.json` changed only as generated by the merged branch.

**Commands**

- `.venv/bin/python -m pytest -q pipeline/tests`: **47 passed** (table at the top of this file).
- From `web/`: `npx tsc -b` clean; `npm test` (Vitest): **12 files, 136 passed**; `npm run build` passed (the
  three.js chunk is loaded only when the 3D view is opened; Vite prints a chunk-size warning for it).
- `npm run test:e2e` (Playwright, Chromium, one worker, `E2E_PORT=4195`): **31 passed**.

| Spec | Tests |
|---|---|
| `landing.spec.ts` | 10 |
| `terrain.spec.ts` | 9 |
| `routing.spec.ts` | 5 |
| `hero-media.spec.ts` | 3 |
| `flow.spec.ts` | 2 |
| `landing-failure.spec.ts` | 2 |

**Repeat runs (flakiness).** Lanes had reported three `terrain.spec.ts` tests failing now and then while other
suites ran on the same machine. The full suite was run alone three times in a row before the review fixes (30
passed each time) and four more times after them (31 passed each time). The review still found timing assumptions in the spec that
can fail under load, and they were removed: a camera move is now awaited on the frame counter instead of the
"running" flag that lasts only 600 ms, the test with three model loads has a budget for three loads, and the first
states after opening the view wait as long as a model load. Not done: a run of the suite under deliberate machine
load.

**Display mesh against the analysis horizon** (`pipeline.terrain3d_skyline`, values read from
`data/derived/terrain3d-skyline.json`; mesh skyline from the 2 m mast minus the analysis terrain horizon, 720
azimuth bins per point):

| Point | Stated horizon uncertainty | Beyond 80 m: median / min / max | Largest absolute | Bins beyond the uncertainty | Inside 80 m: max above the analysis horizon | Bins above by more than the uncertainty |
|---|---|---|---|---|---|---|
| A | 0.12° | −0.017° / −0.298° / +0.092° | 0.298° | 81 | +0.749° | 150 |
| B | 0.17° | +0.007° / −0.140° / +0.121° | 0.140° | 0 | +0.010° | 0 |
| C | 0.05° | −0.006° / −0.225° / +0.025° | 0.225° | 32 | −1.920° (never above) | 0 |

The exact skyline was checked against independent ray sampling on every 8th bin at 20, 10, 5 and 2.5 m spacing:
exact minus sampled is never negative and shrinks with the spacing (largest value at 2.5 m: 0.0085° at A, 0.0134°
at B, 0.0033° at C). Conclusion kept in the code and the README: the mesh is display only, visible, blocked and
no-data states in the 3D view are read from the analysis results, and cast shadows are not drawn from it.

**Display meshes** (`pipeline.export_terrain3d`, `data/derived/terrain3d-verification.json`,
`pipeline/tests/test_terrain3d.py`): each GLB matches its `.json` in byte length, sha256, vertex and triangle
count; no external URIs, textures or extensions; axes east, up, south; vertical exaggeration 1; the source raster
is used only after `pipeline.dem.verify_raster` matches its pinned sha256. Re-running the export once with another
numpy build reproduced the vertices to within 9e-12 m but not byte for byte (single observation), so a GLB and its
`.json` are always regenerated together.

**Playback frame rate.** `terrain.spec.ts` "playback frame rate" on the dev server, hardware WebGL (Metal), main
thread slowed 4x, 24 h of mission time per second: 51.4 to 53.4 fps in the first four runs and 33.0 to 35.5 fps in six later runs the same evening, at 23.0 to 24.2 h/s. The later runs had the machine busier (load average about 9, the whole suite took 2.0 to 2.4 min instead of 1.2); the cause of the drop was not isolated further
(the test asserts more than 12 fps and 80 to 110 % of the labelled speed, and skips where only software WebGL
exists). Reported by a lane and not re-measured by the integrator: production build 42 to 47 fps before the shared
cursor was throttled to one publish per 250 ms and 56.5 to 56.7 fps after; dev server 5.3 to 5.5 fps before.

**Looked at in the running app:** the 3D panel at 1280 and 390 px in both lightings at a visible and a blocked
moment (screenshots written by the `screenshots` test), the redesigned `#/app` beside the landing at 1440 px, and
the landing's 3D terrain and calendar cards at 390, 700 and 1024 px after the crop fix.

**Reviews** (independent Opus agents, read-only, over the uncommitted diff against `main`):

- Security review, high effort, by hand (the skill's own diff is empty while a merge is uncommitted): no finding
  with a real attack path. Checked: model loading order, the three GLBs, DOM sinks, dependencies (three 0.187.0
  pinned), pipeline writes and `verify_raster`, Playwright flags, secrets and local paths. Note acted on: the GLB
  sha256 is compared with a hash from a JSON on the same origin, so it detects a corrupted, truncated or mismatched
  file and is not tamper protection; contract section 6 now says so and the e2e test names no longer say "tampered".
- Code review, high effort, by hand: six findings, all acted on. (1) An outside move of the shared cursor back to
  the sample playback started from was ignored while playing, and a start-date change while playing carried the
  playback position into the new window; fixed in `TerrainView.tsx`, with e2e assertions that fail without the fix
  (checked once by removing it). (2) Timing assumptions in `terrain.spec.ts` (above), and playback froze on a
  device whose every frame took more than 2 s: a long frame now counts as 2 s instead of 0. (3) The answer panel
  showed "0 h" for a window with no interruption found but with missing data; it now shows "None". (4) The README
  gave only the beyond-80 m mesh difference; the near-field figures are added. (5) The GLB length and hash checks
  had no test; one was added (truncated file, then one changed byte). (6) The "NASA LOLA · 40 m source" tag was
  hard-coded; it now shows only for measured terrain with the resolution from the dataset.
- Second pass over the fix round (two Opus agents, medium, by hand: the round has no diff baseline). Security:
  nothing. Code: no blocking defect; three timing cases around a cursor publish that is still pending when
  playback stops, and one weak test. Acted on: the exact rest sample is now published urgently on every stop, so
  nothing is left to land later, and the start-change test asserts that both views rest on the same sample and
  stay there. Not acted on: an outside move to the very value the shared cursor already holds, in the first
  moments of playback before any publish has landed, changes no state and cannot be seen by the panel; playback
  runs on (a window of milliseconds, and the user can pause).

**Not run:** the suite under deliberate machine load; frame rate on the production build (integrator); browsers
other than Chromium; a real phone or a low-end GPU; contrast tooling, Lighthouse, screen-reader pass.

## 13. 3D view: cast shadows and the drawn-surface check (2026-11-14)

Problem: the 3D view could show a ridge across the Sun's ray while its label said "centre visible" (the label is the
analysis result, the ridge is the simplified display mesh), and it drew no shadows. Change: Sun lighting now casts
shadows from the display mesh, and every moment shown is compared with the mesh's own skyline; a disagreement is
named on the ray ("3D SURFACE DIFFERS") and explained in the readout with both elevations. No state, gap or result
changed; the analysis, the visibility data and the golden fixture were not touched.

**Skyline export.** `.venv/bin/python -m pipeline.terrain3d_skyline` now also writes
`web/public/data/terrain3d/<id>.skyline.json` (720 bins each, the higher of the near-field and analysis-range
skyline, 0.001° rounding, bound to the GLB sha256). The rerun left `data/derived/terrain3d-skyline.json`
byte-identical. Runtime 65 s.

**How often the drawn surface contradicts the result** (every cached sample, terrain mode; counted in Python from
the shipped files, and the same counts asserted in `web/tests/unit/terrain-surface.test.ts` through the web code):

| Point | Sun: disagreeing samples (of 12,961) | of them in the near-horizon band | Earth: disagreeing samples | of them near |
|---|---|---|---|---|
| A | 369 (2.85 %) | 348 | 146 | 146 |
| B | 69 | 69 | 8 | 8 |
| C | 35 | 35 | 2 | 2 |

At A, 191 of the 369 Sun cases remain when only the mesh beyond 80 m is used, so about half come from terrain inside
the 80 m that the analysis horizon leaves out. Largest elevation gap in a disagreeing case: 0.742° between the centre
and the analysis horizon (A, Sun). In geometric mode the drawn terrain contradicts the flat 0° result far more often
(Sun 36 % of samples at A); the same flag and a mode-specific sentence cover it.

**Shadows.** One orthographic shadow map, 4096² (2048² on phones, small or touch screens; capped by the GPU's
texture limit), fitted in light space to the ground the camera can see (the view's corner rays met with the reference sphere
lowered by 10 km, since the model keeps lunar curvature; 15 km minimum; the whole model when a corner passes over the
ground), with depth over the whole model so distant ridges toward the Sun cast. Redrawn only when the Sun moves (0.005°
in azimuth, 0.001° in elevation) or the region changes. The anti-stripe offset is taken
along the Sun ray (5 to 600 m: two light-space texels spread at the Sun's elevation), not along the surface normal, so
shadow edges from occluders farther than the offset stay where the mesh puts them. Relief lighting casts none. The
labelled fill light rose from 0.12 to 0.4 so ground in shadow keeps its outline. Shadows are display only and are not
compared with the result; the footnote and README say so.

**Commands**

- `.venv/bin/python -m pytest -q pipeline/tests`: **49 passed** (two new: the display skyline rule, and the web files
  match the GLBs and analysis bins; the demo-b test now also checks the committed web file equals a fresh export).
- From `web/`: `npx tsc -b` clean; `npm test`: **13 files, 142 passed** (new `terrain-surface.test.ts`, 6 tests);
  `npm run build` passed. Same results after the review fixes.
- `E2E_PORT=4196 npx playwright test`: **34 passed** (1.3 min), before and after the review fixes. New: a skyline
  file for another GLB is refused before the GLB is requested; shadows are on in Sun lighting (shadow map drawn) and
  off in relief; in geometric mode at 09:30 the caption is the "TERRAIN IGNORED" variant. The Sun-loss test now asserts "agrees" at 09:30 and "differs" at 09:40 on 2027-02-17 at A
  (mesh −0.763°, centre −0.750°, analysis horizon −0.746°: the analysis blocks the centre by 0.004°, the drawn surface
  leaves it clear by 0.013°). Playback frame-rate test with shadows: 52.3 fps at 24.1 h/s, and 52.4 fps after the
fixes (CPU 4× slower, Metal).

**Looked at in the running app** (dev server, 800 px wide pane): overview and Face Sun at 09:30 and 09:40 on
2027-02-17 at A in Sun lighting; shadows fall away from the Sun ray, crater rims facing the Sun are lit, no acne
stripes seen; the caption "SUN · CENTRE BLOCKED · 3D SURFACE DIFFERS" and the readout warning appear at 09:40.
After the first fixes: overview and Face Sun again (no stripes seen), and 375 px, where the long caption now slides inside the canvas instead of being cut
off. Not looked at: relief lighting by eye after the change (covered by e2e), points B and C, a low-end GPU.

**Reviews** (Opus agents, high effort, read-only; the `reviewer-*` agent types were not available, so general-purpose
agents were told not to edit):

- Security: nothing with an attack path. Notes acted on: 2048² shadow map on phones (GPU memory); the agreeing line
  now reads "the picture matches the result (display only)" so it is not taken as independent confirmation. Not acted
  on: the skyline file has no hash of its own; it is bound to the GLB hash and shape-checked, and can only change
  warning text, never a state.
- Code: two defects, both fixed. (1) The anti-stripe offset was along the surface normal and tens of metres at
  overview scale, which at a 1° Sun moves shadow edges by kilometres, and the footnote claimed the opposite direction
  of error; now the offset is along the Sun ray and the footnote and README describe shadows as approximate and
  unchecked. (2) Terrain beyond 3× the camera distance had no shadows and a lit seam; the map now covers the ground in
  view. Lesser notes acted on: redraw only on 0.005° Sun steps; shadows switched only with the lighting choice (no
  material recompiles at data gaps); the readout's "uncertain" sentence uses the same analysis flag as the state line;
  geometric mode gets its own caption; pan target clamped to the model; `docs/data-pipeline.md` names the new files;
  mast height in the footnote from the dataset; e2e checks for shadows on/off; the shadow map is disposed. Not acted
  on: `export_terrain3d.py` writes "No cast-shadow simulation" into each model's `limitations` (true of the file
  itself; regenerating the GLBs needs the DEM and is not byte-reproducible). CLAUDE.md, which listed cast shadows as
  out of scope, was updated afterwards at the user's request (scope, skyline command, 3D display rule).
- Second round over the fixes (same setup, medium). Security: nothing; notes acted on: the agreeing line says "the
  drawn skyline matches the result", in geometric mode "this mode ignores terrain"; the footnote says "every moment
  with data"; a non-finite skyline value is treated as no surface. Code: one defect, fixed: the view's corner rays were
  met with the flat plane y = 0, but the model is curved, so in the default views terrain beyond about 110 to 140 km
  still had no shadows; they now meet the curved ground, and an e2e assertion checks that the overview's shadow map
  covers the whole model (about 492 km; the flat-plane version gave about 110 to 270 km there by the reviewer's
  geometry). Also acted on: finer elevation key, no unused no-data caption variants, typed body labels. Not acted on:
  the 600 m offset cap at whole-model scale (disclosed in README and footnote), and the skyline file stays required
  (fail closed, as the contract says). After this round: 142 unit, 34 e2e (54.2 fps at 24.1 h/s), 49 pytest, build
  passed. The pane was hidden for the last look, so this round was checked by the e2e assertion, not by eye.
- Third round over those fixes (same setup, medium). Code: nothing broken; acted on: the ground sphere is centred
  R + surface height below the origin (it was R; still safe, now exact), the coverage test first checks that the top
  view gives a smaller region so the overview's whole-model value is not a leftover, footnote wording "whenever it can
  compare the two". Security: one low integrity note, acted on: a non-finite radius in the data now falls back to
  whole-model coverage instead of a NaN shadow frustum.
- Final checks on the finished tree: `npx tsc -b` clean, 142 unit tests, build passed, 49 pytest (pipeline unchanged
  since), e2e **34 passed** (1.2 min, 51.9 fps at 24.1 h/s). Two earlier runs of this round did not pass: one took
  44 min with 5 failures, all timeouts (such as a 120 s screenshot timeout) while the machine's load average was
  about 14 from other work; the next failed only on a test string I had not updated after a footnote rewording.
