# LunaWindow — continuation note

Updated: 2026-11-14 (3D terrain view and `#/app` redesign). Rewrite this file at every deliverable boundary; keep it short.

## State
MVP is complete and verified on real cached data. Branch `integrate/3d-terrain` merges
`feature/3d-terrain-visualization` (Gasim Garayev Yavuz: LOLA display meshes and a first Three.js viewer) and adds
the playback rework, the mesh skyline check, the landing card and the `#/app` redesign. Three views now share one
time cursor: timelines, horizon view and the 3D terrain view. The analysis, the visibility data and the golden
fixture were not touched. The branch is committed (merge commit, the friend's authorship kept in history), pushed to
`origin/integrate/3d-terrain`, and merged into `main` by fast-forward at the user's request (2026-11-14).

## Accepted decisions
- Static app, no backend: Python pipeline writes cached JSON to `web/public/data/`, analysis runs in the browser
  (TypeScript); the Python reference implementation and `fixtures/analysis-golden.json` (43 cases) keep the two in step.
- Contract `docs/data-contract.md` v1.0.0. Section 6 (terrain display assets) is additive, so the version did not change.
- Range 2027-01-01 → 2027-04-01 UTC, 600 s step, observer 2.0 m above the DEM surface, geometric horizon = 0°.
- Demo points A (−89.45, 222.7°E), B (−85.9883, 2.0625°E), C (−88.65, 106.8°E). Never called NASA landing sites.
- DEM: `LDEM_80S_40MPP_ADJ.TIF` (PGDA product 90); uncertainty 0.12° / 0.17° / 0.05°.
- **The 3D mesh is display only.** Visible, blocked and no-data states in the 3D view come from the analysis results
  (`web/src/terrain/playback.ts` `statusAt`), never from the mesh. Reason, measured: the mesh skyline differs from
  the analysis horizon by more than the stated uncertainty in 81 of 720 bins at A and 32 at C
  (`data/derived/terrain3d-skyline.json`, `docs/verification-data.md` section 10).
- **Shadows and the drawn-surface check (2026-11-14).** Sun lighting casts shadows from the display mesh (display
  only, approximate, not checked). So that the drawn skyline never contradicts a label silently, the view compares every moment with the mesh's own skyline
  (`terrain3d/<id>.skyline.json`, written by `pipeline.terrain3d_skyline`, bound to the GLB sha256, contract
  section 6) and, when they disagree, says "3D SURFACE DIFFERS" on the ray and explains it in the readout with
  both elevations. The check never changes a state. Measured: verification section 13.
- Playback: requestAnimationFrame, 1 / 6 / 24 h of mission time per second, directions interpolated between samples.
  The shared cursor is published at most every 250 ms while playing and exactly on pause, end, scrub and tab hide.
  Any outside change (timeline drag, new window, new start) stops playback and the panel rests on the shared cursor.
- Model loading: the `.json` is validated against the site and the pinned DEM sha256 before the GLB is requested;
  the GLB's length and sha256 are checked before parsing. This catches a damaged or mismatched file; it is not
  tamper protection. A GLB and its `.json` are always regenerated and committed together.
- The second, bolder `#/app` redesign pass was accepted by the user on 2026-11-14.
- `#/app` is locked to the landing's dark scheme whatever the OS setting (light tokens are kept under
  `:root[data-scheme="light"]`). The answer panel (`Headline.tsx`) words its verdict from the analysis `LimitStatus`.
- Routing: hash routes in `web/src/lib/route.ts`; landing data is derived from the dataset and the analysis module.
- `web/playwright.config.ts` uses port `E2E_PORT ?? 4179`. A leftover vite on the chosen port makes Playwright hang.

## Last verified (2026-11-14, by the integrator, final working tree)
- `.venv/bin/python -m pytest -q pipeline/tests` → 47 passed.
- From `web/`: `npx tsc -b` clean; `npm test` → 12 files, 136 passed; `npm run build` passes;
  `npm run test:e2e` → 31 passed. Repeat runs and frame-rate numbers: `docs/verification-data.md` section 10.
- Reviews over the uncommitted diff (independent Opus agents, read-only): security review (high) found nothing with
  an attack path; code review (high) found six defects, all fixed (list in section 10). A second pass over the fix
  round (medium): security nothing; code no blocking defect, the pending-publish timing cases
  it found are fixed except one that cannot be observed (section 10).

## Known limitations (also in README.md)
- Body-centre visibility only; no power or link model.
- 40 m DEM cannot represent metre-scale relief near a 2 m mast; at the two summit points 30–40 % of azimuths
  have a horizon set within 200 m. Horizon uncertainty moves transitions by 0.5–7.6 h in the measured cases.
- The 3D view's mesh can disagree with the analysis horizon at a few moments (Sun at A: 369 of 12,961 samples,
  mostly inside the near-horizon band); the view flags each such moment. Its shadows are approximate and unchecked.
- Horizons MEAN_ME (DE441) vs LOLA MOON_ME (DE421) offset not quantified.
- Not run: the e2e suite under deliberate machine load, browsers other than Chromium, a real phone or low-end GPU,
  contrast tooling, Lighthouse, screen-reader pass.

## Next actions
1. Optional, asked for by lanes, not started: a one-sentence lead and a disclosure for the controls in
   `StartCalendar.tsx`; let the landing's `compareVerdict` take the limit wording so the app's answer panel can
   reuse it (the app has its own `sunVerdict`); at 1024 and 390 px the map section comes after the evidence sections.
2. Higgsfield media: not generated. Generation is refused from Claude Code; the prompt pack `docs/media-prompts.md`
   is meant to be run in Claude chat. The existing `hero-loop.mp4` stays in use.
3. Shown on the landing as "Planned, not built yet": south-pole date heatmap, energy and battery model
   (cast shadows shipped on 2026-11-14). Later items of `docs/3d-asset-plan.az.md` (5 m DEM detail, photo textures, whole-Moon
   and Earth models, SPICE frames) each need their own data verification first.
4. Optional: show how far a boundary-truncated gap extends inside the cached range; deploy as static files.
