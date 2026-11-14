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

## Data sources

NASA/JPL Horizons (ephemerides); NASA GSFC PGDA LOLA south-pole elevation products
(Barker et al. 2023, doi:10.3847/PSJ/acf3e1); PDS LOLA polar GDR used as an independent check.
