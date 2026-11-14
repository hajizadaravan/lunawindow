import { describe, expect, it } from "vitest";
import { compareVerdict, overshoot } from "../../src/landing/verdict";

const story = { baseSunGapHours: 0, shiftedSunGapHours: 8.94, limitHours: 6, shiftHours: 24 };

describe("landing verdict wording", () => {
  it("keeps today's example wording (0 h planned, 8.9 h delayed, 6 h limit)", () => {
    expect(compareVerdict({ ...story, baseSunStatus: "within", shiftedSunStatus: "exceeded" })).toEqual({
      tone: "over",
      text: "Delayed by 24 h, the longest Sun interruption exceeds the example 6 h limit by 2.9 h.",
    });
  });

  it("an overshoot that rounds to 0 h says exceeds, without a 'by 0 h' amount", () => {
    expect(overshoot(6.01, 6)).toBe("");
    expect(overshoot(8.94, 6)).toBe(" by 2.9 h");
    const v = compareVerdict({ ...story, shiftedSunGapHours: 6.01, baseSunStatus: "within", shiftedSunStatus: "exceeded" });
    expect(v.text).toBe("Delayed by 24 h, the longest Sun interruption exceeds the example 6 h limit.");
    expect(v.text).not.toMatch(/by 0 h/);
  });

  it("truncated or missing-data results never read as within the limit, even when gap <= limit", () => {
    for (const s of ["not-exceeded-truncated", "indeterminate-missing-data"] as const) {
      const a = compareVerdict({ ...story, shiftedSunGapHours: 2, baseSunStatus: "within", shiftedSunStatus: s });
      expect(a.tone).toBe("uncertain");
      expect(a.text).not.toMatch(/stay within/);
      const b = compareVerdict({ ...story, baseSunGapHours: 9, shiftedSunGapHours: 2, baseSunStatus: "exceeded", shiftedSunStatus: s });
      expect(b.text).not.toMatch(/it does not\.?$/);
      expect(b.text).toMatch(/Delayed by 24 h, /);
    }
    expect(compareVerdict({ ...story, shiftedSunGapHours: 2, baseSunStatus: "within", shiftedSunStatus: "within" }).tone).toBe(
      "within",
    );
  });

  it("follows the status even when the hours alone would say otherwise", () => {
    // gap 8.9 h with status within cannot happen in the analysis, but the wording must not second-guess it.
    expect(compareVerdict({ ...story, baseSunStatus: "within", shiftedSunStatus: "within" }).tone).toBe("within");
  });
});
