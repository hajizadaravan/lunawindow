# LunaWindow — continuation note

Updated: 2026-11-14 (landing page deliverable). Rewrite this file at every deliverable boundary; keep it short.

## State
MVP is complete and verified on real cached data. The landing page rebuild is finished: two hash routes, `#/`
(landing, eight blocks, locked dark) and `#/app` (the navigator). Nothing is committed (the user has not asked for a
commit). The pipeline, the contract, `web/src/analysis/` and the generated data were not touched by the landing work.

## Accepted decisions
- Static app, no backend: Python pipeline writes cached JSON to `web/public/data/`, analysis runs in the browser
  (TypeScript); the Python reference implementation and `fixtures/analysis-golden.json` (43 cases) keep the two in step.
- Contract `docs/data-contract.md` v1.0.0, including the section 4 clarifications (zero-length pieces, millisecond
  rounding, null samples, `limit + 1e-9`, repo-relative `siteFile`).
- Range 2027-01-01 → 2027-04-01 UTC, 600 s step, observer 2.0 m above the DEM surface, geometric horizon = 0°.
- Demo points A (−89.45, 222.7°E), B (−85.9883, 2.0625°E), C (−88.65, 106.8°E). Never called NASA landing sites.
- DEM: `LDEM_80S_40MPP_ADJ.TIF` (PGDA product 90); uncertainty 0.12° / 0.17° / 0.05°.
- Routing: hash routes in `web/src/lib/route.ts`, no router dependency; dataset state stays in `App`. Landing data
  is derived from the dataset and the analysis module in `web/src/lib/landingData.ts`; props contract in
  `web/src/landing/types.ts`.
- Landing verdicts are worded from the analysis `LimitStatus` (`web/src/landing/verdict.ts`), so
  `not-exceeded-truncated` and `indeterminate-missing-data` are never shown as "within".
- Landing wording: the only number not computed from props is the "0.5 to 7.6 h" sensitivity text, a documented
  estimate (section 6 of `docs/verification-data.md`). Button labels use "24 h" as approved; both manifests use 24 h.
- `web/playwright.config.ts` uses port `E2E_PORT ?? 4179`. A leftover vite on 4179 makes Playwright hang.

## Last verified (2026-11-14, by the integrator, final working tree)
- From `web/`: `npx tsc -b` clean; `npm test` → 9 files, 118 passed (includes the golden fixture);
  `npm run build` passes; `npm run test:e2e` → 21 passed (`flow`, `routing`, `landing`, `hero-media`,
  `landing-failure`). The old stale checkbox locator in `flow.spec.ts` is fixed.
- Pipeline: `.venv/bin/python -m pytest -q pipeline/tests` → 36 passed in the earlier run today; not rerun after the
  landing work because nothing in the pipeline changed.
- Visual pass on real cached data (`#/` and `#/app`, 1440 / 1024 / 390 px, light and dark OS, motion allowed and
  reduced), synthetic banner check, and wording pre-flight: results in `docs/verification-data.md` section 9.
- Reviews over the uncommitted diff, two independent Opus agents: security review (high, by hand because the skill
  needs an `origin` remote) found nothing exploitable; code review (`code-review` skill, high) found four
  correctness defects, all fixed (verdict statuses, nav covering the synthetic banner, stale scroll target,
  load failures shown as endless skeletons) plus one more fix (other points never loaded after the selected point
  failed). Not acted on, by decision: fixed "24 h" labels, the sensitivity estimate text, repeated analyses in
  `buildPoints`/`computeStrip` and duplicated scroll-and-focus code (cleanup, not correctness).
- Second review pass over the fix round (two Opus sub-agents, medium, by hand: no diff baseline, no `origin`):
  security found nothing; code found one wording defect, fixed (`Features.tsx` delay cell said "does not exceed"
  for a missing-data window; now "no Sun interruption found exceeds"). Not acted on: the replay block is left out
  without a message when the story computes but no replay can be built; `types.ts` defines a null replay as
  "no Sun interruption in the delayed window", so leaving the block out is the contract.

## Known limitations (also in README.md)
- Body-centre visibility only; no power or link model.
- 40 m DEM cannot represent metre-scale relief near a 2 m mast; at the two summit points 30–40 % of azimuths
  have a horizon set within 200 m. Horizon uncertainty moves transitions by 0.5–7.6 h in the measured cases.
- Horizons MEAN_ME (DE441) vs LOLA MOON_ME (DE421) offset not quantified.
- Not run: contrast tooling, Lighthouse, screen-reader pass, browsers other than Chromium.

## Next actions
1. Higgsfield media: not generated. Generation is refused from Claude Code and the account has 1.75 credits.
   The prompt pack `docs/media-prompts.md` is meant to be run in Claude chat; put the files in `web/public/media/`
   and wire them in `web/src/landing/media.ts`. The existing `hero-loop.mp4` (earlier session) stays in use.
2. Ask the user whether to make the first commit. `resume.md` is an internal handoff note with no secrets; it can be
   deleted now that this file carries the state, or committed if the user prefers.
3. Shown on the landing as "Planned, not built yet": south-pole date heatmap, 3D terrain with moving shadows,
   energy and battery model.
4. Optional, not started: show how far a boundary-truncated gap extends inside the cached range; deploy as static files.
