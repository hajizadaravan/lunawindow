// Plain-language reasons why a later start changes the longest gap. Built only from the two computed results:
// each sentence states where the relevant interruption lies relative to the two analysis windows.
import type { AnalysisResult } from "../contract/types";
import { fmtHours, fmtUtc } from "./format";
import { BODY_NAME } from "./wording";

const ms = (iso: string) => Date.parse(iso);

/** Null when the longest gap is unchanged at display precision or no positional reason can be read from the data. */
export function shiftReason(base: AnalysisResult, shifted: AnalysisResult, shiftHours: number): string | null {
  const body = BODY_NAME[base.body];
  const a = base.longestInterruption;
  const b = shifted.longestInterruption;
  const aH = a?.durationHours ?? 0;
  const bH = b?.durationHours ?? 0;
  if (fmtHours(aH) === fmtHours(bH)) return null;
  const baseEnd = ms(base.windowEndUtc);
  const shiftStart = ms(shifted.windowStartUtc);

  if (bH > aH && b) {
    const bStart = ms(b.startUtc);
    if (bStart >= baseEnd) {
      return (
        `The window starting ${shiftHours} h later runs to ${fmtUtc(shifted.windowEndUtc)}, so it includes a ` +
        `${fmtHours(b.durationHours)} ${body} interruption starting ${fmtUtc(b.startUtc)}, which begins after the ` +
        `baseline window ends at ${fmtUtc(base.windowEndUtc)}.`
      );
    }
    // Same interruption, cut off by the baseline window end.
    const cut = base.intervals.find((iv) => iv.state === "blocked" && iv.startUtc === b.startUtc && iv.touchesWindowEnd);
    if (cut) {
      return (
        `The ${body} interruption starting ${fmtUtc(b.startUtc)} is cut off by the baseline window end at ` +
        `${fmtUtc(base.windowEndUtc)} (${fmtHours(cut.durationHours)} inside it); the window starting ${shiftHours} h ` +
        `later contains ${fmtHours(b.durationHours)} of it.`
      );
    }
    return null;
  }

  if (aH > bH && a) {
    const aStart = ms(a.startUtc);
    if (aStart < shiftStart) {
      const aEnd = ms(a.endUtc);
      const rest =
        aEnd <= shiftStart
          ? "so the later window does not include it"
          : `so the later window includes only the part after ${fmtUtc(shifted.windowStartUtc)}`;
      return (
        `The baseline's longest ${body} interruption, ${fmtHours(a.durationHours)} starting ${fmtUtc(a.startUtc)}, ` +
        `begins before the window starting ${shiftHours} h later opens at ${fmtUtc(shifted.windowStartUtc)}, ${rest}.`
      );
    }
  }
  return null;
}
