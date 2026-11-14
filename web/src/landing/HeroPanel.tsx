import { ArrowRight, Check, GlobeHemisphereWest, Question, Warning, WarningOctagon } from "@phosphor-icons/react";
import type { CSSProperties } from "react";
import type { DemoStory } from "./types";
import { formatHours, formatUtc, scaleFor } from "./format";
import { compareVerdict } from "./verdict";

const ZERO = 0.05; // below this a gap reads as "0 h", matching formatHours

/** The live comparison panel: baseline vs delayed start for the example scenario, from the DemoStory props. */
export const STORY_FAILED_TEXT = "This example could not be loaded from the cached dataset.";

export function Comparison({ story, failed = false }: { story: DemoStory | null; failed?: boolean }) {
  const ready = story !== null;
  const loading = !ready && !failed;
  return (
    <div
      className="lw-compare"
      data-ready={ready}
      data-failed={!ready && failed}
      aria-busy={loading}
      role="group"
      aria-labelledby="lw-compare-title"
    >
      <p id="lw-compare-title" className="lw-compare-title">
        Longest Sun interruption
      </p>
      {/* When the example failed, the visible message below is the status instead. */}
      {!(!ready && failed) && (
        <p className="sr-only" role="status">
          {story
            ? `Longest Sun interruption: ${formatHours(story.baseSunGapHours)} for the planned start, ${formatHours(story.shiftedSunGapHours)} if the start is delayed by ${formatHours(story.shiftHours)}. Example limit ${formatHours(story.limitHours)}.`
            : "Computing the example from the cached dataset."}
        </p>
      )}
      <Setup story={story} failed={failed} />
      {ready ? <Result story={story} /> : <ResultSkeleton failed={failed} />}
    </div>
  );
}

function Setup({ story, failed }: { story: DemoStory | null; failed: boolean }) {
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
          <dd>{v ?? (failed ? null : <span className="lw-skel lw-skel-text" aria-hidden="true" />)}</dd>
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

  // The verdict comes from the analysis' limit status, never from comparing the hours here.
  const shiftOver = story.shiftedSunStatus === "exceeded";
  const verdict = compareVerdict(story);

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
          ) : verdict.tone === "uncertain" ? (
            <Question size={18} weight="bold" aria-hidden="true" />
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

/**
 * Same footprint as <Result>, so nothing moves when the story arrives. With `failed` (the example could not be
 * loaded or computed) the placeholders stay empty and the verdict line says so instead of "Computing".
 */
function ResultSkeleton({ failed }: { failed: boolean }) {
  const skel = failed ? "lw-skel-empty" : "lw-skel";
  return (
    <>
      <p className="lw-delta" aria-hidden="true">
        <span className={`${skel} lw-skel-num`} />
        <ArrowRight className="lw-delta-arrow" size={28} weight="bold" />
        <span className={`${skel} lw-skel-num`} />
      </p>
      <div className="lw-plot" aria-hidden="true">
        {[0, 1].map((i) => (
          <div key={i} className="lw-row">
            <div className="lw-row-head">
              <span className={`${skel} lw-skel-label`} />
            </div>
            <div className="lw-bar">
              {!failed && <span className="lw-skel lw-skel-bar" style={{ width: i ? "62%" : "18%" }} />}
            </div>
          </div>
        ))}
        <div className="lw-axis" />
      </div>
      <div className="lw-notes">
        {failed ? (
          <p className="lw-verdict" data-tone="failed" role="status">
            <WarningOctagon size={18} weight="bold" aria-hidden="true" />
            {STORY_FAILED_TEXT}
          </p>
        ) : (
          <p className="lw-verdict" data-tone="loading">
            Computing the example from the cached dataset.
          </p>
        )}
        <p className="lw-earth">&nbsp;</p>
        <p className="lw-fine">Within the selected window. Body-centre visibility only.</p>
      </div>
    </>
  );
}
