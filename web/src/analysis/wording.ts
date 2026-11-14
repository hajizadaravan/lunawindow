// Plain-language sentences generated only from computed AnalysisResult numbers.
import type { AnalysisResult, BodyId, LimitStatus, VisInterval } from "../contract/types";
import { fmtHours, fmtSignedHours, fmtUtc } from "./format";

export const BODY_NAME: Record<BodyId, string> = { sun: "Sun", earth: "Earth" };

export const STATUS_LABEL: Record<LimitStatus, string> = {
  within: "Within limit",
  exceeded: "Limit exceeded",
  "not-exceeded-truncated": "Not exceeded, gap truncated",
  "indeterminate-missing-data": "Indeterminate, missing data",
};

/** Short status text used in compact comparison cells. */
function span(iv: VisInterval) {
  return `${fmtUtc(iv.startUtc)} to ${fmtUtc(iv.endUtc)}`;
}

function edgeText(iv: VisInterval) {
  if (iv.touchesWindowStart && iv.touchesWindowEnd) return "fills the whole interval";
  if (iv.touchesWindowStart) return "touches the start of the interval";
  return "touches the end of the interval";
}

/** Compare two durations as displayed (0.1 h) and pick a verb that stays truthful after rounding. */
function longerThan(gap: number, limit: number) {
  return fmtHours(gap) === fmtHours(limit) ? "slightly longer than" : "longer than";
}

export function limitReason(r: AnalysisResult): string | null {
  if (!r.limit) return null;
  const body = BODY_NAME[r.body];
  const L = fmtHours(r.limit.limitHours);
  const blocked = r.intervals.filter((iv) => iv.state === "blocked");
  switch (r.limit.status) {
    case "exceeded": {
      const ex = r.limit.exceedingIntervals;
      const worst = ex.reduce((a, b) => (b.durationHours > a.durationHours ? b : a));
      const more = ex.length > 1 ? ` ${ex.length} interruptions in this interval exceed it.` : "";
      return `The ${body} interruption from ${span(worst)} lasts ${fmtHours(worst.durationHours)}, ${longerThan(
        worst.durationHours,
        r.limit.limitHours,
      )} your ${L} limit.${more}`;
    }
    case "not-exceeded-truncated": {
      const edge = blocked
        .filter((iv) => iv.touchesWindowStart || iv.touchesWindowEnd)
        .reduce((a, b) => (b.durationHours > a.durationHours ? b : a));
      return `No ${body} interruption inside the interval is longer than ${L}, but a ${fmtHours(
        edge.durationHours,
      )} gap ${edgeText(edge)} and may continue outside it, so its full length is not known.`;
    }
    case "indeterminate-missing-data":
      return `No ${body} interruption found is longer than ${L}, but ${fmtHours(
        r.unknownHours,
      )} of the interval has missing data, so a longer gap cannot be ruled out.`;
    case "within":
      if (!r.longestInterruption)
        return `The ${body} centre stays above the modelled horizon for the whole interval, so there is no interruption to compare with ${L}.`;
      return `The longest ${body} interruption, ${fmtHours(r.longestInterruption.durationHours)} from ${span(
        r.longestInterruption,
      )}, is not longer than your ${L} limit.`;
  }
}

export function truncationNote(r: AnalysisResult): string | null {
  const lg = r.longestInterruption;
  if (!lg || !lg.boundaryTruncated) return null;
  if (lg.touchesWindowStart && lg.touchesWindowEnd)
    return "This gap fills the whole analysed period and may continue before and after it.";
  if (lg.touchesWindowStart) return "This gap starts at the window start and may have begun before the analysed period.";
  return "This gap runs to the window end and may continue after the analysed period.";
}

function gapPhrase(r: AnalysisResult) {
  return r.longestInterruption ? fmtHours(r.longestInterruption.durationHours) : "no interruption";
}

function bodyChange(base: AnalysisResult, shifted: AnalysisResult): string {
  const body = BODY_NAME[base.body];
  const a = base.longestInterruption?.durationHours ?? 0;
  const b = shifted.longestInterruption?.durationHours ?? 0;
  const baseT = base.longestInterruption?.boundaryTruncated ?? false;
  const shiftT = shifted.longestInterruption?.boundaryTruncated ?? false;
  const truncated =
    baseT && shiftT
      ? " (both touch a window edge and may continue outside it)"
      : baseT
        ? " (the baseline gap touches a window edge and may continue outside it)"
        : shiftT
          ? " (the later-start gap touches a window edge and may continue outside it)"
          : "";
  if (!base.longestInterruption && !shifted.longestInterruption)
    return `there is no ${body} interruption in either window`;
  if (gapPhrase(base) === gapPhrase(shifted))
    return `the longest ${body} interruption stays at ${gapPhrase(base)}${truncated}`;
  return `the longest ${body} interruption changes from ${gapPhrase(base)} to ${gapPhrase(
    shifted,
  )}${truncated} (${fmtSignedHours(b - a)})`;
}

export function comparisonSummary(
  shiftHours: number,
  base: { sun: AnalysisResult; earth: AnalysisResult },
  shifted: { sun: AnalysisResult; earth: AnalysisResult },
): string {
  const parts = [bodyChange(base.sun, shifted.sun), bodyChange(base.earth, shifted.earth)];
  let s = `Starting ${shiftHours} h later, ${parts[0]}, and ${parts[1]}.`;
  for (const key of ["sun", "earth"] as const) {
    const a = base[key].limit;
    const b = shifted[key].limit;
    if (a && b && a.status !== b.status)
      s += ` The ${BODY_NAME[key]} limit status changes from "${STATUS_LABEL[a.status]}" to "${STATUS_LABEL[b.status]}".`;
  }
  return s;
}
