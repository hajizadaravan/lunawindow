import {
  ArrowsLeftRight,
  Database,
  MapPin,
  Mountains,
  Planet,
  Prohibit,
  Sliders,
  Student,
  Sun,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";

const STEPS: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <MapPin size={22} weight="regular" />,
    title: "Pick a point and a window",
    body: "Choose one of three demonstration coordinates, a start date and how many days the mission lasts.",
  },
  {
    icon: <Sliders size={22} weight="regular" />,
    title: "Set your limits",
    body: "Enter the longest loss of Sun and of Earth visibility your plan can tolerate. They are your numbers, not a battery or radio model.",
  },
  {
    icon: <ArrowsLeftRight size={22} weight="regular" />,
    title: "Compare start dates",
    body: "See the longest interruption for each start date, and what changes if the start slips by 24 h.",
  },
];

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

export function Sections({ onAssumptions }: { onAssumptions: () => void }) {
  return (
    <div className="lw-sections">
      <section className="lw-audience" aria-labelledby="lw-audience-title">
        <Student className="lw-audience-icon" size={32} weight="regular" aria-hidden="true" />
        <div>
          <h2 id="lw-audience-title" className="lw-h2">
            For student mission-design teams and educators
          </h2>
          <p className="lw-lead">
            A team planning a seven-day lunar experiment decides how long it can go without the Sun or Earth in
            view, then compares points and start dates against those limits.
          </p>
          <p className="lw-body">
            Educators can use the same view to show why a day of timing matters near the lunar south pole.
          </p>
        </div>
      </section>

      <section className="lw-steps" aria-labelledby="lw-steps-title">
        <h2 id="lw-steps-title" className="lw-h2">
          How it works
        </h2>
        <ol className="lw-step-list">
          {STEPS.map((s) => (
            <li key={s.title} className="lw-step">
              <span className="lw-step-icon" aria-hidden="true">
                {s.icon}
              </span>
              <h3 className="lw-h3">{s.title}</h3>
              <p className="lw-body">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="lw-data" aria-labelledby="lw-data-title">
        <div className="lw-data-head">
          <h2 id="lw-data-title" className="lw-h2">
            Where the numbers come from
          </h2>
          <p className="lw-body">
            Two horizon modes are kept apart: a geometric reference with no terrain, and a terrain horizon from
            LOLA. Every result names the one in use.
          </p>
        </div>
        <dl className="lw-source-grid">
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
      </section>

      <section className="lw-limits" aria-labelledby="lw-limits-title">
        <div className="lw-limits-list">
          <h2 id="lw-limits-title" className="lw-h2">
            What it does not claim
          </h2>
          <ul>
            {NOT_CLAIMED.map((t) => (
              <li key={t}>
                <Prohibit size={18} weight="regular" aria-hidden="true" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
          <button type="button" className="lw-btn lw-btn-secondary" onClick={onAssumptions}>
            Read the assumptions
          </button>
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
      </section>
    </div>
  );
}
