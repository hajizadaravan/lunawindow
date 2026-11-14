# LunaWindow

NASA Space Apps Challenge 2026 — [Lunar Landing Site Navigator](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/).

For a lunar south-pole point and a mission window, LunaWindow shows how long the Sun or the Earth could be
**continuously** out of view, and what changes if the mission starts 24 hours later.

Exploratory prototype for student mission-design teams and educators — for example a team planning a
seven-day lunar experiment that sets limits on Sun and Earth visibility loss and compares points and start dates. It does not certify landing safety, power or communication.
The three points are demonstration coordinates, not NASA landing sites.

## Run the demo

```sh
cd web
npm install
npm run dev        # open the printed URL; uses the cached data in web/public/data, no network needed
```

Other commands (from `web/`): `npm test`, `npm run build`, `npm run preview`,
`npx playwright install chromium` once and then `npm run test:e2e`.

## What it does

- South-pole relief map (from LOLA elevation data) with three demonstration points.
- Mission start (UTC date + hour) inside 2027-01-01 … 2027-04-01, duration 1–14 days (default 7).
- Two horizon models, always labelled: geometric reference (0°, no terrain) and terrain (LOLA).
- Sun and Earth azimuth/elevation track against the horizon, with a shared time cursor.
- Visibility timelines, longest continuous interruption per body, user-defined tolerance limits with a
  plain-language verdict, and a baseline vs +24 h comparison.
- 3D terrain view of the LOLA 40 m terrain around each point: Play moves the Sun and Earth directions across the
  selected window, and every visible or blocked state shown in it comes from the same analysis as the timelines.
- Assumptions & sources panel with the exact data provenance.

## How it is built

- `pipeline/` — Python: JPL Horizons ingestion (cached), LOLA terrain horizon, reference analysis, export.
- `web/` — Vite + React + TypeScript static app; the analysis runs in the browser on the cached JSON.
- `docs/data-contract.md` — the shared data shapes and the visibility algorithm.
- `docs/data-pipeline.md` — how to regenerate the data from NASA sources.
- `docs/verification-data.md` — what was checked and the measured results.
- `docs/demo-script.md` — a three-minute walkthrough.

## Known limitations

- Body-centre visibility only: no solar-disc fraction, no power model, no antenna or link model.
- The terrain horizon comes from a 40 m grid. Around a 2 m mast on a summit, metre-scale relief the grid
  cannot represent may set the real horizon; near the pole a small horizon error can move a transition by hours.
- Fixed date range, three fixed points, fixed 2 m observer height.
- The difference between the Horizons and LOLA realisations of the lunar body-fixed frame is not quantified.
- The 3D terrain view draws a display mesh only; visibility is never derived from it. Seen from the 2 m mast,
  its skyline differs from the analysis terrain horizon beyond the 80 m near-field start by up to 0.298° at A,
  0.14° at B and 0.225° at C, which exceeds the stated horizon uncertainty in 81 of 720 azimuth bins at A and
  32 of 720 at C (`data/derived/terrain3d-skyline.json`). Inside those first 80 m, which the analysis horizon
  leaves out, the mesh rises above the analysis horizon by up to 0.749° at A (by more than the stated uncertainty
  in 150 of 720 bins), by up to 0.01° at B and nowhere at C. So at some moments the drawn surface hides a centre
  the analysis counts as visible, or the reverse. The view checks this whenever it can compare the two and then says so on
  the ray ("3D SURFACE DIFFERS") and in the readout, with both elevations; the state stays the analysis result.
  Over the whole cached range in terrain mode this happens for the Sun at 369 of 12,961 samples at A (348 of them
  inside the near-horizon band), 69 at B and 35 at C; for the Earth at 146, 8 and 2.
- Cast shadows in the 3D view (Sun lighting) come from the display mesh, not from the analysis, and are display
  only: one shadow map over the terrain in view, so edges are approximate (an anti-stripe offset of 5 to 600 m along
  the Sun ray hides occluders closer than that), they fall on the ground rather than at the mast top, and they are
  not compared with the result. The ray captions and readouts are the result.

## Data sources

NASA/JPL Horizons (ephemerides); NASA GSFC PGDA LOLA south-pole elevation products
(Barker et al. 2023, doi:10.3847/PSJ/acf3e1); PDS LOLA polar GDR used as an independent check.
