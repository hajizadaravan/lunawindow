# LunaWindow — continuation note

Updated: 2026-11-14 09:10 (+04). Rewrite this file at every deliverable boundary; keep it short.

## State
First MVP is complete and verified on real cached data. Nothing is committed (the user has not asked for a commit).

## Accepted decisions
- Static app, no backend: Python pipeline writes cached JSON to `web/public/data/`, analysis runs in the browser
  (TypeScript); the Python reference implementation and `fixtures/analysis-golden.json` (43 cases) keep the two in step.
- Contract `docs/data-contract.md` v1.0.0, including the section 4 clarifications (zero-length pieces, millisecond
  rounding, null samples, `limit + 1e-9`, repo-relative `siteFile`).
- Range 2027-01-01 → 2027-04-01 UTC, 600 s step, observer 2.0 m above the DEM surface, geometric horizon = 0°.
- Demo points A (−89.45, 222.7°E), B (−85.9883, 2.0625°E), C (−88.65, 106.8°E). Never called NASA landing sites.
- DEM: `LDEM_80S_40MPP_ADJ.TIF` (PGDA product 90); uncertainty 0.12° / 0.17° / 0.05°.

## Last verified (2026-11-14, by the integrator)
- `.venv/bin/python -m pytest -q pipeline/tests` → 36 passed
- `cd web && npm test` → 74 passed; `npm run build` passes; `npm run test:e2e` → 2 passed (real data)
- Demo-script scenarios driven in a headless browser: the UI shows the numbers the script quotes.
- Code review and security review ran as two independent Opus agents (by hand: the skills could not diff a
  repo with no commits). All findings fixed except two accepted ones: the Horizons cache hash lives in a sidecar
  next to the response (git history is the protection), and `playwright.config.ts` puts `VITE_DATA_DIR` into a
  shell command (developer machine only).

## Known limitations (also in README.md)
- Body-centre visibility only; no power or link model.
- 40 m DEM cannot represent metre-scale relief near a 2 m mast; at the two summit points 30–40 % of azimuths
  have a horizon set within 200 m. Horizon uncertainty moves transitions by 0.5–7.6 h in the measured cases.
- Horizons MEAN_ME (DE441) vs LOLA MOON_ME (DE421) offset not quantified.
- Not run: contrast tooling, Lighthouse, screen-reader pass, browsers other than Chromium.

## Next actions
1. Higgsfield animations (tools load only in a new Claude Code session; 3-day trial from 2026-11-14):
   (a) 10–15 s "what is an interruption?" explainer clip, (b) hero background loop, (c) three cursor-driven
   surface-view loops, (d) ~30 s narrated teaser. Store clips locally in `web/public/media/`, label them
   "illustrative animation, not NASA imagery", show a static poster under reduced motion, never generate a
   "photo" of a specific real site. Start with (a).
2. Ask the user whether to make the first commit.
3. Optional, not started: show how far a boundary-truncated gap extends inside the cached range; deploy as static files.
