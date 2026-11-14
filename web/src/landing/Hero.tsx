import { ArrowRight, CalendarBlank, Check, GlobeHemisphereWest, Warning } from "@phosphor-icons/react";
import type { CSSProperties } from "react";
import type { DemoStory, LandingHeroProps } from "./index";
import { HeroMedia } from "./HeroMedia";
import { formatHours, formatUtc, scaleFor } from "./format";

const ZERO = 0.05; // below this a gap reads as "0 h", matching formatHours

export function Hero({ story, onTryDemo, onOpenCalendar, onAssumptions }: LandingHeroProps) {
  return (
    <section className="lw-hero" aria-labelledby="lw-hero-title">
      <h2 id="lw-hero-title" className="lw-hero-title">
        If your Moon mission slips by one day, does your start date still fit your limits?
      </h2>
      <div className="lw-hero-copy">
        <p className="lw-hero-sub">
          LunaWindow compares the longest loss of Sun and Earth visibility for each start date, and what a 24 h
          delay changes.
        </p>
        <div className="lw-hero-actions">
          <button type="button" className="lw-btn lw-btn-primary" onClick={onTryDemo}>
            Try a 24 h delay
            <ArrowRight size={18} weight="bold" aria-hidden="true" />
          </button>
          <button type="button" className="lw-btn lw-btn-secondary" onClick={onOpenCalendar}>
            <CalendarBlank size={18} weight="regular" aria-hidden="true" />
            Find start dates that fit
          </button>
        </div>
        <button type="button" className="lw-quiet-link" onClick={onAssumptions}>
          Read the assumptions
        </button>
      </div>

      <figure className="lw-window">
        <HeroMedia />
        <figcaption className="lw-media-caption">Illustrative image, not NASA imagery</figcaption>
        <Comparison story={story} />
      </figure>
    </section>
  );
}

function Comparison({ story }: { story: DemoStory | null }) {
  const ready = story !== null;
  return (
    <div
      className="lw-compare"
      data-ready={ready}
      aria-busy={!ready}
      role="group"
      aria-labelledby="lw-compare-title"
    >
      <p id="lw-compare-title" className="lw-compare-title">
        Longest Sun interruption
      </p>
      <p className="sr-only" role="status">
        {story
          ? `Longest Sun interruption: ${formatHours(story.baseSunGapHours)} for the planned start, ${formatHours(story.shiftedSunGapHours)} if the start is delayed by ${formatHours(story.shiftHours)}. Example limit ${formatHours(story.limitHours)}.`
          : "Computing the example from the cached dataset."}
      </p>
      <Setup story={story} />
      {ready ? <Result story={story} /> : <ResultSkeleton />}
    </div>
  );
}

function Setup({ story }: { story: DemoStory | null }) {
  const items: [string, string | null][] = [
    ["Point", story?.siteName ?? null],
    ["Start", story ? formatUtc(story.startUtc) : null],
    ["Window", story ? `${story.durationDays} days` : null],
    ["Horizon", story?.horizonLabel ?? null],
  ];
  return (
    <dl className="lw-setup">
      {items.map(([k, v]) => (
        <div key={k} className="lw-setup-item">
          <dt>{k}</dt>
          <dd>{v ?? <span className="lw-skel lw-skel-text" aria-hidden="true" />}</dd>
        </div>
      ))}
    </dl>
  );
}

function Result({ story }: { story: DemoStory }) {
  const { baseSunGapHours: base, shiftedSunGapHours: shifted, limitHours: limit, shiftHours } = story;
  const { max, step } = scaleFor([base, shifted], limit);
  // Axis ticks, minus any that would collide with the highlighted limit label.
  const ticks = Array.from({ length: max / step + 1 }, (_, i) => i * step).filter(
    (t) => Math.abs(t - limit) > step * 0.45,
  );
  const pct = (h: number) => `${(Math.min(Math.max(h, 0), max) / max) * 100}%`;
  const limitText = formatHours(limit);
  const shiftText = formatHours(shiftHours);

  const baseOver = base > limit;
  const shiftOver = shifted > limit;
  let verdict: { tone: "over" | "within"; text: string };
  if (!baseOver && shiftOver)
    verdict = {
      tone: "over",
      text: `Delayed by ${shiftText}, the longest Sun interruption exceeds the example ${limitText} limit by ${formatHours(shifted - limit)}.`,
    };
  else if (baseOver && shiftOver)
    verdict = { tone: "over", text: `Both starts exceed the example ${limitText} limit.` };
  else if (baseOver)
    verdict = {
      tone: "over",
      text: `The planned start exceeds the example ${limitText} limit; delayed by ${shiftText}, it does not.`,
    };
  else verdict = { tone: "within", text: `Both starts stay within the example ${limitText} limit in this window.` };

  const earthBase = story.baseEarthGapHours;
  const earthShift = story.shiftedEarthGapHours;
  const earthText =
    earthBase < ZERO && earthShift < ZERO
      ? "Earth stays in view through both windows."
      : `Earth: longest interruption ${formatHours(earthBase)} planned, ${formatHours(earthShift)} delayed.`;

  const rows = [
    { key: "base", label: "Planned start", when: formatUtc(story.startUtc), value: base },
    { key: "shift", label: `Start +${shiftText}`, when: formatUtc(story.startUtc, shiftHours), value: shifted },
  ];

  return (
    <>
      <p className="lw-delta" aria-hidden="true">
        <span className="lw-delta-from">{formatHours(base)}</span>
        <ArrowRight className="lw-delta-arrow" size={28} weight="bold" aria-hidden="true" />
        <span className="lw-delta-to" data-over={shiftOver}>
          {formatHours(shifted)}
        </span>
      </p>

      <div className="lw-plot" style={{ "--lw-limit": pct(limit) } as CSSProperties}>
        {rows.map((r, i) => {
          const within = Math.min(r.value, limit);
          const over = Math.max(r.value - limit, 0);
          return (
            <div key={r.key} className="lw-row">
              <div className="lw-row-head">
                <span className="lw-row-label">{r.label}</span>
                <span className="lw-row-when">{r.when}</span>
              </div>
              <div className="lw-bar" aria-hidden="true" style={{ "--lw-i": i } as CSSProperties}>
                <span className="lw-limit-mark" />
                {r.value < ZERO ? (
                  <span className="lw-bar-zero" />
                ) : (
                  <>
                    <span className="lw-bar-seg lw-bar-within" style={{ width: pct(within) }} />
                    {over > 0 && (
                      <span
                        className="lw-bar-seg lw-bar-over"
                        style={{ left: pct(within), width: `calc(${pct(r.value)} - ${pct(within)})` }}
                      />
                    )}
                  </>
                )}
                <span
                  className="lw-bar-value"
                  style={{ left: r.value < ZERO ? "0%" : pct(r.value) }}
                  data-zero={r.value < ZERO}
                >
                  {r.value < ZERO ? "no interruption" : formatHours(r.value)}
                </span>
              </div>
            </div>
          );
        })}
        <div className="lw-axis" aria-hidden="true">
          {ticks.map((t, i) => (
            <span key={t} style={{ left: pct(t) }}>
              {i === ticks.length - 1 ? `${t} h` : t}
            </span>
          ))}
          <span className="lw-axis-limit" style={{ left: pct(limit) }}>
            limit {limitText}
          </span>
        </div>
      </div>

      <div className="lw-notes">
        <p className="lw-verdict" data-tone={verdict.tone}>
          {verdict.tone === "over" ? (
            <Warning size={18} weight="fill" aria-hidden="true" />
          ) : (
            <Check size={18} weight="bold" aria-hidden="true" />
          )}
          {verdict.text}
        </p>
        <p className="lw-earth">
          <GlobeHemisphereWest size={18} weight="regular" aria-hidden="true" />
          {earthText}
        </p>
        <p className="lw-fine">Within the selected window. Body-centre visibility only.</p>
      </div>
    </>
  );
}

/** Same footprint as <Result>, so nothing moves when the story arrives. */
function ResultSkeleton() {
  return (
    <>
      <p className="lw-delta" aria-hidden="true">
        <span className="lw-skel lw-skel-num" />
        <ArrowRight className="lw-delta-arrow" size={28} weight="bold" />
        <span className="lw-skel lw-skel-num" />
      </p>
      <div className="lw-plot" aria-hidden="true">
        {[0, 1].map((i) => (
          <div key={i} className="lw-row">
            <div className="lw-row-head">
              <span className="lw-skel lw-skel-label" />
            </div>
            <div className="lw-bar">
              <span className="lw-skel lw-skel-bar" style={{ width: i ? "62%" : "18%" }} />
            </div>
          </div>
        ))}
        <div className="lw-axis" />
      </div>
      <div className="lw-notes">
        <p className="lw-verdict" data-tone="loading">
          Computing the example from the cached dataset.
        </p>
        <p className="lw-earth">&nbsp;</p>
        <p className="lw-fine">Within the selected window. Body-centre visibility only.</p>
      </div>
    </>
  );
}
