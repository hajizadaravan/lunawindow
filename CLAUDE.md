# LunaWindow

Interactive web app (NASA Space Apps 2026, "Lunar Landing Site Navigator") that compares lunar south-pole
demonstration points and mission start dates by the **longest continuous loss of Sun or Earth visibility**
within a selected mission window, and shows what changes if the mission starts 24 hours later.

Exploratory prototype for students and educators. Nothing here certifies landing safety, power or communication.

## MVP boundaries

In: three demonstration points, date range 2027-01-01 … 2027-04-01 UTC, 1–14 day windows (default 7),
geometric and terrain horizons, longest-gap cards, user tolerance limits, baseline vs +24 h, cached data only,
display-only 3D terrain view with Sun/Earth playback, display-only cast shadows from its mesh, and a per-moment flag
where the drawn surface disagrees with the result (a warning only; the result is unchanged).
Out: backend, live NASA requests at runtime, power/link models, arbitrary coordinates, shadow-based visibility or
illumination results, 5 m terrain detail, in-app chatbot.

## Layout and ownership

| Path | What | Owner lane |
|---|---|---|
| `docs/data-contract.md` | Shared JSON shapes, conventions, analysis algorithm (normative) | integrator only |
| `pipeline/` | Python: Horizons ingestion, LOLA terrain horizon, reference analysis, export, tests | data |
| `data/raw/`, `data/derived/` | Cached raw NASA responses and derived terrain/cross-check results (committed) | data |
| `data/dem/` | Large rasters, git-ignored, re-downloadable | data |
| `web/public/data/`, `fixtures/` | **Generated** by the pipeline — never hand-edit | data |
| `web/` (everything else) | Vite + React + TypeScript app; analysis in `web/src/analysis/` | frontend |
| `docs/data-pipeline.md`, `docs/verification-data.md` | Reproduction steps, measured verification results | data |
| `docs/status.md` | Continuation note: what is done, unverified, next | whoever finishes a deliverable |
| `docs/demo-script.md`, `README.md` | Walkthrough and overview | integrator |

## Commands

Web (from `web/`):
- `npm install`, `npm run dev` (real cached data), `npm run build`, `npm run preview`
- `npm test` — Vitest, includes `fixtures/analysis-golden.json`
- `npx playwright install chromium` once, then `npm run test:e2e`
- `npm run dev:synthetic` — generates `public/data-synthetic/` and runs against it (banner shown)

Pipeline (from the repo root):
- `python3 -m venv .venv && .venv/bin/pip install -r pipeline/requirements.txt`
- `.venv/bin/python -m pytest -q pipeline/tests` (DEM tests skip when `data/dem/` is empty)
- Offline regeneration from committed caches: `.venv/bin/python -m pipeline.export` then `.venv/bin/python -m pipeline.golden`
- 3D display-mesh skyline check (no DEM, deterministic): `.venv/bin/python -m pipeline.terrain3d_skyline`
  (writes `data/derived/terrain3d-skyline.json` and `web/public/data/terrain3d/<id>.skyline.json`; rerun after every
  `pipeline.export_terrain3d`, or the 3D view refuses the stale skyline)
- Full rebuild including raster downloads and Horizons fetches: follow `docs/data-pipeline.md` step by step

## Scientific rules

- Follow `docs/data-contract.md` section 1 for frames, units, azimuth, UTC. Metres and degrees in JSON; Horizons takes km.
- Two horizon modes that must never be confused: `geometric-reference` (0°, no terrain) and `terrain-lola`.
  Every result panel shows the active mode.
- Body-centre visibility only. Sun visible ≠ power; Earth-centre visible ≠ radio link; user limits ≠ battery endurance.
- Gaps are "within the selected analysis interval"; boundary-touching gaps may continue outside it.
- No fabricated measurements, no "best site" claims, no "NASA-approved landing site" wording.
  Every number in the UI comes from the dataset or the analysis module.
- Synthetic data sets `synthetic: true`, lives only in `web/public/data-synthetic/`, and must show the banner.
- The demo must run from cached data with no live NASA request. Horizons requests are serialised and cached;
  a cached response is never re-fetched.
- The 3D terrain mesh is display only: every visible, blocked or no-data state shown in the 3D view comes from the
  analysis results, never from the mesh. Its cast shadows are imagery, approximate and never compared with the result;
  where the mesh skyline disagrees with a state, the view must say so (contract section 6), never hide it.
- Source rasters are used only after `pipeline.dem.verify_raster` matches their pinned sha256 (fails closed).

## Verification requirements

- The analysis exists twice (`pipeline/analysis.py`, `web/src/analysis/visibility.ts`). Any change to one needs the
  other changed, the contract updated, `pipeline.golden` rerun, and both test suites green.
- After changing the pipeline: pytest, re-export, golden, `npm test`.
- After changing the UI: `npm test`, `npm run build`, `npm run test:e2e`, and look at the running app.
- Record measured results in `docs/verification-data.md`; never state a check that was not run.

## Status and known limitations

Working MVP on real cached data (3 points, both horizon modes, map, comparison). See `docs/status.md` for the
current state and next steps, and `README.md` for the limitation list. The main scientific caveat: the terrain
horizon comes from a 40 m grid, so around a 2 m mast on a summit the near-field horizon is under-resolved, and
near the pole a small horizon error can move a transition by hours.

## Working with the orchestrator

- Use the installed `fable-orchestration` skill when delegating. Pass an explicit `model:` on every agent;
  implementation and review lanes go to Opus, the main loop keeps the contract, integration and final judgment.
- At most two implementation lanes at once, each with owned paths from the table above; lanes never edit
  each other's paths or the contract.
- A lane's report is a claim: rerun its tests and inspect its output before calling it done.
- Do not commit unless the user asks.
