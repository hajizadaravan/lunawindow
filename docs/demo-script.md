# LunaWindow — demo script (about 3 minutes)

Run `cd web && npm install && npm run dev`, open the printed URL. Everything is served from cached files; no
network request to NASA is made during the demo.

The numbers quoted below were read from the reference analysis on the dataset generated on 2026-11-14.
If the data is regenerated, re-check them in the app before presenting.

## 1. The question (20 s)
"If your Moon mission slips by one day, does your start date still fit your limits? Average illumination maps
tell you how often a place is lit; a plan is constrained by the longest *continuous* loss of Sun or Earth
visibility. LunaWindow shows that gap for a point and a mission window, what changes if the start is 24 hours
later, and which other start dates stay within the limits you set."
(LunaWindow does not model power or mission survival — do not say a mission "dies".)

## 2. Orient (20 s)
- Left: south-pole relief map made from NASA LOLA elevation data, with three demonstration points.
  Say it out loud: these are demonstration coordinates, not NASA landing sites.
- Demo point A is selected, start 2027-01-01, 7 days, terrain horizon.
- Cards: Sun — no interruption; Earth — blocked for the whole 168 h, and the card says the gap fills the
  window and may continue outside it.

## 3. A 24-hour shift that matters (50 s)
- Demo point A, start date **2027-02-10**, 00:00 UTC, 7 days, horizon **Terrain (LOLA)**.
- Set **Max Sun loss = 6** hours.
- Sun card: no interruption, limit verdict "within".
- Tick **Start 24 hours later**. The shifted window contains a Sun interruption of about **8.9 h** that the
  baseline does not, so the verdict becomes "exceeded". Read the generated summary sentence.
- The table shows where it is: the gap starts on 2027-02-17 at about 09:31 UTC, a few hours after the
  baseline window ends, so the baseline timeline cannot show it. Change the start date to **2027-02-11** to
  see it on the timeline, then drag the cursor (or use the arrow keys) onto it and watch the Sun marker dip
  under the terrain line in the horizon view.

## 4. Why terrain matters (40 s)
- Demo point A, start **2027-03-05**, 7 days.
- Horizon **Geometric reference (no terrain)**: the Sun centre is below 0° for the whole 168 h.
- Switch to **Terrain (LOLA)**: longest Sun gap about **25.8 h**, because from a ridge the real horizon lies
  below 0° in most directions. The mode tag on every panel changes with the switch, so the two can't be confused.
- With "Start 24 hours later": about **1.8 h** — but the gap touches the window start, and the app says its
  full duration may extend outside the analysed period.

## 5. A different kind of place (30 s)
- Demo point C (lower-lying terrain), start **2027-01-18**, terrain horizon: three separate Sun
  interruptions in the week, the longest about **65.6 h**; the horizon view shows terrain rising to roughly 9.6°.
- Open "Show intervals as a table" to show that every bar is backed by listed intervals.

## 6. Honesty (20 s)
Open **Assumptions & sources**: JPL Horizons query parameters, LOLA product, observer 2 m above the surface,
body-centre approximation, near-horizon uncertainty band. Say what it is not: not a power model, not a link
budget, not a landing-safety assessment, and near the pole a small horizon error can move a transition by hours.

## Keyboard-only path
Tab to the site list (arrow keys change site) → start date → limits → horizon switch → timelines
(←/→ 10 min, Shift+←/→ 6 h, Page Up/Down 24 h, Home/End) → "Start 24 hours later" → Assumptions & sources.
