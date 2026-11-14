// Verdict wording for the landing. Every verdict is worded from the analysis' LimitStatus (DemoStory /
// PointSummary), never from comparing gap hours with the limit: a gap touching the window edge or missing data is
// not "within the limit". Phrasing follows src/analysis/wording.ts (STATUS_LABEL, limitReason).
import type { LimitStatus } from "../contract/types";
import { formatHours } from "./format";

/** Why a status that is neither "within" nor "exceeded" is not a verdict either way. */
export const CAVEAT: Partial<Record<LimitStatus, string>> = {
  "not-exceeded-truncated": "a gap touches the window edge and may continue outside it, so its full length is not known",
  "indeterminate-missing-data": "part of the window has missing data, so a longer gap cannot be ruled out",
};

/** Short visible note for compact rows. */
export const SHORT_CAVEAT: Partial<Record<LimitStatus, string>> = {
  "not-exceeded-truncated": "gap truncated",
  "indeterminate-missing-data": "missing data",
};

/** " by 2.9 h", or "" when the overshoot would print as 0 h (the analysis still says the limit is exceeded). */
export function overshoot(gapHours: number, limitHours: number): string {
  const t = formatHours(gapHours - limitHours);
  return t === "0 h" ? "" : ` by ${t}`;
}

export type Tone = "over" | "within" | "uncertain";

/** The hero panel's verdict for the planned start vs the start delayed by shiftHours. */
export function compareVerdict(s: {
  baseSunStatus: LimitStatus;
  shiftedSunStatus: LimitStatus;
  baseSunGapHours: number;
  shiftedSunGapHours: number;
  limitHours: number;
  shiftHours: number;
}): { tone: Tone; text: string } {
  const L = formatHours(s.limitHours);
  const S = formatHours(s.shiftHours);
  const base = s.baseSunStatus;
  const shifted = s.shiftedSunStatus;
  const baseCaveat = CAVEAT[base] ? ` For the planned start, ${CAVEAT[base]}.` : "";
  const shiftedCaveat = CAVEAT[shifted] ? ` Delayed by ${S}, ${CAVEAT[shifted]}.` : "";

  if (base === "exceeded" && shifted === "exceeded") return { tone: "over", text: `Both starts exceed the example ${L} limit.` };
  if (shifted === "exceeded")
    return {
      tone: "over",
      text: `Delayed by ${S}, the longest Sun interruption exceeds the example ${L} limit${overshoot(
        s.shiftedSunGapHours,
        s.limitHours,
      )}.${baseCaveat}`,
    };
  if (base === "exceeded")
    return shifted === "within"
      ? { tone: "over", text: `The planned start exceeds the example ${L} limit; delayed by ${S}, it does not.` }
      : { tone: "over", text: `The planned start exceeds the example ${L} limit.${shiftedCaveat}` };
  if (base === "within" && shifted === "within")
    return { tone: "within", text: `Both starts stay within the example ${L} limit in this window.` };
  return {
    tone: "uncertain",
    text: `No Sun interruption found exceeds the example ${L} limit, but that does not show it stays within.${baseCaveat}${shiftedCaveat}`,
  };
}
