import { ArrowsLeftRight, MapPin, Sliders, Student } from "@phosphor-icons/react";
import type { ReactNode } from "react";

// Approved copy (audience statement and steps). Restyled for the landing; no step numbers.
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

export function How() {
  return (
    <section id="how" className="lw-section lw-how" aria-labelledby="lw-how-title">
      <div className="lw-wrap">
        <div className="lw-audience">
          <Student className="lw-audience-icon" size={32} weight="regular" aria-hidden="true" />
          <h2 id="lw-how-title" className="lw-h2">
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

        <h3 className="lw-h3 lw-steps-title">How it works</h3>
        <ol className="lw-step-list">
          {STEPS.map((s) => (
            <li key={s.title} className="lw-step">
              <span className="lw-step-icon" aria-hidden="true">
                {s.icon}
              </span>
              <h4 className="lw-h3">{s.title}</h4>
              <p className="lw-body">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
