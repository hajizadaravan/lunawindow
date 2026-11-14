import type { CSSProperties } from "react";
import {
  ArrowRight,
  Check,
  GlobeHemisphereWest,
  MinusCircle,
  Question,
  Warning,
} from "@phosphor-icons/react";
import type { AnalysisResult, BodyId, HorizonInput, LimitStatus } from "../contract/types";
import { fmtHours, fmtUtc } from "../analysis/format";
import { STATUS_LABEL } from "../analysis/wording";
import { shiftReason } from "../analysis/shiftReason";
import { formatUtc, scaleFor } from "../landing/format";
import { CAVEAT, overshoot } from "../landing/verdict";
import { ModeTag } from "./ModeTag";
import { StatusIcon } from "./BodyCard";

type Pair = Record<BodyId, AnalysisResult>;

interface Props {
  siteName: string;
  siteHint: string;
  base: Pair;
  shifted: Pair | null;
  shiftHours: number;
  durationHours: number;
  horizon: HorizonInput;
  onAssumptions: () => void;
}

export type AnswerTone = "over" | "within" | "uncertain" | "none";

const gapHours = (r: AnalysisResult) => r.longestInterruption?.durationHours ?? 0;
/** "6 h", "24 h", "8.9 h": fmtHours without a trailing ".0", for prose and labels. */
const hrs = (h: number) => fmtHours(h).replace(/\.0 h$/, " h");

/**
 * The one-sentence Sun verdict, worded only from the analysis' LimitStatus (never from comparing hours here), so a
 * truncated or missing-data window is never called "within". Same phrasing as the landing's compareVerdict, but for
 * the user's own limit and with the delay check optional.
 */
export function sunVerdict(base: AnalysisResult, shifted: AnalysisResult | null, shiftHours: number): { tone: AnswerTone; text: string } {
  if (!base.limit) {
    return {
      tone: "none",
      text: "No Sun limit set, so there is no verdict. Enter a Max Sun loss to check this window against your own tolerance.",
    };
  }
  const limitHours = base.limit.limitHours;
  const L = hrs(limitHours);
  const S = hrs(shiftHours);
  const b = base.limit.status;
  const caveat = (s: LimitStatus, who: string) => (CAVEAT[s] ? ` ${who}, ${CAVEAT[s]}.` : "");

  if (!shifted || !shifted.limit) {
    if (b === "exceeded")
      return { tone: "over", text: `The longest Sun interruption exceeds your ${L} limit${overshoot(gapHours(base), limitHours)}.` };
    if (b === "within") return { tone: "within", text: `The longest Sun interruption stays within your ${L} limit in this window.` };
    return {
      tone: "uncertain",
      text: `No Sun interruption found exceeds your ${L} limit, but that does not show it stays within: ${CAVEAT[b]}.`,
    };
  }

  const s = shifted.limit.status;
  const baseCaveat = caveat(b, "For the planned start");
  const shiftedCaveat = caveat(s, `Delayed by ${S}`);
  if (b === "exceeded" && s === "exceeded") return { tone: "over", text: `Both starts exceed your ${L} Sun limit.` };
  if (s === "exceeded")
    return {
      tone: "over",
      text:
        b === "within"
          ? `The planned start stays within your ${L} limit; delayed by ${S}, the longest Sun interruption exceeds it${overshoot(gapHours(shifted), limitHours)}.`
          : `Delayed by ${S}, the longest Sun interruption exceeds your ${L} limit${overshoot(gapHours(shifted), limitHours)}.${baseCaveat}`,
    };
  if (b === "exceeded")
    return s === "within"
      ? { tone: "over", text: `The planned start exceeds your ${L} limit${overshoot(gapHours(base), limitHours)}; delayed by ${S}, it stays within.` }
      : { tone: "over", text: `The planned start exceeds your ${L} limit${overshoot(gapHours(base), limitHours)}.${shiftedCaveat}` };
  if (b === "within" && s === "within")
    return { tone: "within", text: `Both starts stay within your ${L} Sun limit in this window.` };
  return {
    tone: "uncertain",
    text: `No Sun interruption found exceeds your ${L} limit, but that does not show it stays within.${baseCaveat}${shiftedCaveat}`,
  };
}

/** Earth, the secondary line: longest gap(s) in words, from the results only. */
function earthLine(base: AnalysisResult, shifted: AnalysisResult | null): string {
  const phrase = (r: AnalysisResult) => {
    const lg = r.longestInterruption;
    if (!lg) return r.unknownHours > 0 ? "none in the known data" : "none";
    return `${fmtHours(lg.durationHours)}${lg.boundaryTruncated ? " (touches the window edge, may continue)" : ""}`;
  };
  const clear = (r: AnalysisResult) => !r.longestInterruption && r.unknownHours === 0;
  if (!shifted) return clear(base) ? "Earth stays in view through the window." : `Earth: longest interruption ${phrase(base)}.`;
  if (clear(base) && clear(shifted)) return "Earth stays in view through both windows.";
  return `Earth: longest interruption ${phrase(base)} for the planned start, ${phrase(shifted)} delayed.`;
}

function Chip({ r, testId, body }: { r: AnalysisResult; testId: string; body: string }) {
  if (!r.limit)
    return (
      <span className="status none" data-testid={testId}>
        <MinusCircle size={16} weight="bold" aria-hidden />
        No {body} limit set
      </span>
    );
  return (
    <span className={`status ${r.limit.status}`} data-testid={testId}>
      <StatusIcon status={r.limit.status} />
      {STATUS_LABEL[r.limit.status]}
    </span>
  );
}

/** The answer, told the way the landing's hero panel tells it: big numerals, bars against the limit, one verdict. */
export function Headline(p: Props) {
  const { base, shifted } = p;
  const sunLimit = base.sun.limit?.limitHours ?? null;
  const rows = [
    { key: "base", label: "Planned start", r: base.sun },
    ...(shifted ? [{ key: "shifted", label: `Start +${hrs(p.shiftHours)}`, r: shifted.sun }] : []),
  ];
  const values = rows.map((row) => gapHours(row.r));
  const { max, step } = scaleFor(values, sunLimit ?? 0);
  const pct = (h: number) => `${(Math.min(Math.max(h, 0), max) / max) * 100}%`;
  const ticks = Array.from({ length: max / step + 1 }, (_, i) => i * step).filter(
    (t) => sunLimit === null || Math.abs(t - sunLimit) > step * 0.45,
  );
  const verdict = sunVerdict(base.sun, shifted?.sun ?? null, p.shiftHours);
  const reasons = shifted
    ? (["sun", "earth"] as const).map((b) => shiftReason(base[b], shifted[b], p.shiftHours)).filter(Boolean)
    : [];
  // "0 h" is a measured zero. With missing data in the window, no interruption found is not a zero: say "None",
  // and the bar label under it says "in the known data".
  const numeral = (r: AnalysisResult) =>
    r.longestInterruption ? fmtHours(r.longestInterruption.durationHours) : r.unknownHours > 0 ? "None" : "0 h";

  return (
    <section className="answer" aria-labelledby="result-h" data-testid="headline">
      <div className="answer-head">
        <h2 id="result-h" tabIndex={-1} className="answer-title">
          Longest Sun interruption
        </h2>
        <ModeTag horizon={p.horizon} />
      </div>
      <dl className="answer-setup">
        <div>
          <dt>Point</dt>
          <dd>{p.siteName}</dd>
        </div>
        <div>
          <dt>Start</dt>
          <dd>{formatUtc(base.sun.windowStartUtc)}</dd>
        </div>
        <div>
          <dt>Window</dt>
          <dd>
            {p.durationHours / 24} {p.durationHours === 24 ? "day" : "days"}
          </dd>
        </div>
        <div>
          <dt>Your Sun limit</dt>
          <dd>{sunLimit !== null ? hrs(sunLimit) : "none set"}</dd>
        </div>
      </dl>

      <p className="answer-delta">
        <span className="sr-only">Planned start: </span>
        <span
          className="answer-num"
          data-testid="hl-base-sun"
          data-over={base.sun.limit?.status === "exceeded"}
          data-dim={Boolean(shifted)}
        >
          {numeral(base.sun)}
        </span>
        {shifted && (
          <>
            <ArrowRight className="answer-arrow" size={30} weight="bold" aria-hidden />
            <span className="sr-only">; start {hrs(p.shiftHours)} later: </span>
            <span className="answer-num" data-testid="hl-shifted-sun" data-over={shifted.sun.limit?.status === "exceeded"}>
              {numeral(shifted.sun)}
            </span>
          </>
        )}
      </p>

      <div className="answer-plot" style={sunLimit !== null ? ({ "--lw-limit": pct(sunLimit) } as CSSProperties) : undefined}>
        {rows.map((row, i) => {
          const lg = row.r.longestInterruption;
          const v = values[i];
          const exceeded = row.r.limit?.status === "exceeded" && sunLimit !== null;
          const within = exceeded ? Math.min(v, sunLimit!) : v;
          return (
            <div key={row.key} className="answer-row">
              <div className="answer-row-head">
                <span className="answer-row-label">{row.label}</span>
                <span className="answer-row-when">{formatUtc(row.r.windowStartUtc)}</span>
                <Chip r={row.r} body="Sun" testId={`hl-verdict-${row.key}-sun`} />
              </div>
              <div className="answer-bar" style={{ "--lw-i": i } as CSSProperties}>
                {sunLimit !== null && <span className="answer-limit-mark" aria-hidden />}
                {lg ? (
                  <>
                    <span className="answer-seg answer-seg-within" style={{ width: pct(within) }} aria-hidden />
                    {exceeded && v > sunLimit! && (
                      <span
                        className="answer-seg answer-seg-over"
                        style={{ left: pct(within), width: `calc(${pct(v)} - ${pct(within)})` }}
                        aria-hidden
                      />
                    )}
                  </>
                ) : (
                  <span className="answer-seg-zero" aria-hidden />
                )}
                <span className="answer-bar-value" style={{ left: lg ? pct(v) : "0%" }} data-zero={!lg}>
                  {lg ? fmtHours(lg.durationHours) : row.r.unknownHours > 0 ? "no interruption in the known data" : "no interruption"}
                </span>
              </div>
              {lg && (
                <p className="answer-row-foot">
                  from {formatUtc(lg.startUtc)} to {formatUtc(lg.endUtc)}
                  {lg.boundaryTruncated && "; touches the window edge and may continue outside it"}
                </p>
              )}
            </div>
          );
        })}
        <div className="answer-axis" aria-hidden>
          {ticks.map((t, i) => (
            <span key={t} style={{ left: pct(t) }}>
              {i === ticks.length - 1 ? `${t} h` : t}
            </span>
          ))}
          {sunLimit !== null && (
            <span className="answer-axis-limit" style={{ left: pct(sunLimit) }}>
              limit {hrs(sunLimit)}
            </span>
          )}
        </div>
      </div>

      <div className="answer-notes">
        <p className="answer-verdict" data-tone={verdict.tone} data-testid="answer-verdict">
          {verdict.tone === "over" ? (
            <Warning size={20} weight="fill" aria-hidden />
          ) : verdict.tone === "within" ? (
            <Check size={20} weight="bold" aria-hidden />
          ) : verdict.tone === "uncertain" ? (
            <Question size={20} weight="bold" aria-hidden />
          ) : (
            <MinusCircle size={20} weight="bold" aria-hidden />
          )}
          <span>{verdict.text}</span>
        </p>
        <div className="answer-earth">
          <GlobeHemisphereWest size={18} weight="regular" aria-hidden />
          <span>{earthLine(base.earth, shifted?.earth ?? null)}</span>
          <span className="answer-earth-chips">
            {base.earth.limit && <span className="answer-earth-limit">Earth limit {hrs(base.earth.limit.limitHours)}:</span>}
            <Chip r={base.earth} body="Earth" testId="hl-verdict-base-earth" />
            {shifted && base.earth.limit && (
              <>
                <span className="answer-earth-limit">delayed:</span>
                <Chip r={shifted.earth} body="Earth" testId="hl-verdict-shifted-earth" />
              </>
            )}
          </span>
        </div>
        {reasons.length > 0 && (
          <p className="answer-why" data-testid="shift-reason">
            <strong>Why it changes:</strong> {reasons.join(" ")}
          </p>
        )}
      </div>

      <div className="answer-fine">
        <p className="window-line">
          Selected analysis interval: <span className="num">{fmtUtc(base.sun.windowStartUtc)}</span> to{" "}
          <span className="num">{fmtUtc(base.sun.windowEndUtc)}</span> ({p.durationHours / 24}{" "}
          {p.durationHours === 24 ? "day" : "days"}), {p.siteName} ({p.siteHint})
        </p>
        <p>
          Gaps are measured within the selected analysis interval, for the body centre against the modelled horizon. Sun
          visible is not available power; Earth visible is not a radio link. A verdict only compares the window with your
          own tolerance in this model; it says nothing about landing safety.{" "}
          <button type="button" className="btn link" onClick={p.onAssumptions}>
            Assumptions &amp; sources
          </button>
        </p>
      </div>
    </section>
  );
}
