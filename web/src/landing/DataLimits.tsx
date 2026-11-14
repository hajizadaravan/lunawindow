import { BookOpen, Database, MapPin, Mountains, Planet, Prohibit, Sun } from "@phosphor-icons/react";
import type { ReactNode } from "react";

// Approved copy (sources, "What it does not claim", sensitivity). Recomposed as a ledger with a sticky heading.
const SOURCES: { icon: ReactNode; term: string; body: string }[] = [
  {
    icon: <Planet size={22} weight="regular" />,
    term: "JPL Horizons ephemerides",
    body: "Where the Sun and Earth sit in the sky as seen from each point, requested once and stored.",
  },
  {
    icon: <Mountains size={22} weight="regular" />,
    term: "NASA LOLA elevation",
    body: "Lunar Orbiter Laser Altimeter terrain, used to build each point's local horizon.",
  },
  {
    icon: <Database size={22} weight="regular" />,
    term: "Cached, not live",
    body: "The app reads only the stored files. It sends no requests to NASA while you use it.",
  },
  {
    icon: <MapPin size={22} weight="regular" />,
    term: "Three demonstration coordinates",
    body: "Points picked for comparison. They are not proposed or approved landing sites.",
  },
];

const NOT_CLAIMED = [
  "It checks whether the centre of the Sun or of Earth is above the horizon. Nothing more.",
  "Sun in view does not mean power. Earth in view does not mean a radio link.",
  "It says nothing about landing safety.",
  "Meeting your limits in the starts you evaluated does not make a plan safe or proof against delay.",
  "Gaps are measured inside the selected window and may continue past its edges.",
];

export function DataLimits({ onAssumptions }: { onAssumptions: () => void }) {
  return (
    <section id="data" className="lw-section lw-data" aria-labelledby="lw-data-title">
      <div className="lw-wrap lw-data-grid">
        <div className="lw-data-head">
          <h2 id="lw-data-title" className="lw-h2">
            Where the numbers come from
          </h2>
          <p className="lw-body">
            Two horizon modes are kept apart: a geometric reference with no terrain, and a terrain horizon from
            LOLA. Every result names the one in use.
          </p>
          <button type="button" className="lw-btn lw-btn-ghost" onClick={onAssumptions}>
            <BookOpen size={18} weight="regular" aria-hidden="true" />
            Read the assumptions
          </button>
        </div>

        <div className="lw-ledger">
          <dl className="lw-sources">
            {SOURCES.map((s) => (
              <div key={s.term} className="lw-source">
                <dt>
                  <span className="lw-source-icon" aria-hidden="true">
                    {s.icon}
                  </span>
                  {s.term}
                </dt>
                <dd>{s.body}</dd>
              </div>
            ))}
          </dl>

          <div className="lw-limits">
            <h3 className="lw-h3">What it does not claim</h3>
            <ul>
              {NOT_CLAIMED.map((t) => (
                <li key={t}>
                  <Prohibit size={18} weight="regular" aria-hidden="true" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>

          <aside className="lw-sensitivity" aria-labelledby="lw-sens-title">
            <Sun className="lw-sens-icon" size={22} weight="regular" aria-hidden="true" />
            <h3 id="lw-sens-title" className="lw-h3">
              Near the pole, small horizon errors move hours
            </h3>
            {/* Documented in docs/status.md (terrain horizon sensitivity). An estimate, not a measured error range. */}
            <p className="lw-sens-value">0.5 to 7.6 h</p>
            <p className="lw-body">
              The Sun skims the horizon at the pole, so a slightly wrong horizon shifts when it appears or
              disappears. Our documented sensitivity estimate is the range above. It is an estimate, not a measured
              error range.
            </p>
          </aside>
        </div>
      </div>
    </section>
  );
}
