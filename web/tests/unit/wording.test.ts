import { describe, expect, it } from "vitest";
import { analyzeVisibility } from "../../src/analysis/visibility";
import { comparisonSummary, limitReason, truncationNote } from "../../src/analysis/wording";
import { fmtHours, fmtUtc } from "../../src/analysis/format";
import type { GeometricHorizon } from "../../src/contract/types";

const geo: GeometricHorizon = { kind: "geometric", id: "geometric-reference", label: "", elevationDeg: 0, uncertaintyDeg: 0, assumptions: [] };
const run = (el: (number | null)[], limitHours: number | null, body: "sun" | "earth" = "sun") =>
  analyzeVisibility({
    time: { startUtc: "2027-01-01T00:00:00Z", stepSeconds: 3600, count: el.length, scale: "UTC" },
    track: { azDeg: el.map(() => 10), elDeg: el, angularRadiusDeg: { min: 0.2, mean: 0.2, max: 0.2 } },
    horizon: geo,
    body,
    windowStartUtc: "2027-01-01T00:00:00Z",
    durationHours: el.length - 1,
    limitHours,
  });

describe("formatting", () => {
  it("rounds durations to 0.1 h and times to the minute", () => {
    expect(fmtHours(2.04999)).toBe("2.0 h");
    expect(fmtHours(2.05001)).toBe("2.1 h");
    expect(fmtUtc("2027-01-01T10:29:31Z")).toBe("2027-01-01 10:30 UTC");
  });
});

describe("plain-language wording", () => {
  it("explains an exceeded limit with the gap and the limit", () => {
    const r = run([1, -1, -1, -1, 1], 2);
    expect(limitReason(r)).toBe(
      "The Sun interruption from 2027-01-01 00:30 UTC to 2027-01-01 03:30 UTC lasts 3.0 h, longer than your 2.0 h limit.",
    );
  });
  it("says 'slightly longer' when rounding hides the difference", () => {
    const r = run([1, -1, -1, 1], 1.98);
    expect(limitReason(r)).toContain("slightly longer than your 2.0 h limit");
  });
  it("flags truncated gaps", () => {
    const r = run([-1, -1, 1, 1], 5);
    expect(limitReason(r)).toContain("may continue outside it");
    expect(truncationNote(r)).toContain("may have begun before");
  });
  it("flags truncation in the comparison when only the baseline gap touches the window edge", () => {
    const a = { sun: run([-1, -1, 1, 1], null), earth: run([1, 1, 1, 1], null, "earth") };
    const b = { sun: run([1, -1, 1, 1], null), earth: run([1, 1, 1, 1], null, "earth") };
    expect(comparisonSummary(24, a, b)).toContain("the baseline gap touches a window edge and may continue outside it");
  });
  it("summarises the shift from computed numbers", () => {
    const a = { sun: run([1, -1, 1, 1], 0.5), earth: run([1, 1, 1, 1], null, "earth") };
    const b = { sun: run([1, -1, -1, 1], 0.5), earth: run([1, 1, 1, 1], null, "earth") };
    expect(comparisonSummary(24, a, b)).toBe(
      "Starting 24 h later, the longest Sun interruption changes from 1.0 h to 2.0 h (+1.0 h), and there is no Earth interruption in either window.",
    );
  });
});
