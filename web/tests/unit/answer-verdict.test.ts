import { describe, expect, it } from "vitest";
import type { AnalysisResult, LimitStatus } from "../../src/contract/types";
import { sunVerdict } from "../../src/components/Headline";

function r(gap: number | null, status: LimitStatus | null, limit = 6): AnalysisResult {
  return {
    body: "sun",
    longestInterruption: gap === null ? null : { durationHours: gap, boundaryTruncated: status === "not-exceeded-truncated" },
    limit: status === null ? null : { limitHours: limit, status, exceedingIntervals: [] },
    unknownHours: 0,
  } as unknown as AnalysisResult;
}

describe("sunVerdict (navigator answer)", () => {
  it("says there is no verdict when no limit is set", () => {
    const v = sunVerdict(r(8.9, null), r(2, null), 24);
    expect(v.tone).toBe("none");
    expect(v.text).toMatch(/No Sun limit set/);
    expect(v.text).not.toMatch(/within/);
  });

  it("names the delayed start when only it exceeds", () => {
    const v = sunVerdict(r(null, "within"), r(8.9, "exceeded"), 24);
    expect(v.tone).toBe("over");
    expect(v.text).toBe("The planned start stays within your 6 h limit; delayed by 24 h, the longest Sun interruption exceeds it by 2.9 h.");
  });

  it("never calls a truncated or missing-data window within", () => {
    for (const s of ["not-exceeded-truncated", "indeterminate-missing-data"] as const) {
      expect(sunVerdict(r(3, s), null, 24).tone).toBe("uncertain");
      expect(sunVerdict(r(3, s), null, 24).text).toMatch(/does not show it stays within/);
      expect(sunVerdict(r(3, "within"), r(3, s), 24).tone).toBe("uncertain");
    }
  });

  it("handles a single window without the delay check", () => {
    expect(sunVerdict(r(2, "within"), null, 24)).toEqual({
      tone: "within",
      text: "The longest Sun interruption stays within your 6 h limit in this window.",
    });
    expect(sunVerdict(r(8.9, "exceeded"), null, 24).text).toBe("The longest Sun interruption exceeds your 6 h limit by 2.9 h.");
  });
});
