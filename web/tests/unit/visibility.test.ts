import { describe, expect, it } from "vitest";
import { analyzeVisibility, horizonElevationAt, type AnalysisInput } from "../../src/analysis/visibility";
import type { GeometricHorizon, HorizonInput, TimeGrid } from "../../src/contract/types";

const geo: GeometricHorizon = {
  kind: "geometric",
  id: "geometric-reference",
  label: "Geometric reference horizon (no terrain)",
  elevationDeg: 0,
  uncertaintyDeg: 0,
  assumptions: [],
};
const START = "2027-01-01T00:00:00Z";
const STEP = 3600;
const grid = (count: number): TimeGrid => ({ startUtc: START, stepSeconds: STEP, count, scale: "UTC" });
const radius = { min: 0.25, mean: 0.26, max: 0.27 };

function run(el: (number | null)[], opts: Partial<AnalysisInput> = {}) {
  return analyzeVisibility({
    time: grid(el.length),
    track: { azDeg: el.map((v) => (v === null ? null : 90)), elDeg: el, angularRadiusDeg: radius },
    horizon: geo,
    body: "sun",
    windowStartUtc: START,
    durationHours: el.length - 1,
    limitHours: null,
    ...opts,
  });
}

describe("analyzeVisibility (contract section 4 cases)", () => {
  it("always visible", () => {
    const r = run([1, 2, 3, 2, 1]);
    expect(r.intervals).toHaveLength(1);
    expect(r.intervals[0]).toMatchObject({ state: "visible", durationHours: 4, touchesWindowStart: true, touchesWindowEnd: true });
    expect(r.longestInterruption).toBeNull();
    expect(r.interruptionCount).toBe(0);
    expect(r.visibleHours).toBe(4);
  });

  it("always blocked, truncated at both ends", () => {
    const r = run([-1, -2, -3, -2], { limitHours: 10 });
    expect(r.longestInterruption).toMatchObject({ durationHours: 3, boundaryTruncated: true, touchesWindowStart: true, touchesWindowEnd: true });
    expect(r.limit?.status).toBe("not-exceeded-truncated");
  });

  it("one interior gap with interpolated crossings", () => {
    // margins 1, -1, -1, 1: crossings at 0.5 h and 2.5 h
    const r = run([1, -1, -1, 1], { limitHours: 3 });
    expect(r.intervals.map((i) => i.state)).toEqual(["visible", "blocked", "visible"]);
    const g = r.longestInterruption!;
    expect(g.startUtc).toBe("2027-01-01T00:30:00.000Z");
    expect(g.endUtc).toBe("2027-01-01T02:30:00.000Z");
    expect(g.durationHours).toBeCloseTo(2, 9);
    expect(g.boundaryTruncated).toBe(false);
    expect(r.limit?.status).toBe("within");
  });

  it("gap touching window start", () => {
    const r = run([-3, -1, 1, 3]);
    const g = r.longestInterruption!;
    expect(g.touchesWindowStart).toBe(true);
    expect(g.touchesWindowEnd).toBe(false);
    expect(g.durationHours).toBeCloseTo(1.5, 9);
  });

  it("gap touching window end", () => {
    const r = run([3, 1, -1, -3], { limitHours: 5 });
    const g = r.longestInterruption!;
    expect(g.touchesWindowEnd).toBe(true);
    expect(g.durationHours).toBeCloseTo(1.5, 9);
    expect(r.limit?.status).toBe("not-exceeded-truncated");
  });

  it("missing samples split a gap", () => {
    const r = run([1, -1, -1, null, -1, -1, 1], { limitHours: 2 });
    expect(r.intervals.map((i) => i.state)).toEqual(["visible", "blocked", "unknown", "blocked", "visible"]);
    expect(r.unknownHours).toBe(2);
    expect(r.interruptionCount).toBe(2);
    expect(r.intervals[1].adjacentToUnknown).toBe(true);
    expect(r.intervals[0].adjacentToUnknown).toBe(false);
    expect(r.longestInterruption!.durationHours).toBeCloseTo(1.5, 9);
    expect(r.limit?.status).toBe("indeterminate-missing-data");
  });

  it("terrain ridge with azimuth wrap-around", () => {
    const elevationDeg = new Array(36).fill(0);
    elevationDeg[35] = 4; // bin at 350 deg
    elevationDeg[0] = 4; // bin at 0 deg
    const terrain: HorizonInput = { kind: "terrain", id: "terrain-lola", azimuthStepDeg: 10, elevationDeg, uncertaintyDeg: 0.1 };
    expect(horizonElevationAt(terrain, 355)).toBeCloseTo(4, 9);
    expect(horizonElevationAt(terrain, 5)).toBeCloseTo(2, 9);
    expect(horizonElevationAt(terrain, 345)).toBeCloseTo(2, 9);
    expect(horizonElevationAt(terrain, 360)).toBeCloseTo(4, 9);
    const az = [330, 340, 350, 0, 10, 20];
    const el = [1, 1, 1, 1, 1, 1];
    const r = analyzeVisibility({
      time: grid(6),
      track: { azDeg: az, elDeg: el, angularRadiusDeg: radius },
      horizon: terrain,
      body: "sun",
      windowStartUtc: START,
      durationHours: 5,
    });
    // margins: 1, 1, -3, -3, 1, 1 -> crossings at 1.25 h and 3.75 h
    expect(r.horizonKind).toBe("terrain");
    expect(r.longestInterruption!.durationHours).toBeCloseTo(2.5, 9);
    expect(r.nearHorizonBandDeg).toBeCloseTo(0.37, 9);
  });

  it("exact-zero margin counts as blocked", () => {
    const r = run([0, 0, 0]);
    expect(r.intervals).toHaveLength(1);
    expect(r.intervals[0].state).toBe("blocked");
    const r2 = run([1, 0, 1]);
    // touching zero for an instant produces no zero-length interval
    expect(r2.intervals.map((i) => i.state)).toEqual(["visible"]);
    const r3 = run([1, 0, -1, 1]);
    expect(r3.longestInterruption!.startUtc).toBe("2027-01-01T01:00:00.000Z");
    expect(r3.longestInterruption!.durationHours).toBeCloseTo(1.5, 9);
  });

  it("limit exactly equal to the longest gap is within (strict >)", () => {
    const r = run([1, -1, -1, 1], { limitHours: 2 });
    expect(r.limit?.status).toBe("within");
    const r2 = run([1, -1, -1, 1], { limitHours: 1.9 });
    expect(r2.limit?.status).toBe("exceeded");
    expect(r2.limit?.exceedingIntervals).toHaveLength(1);
  });

  it("+24 h shifted window of the interior-gap case", () => {
    const el: number[] = [];
    for (let i = 0; i < 49; i++) el.push(i >= 25 && i <= 26 ? -1 : 1);
    const base = run(el.slice(0, 25), { durationHours: 24 });
    expect(base.longestInterruption).toBeNull();
    const shifted = analyzeVisibility({
      time: grid(49),
      track: { azDeg: el.map(() => 90), elDeg: el, angularRadiusDeg: radius },
      horizon: geo,
      body: "sun",
      windowStartUtc: "2027-01-02T00:00:00Z",
      durationHours: 24,
    });
    expect(shifted.windowStartUtc).toBe("2027-01-02T00:00:00.000Z");
    expect(shifted.longestInterruption!.durationHours).toBeCloseTo(2, 9);
    expect(shifted.longestInterruption!.startUtc).toBe("2027-01-02T00:30:00.000Z");
  });

  it("near-horizon spans use body radius plus horizon uncertainty", () => {
    const r = run([1, 0.2, 0.1, 1, -0.2, -1]);
    expect(r.nearHorizonSpans).toEqual([
      { startUtc: "2027-01-01T01:00:00.000Z", endUtc: "2027-01-01T02:00:00.000Z" },
      { startUtc: "2027-01-01T04:00:00.000Z", endUtc: "2027-01-01T04:00:00.000Z" },
    ]);
  });

  it("earliest interruption wins ties", () => {
    const r = run([1, -1, 1, -1, 1]);
    expect(r.interruptionCount).toBe(2);
    expect(r.longestInterruption!.startUtc).toBe("2027-01-01T00:30:00.000Z");
  });

  it("rejects windows off the grid", () => {
    expect(() => run([1, 1, 1], { windowStartUtc: "2027-01-01T00:30:00Z", durationHours: 1 })).toThrow();
    expect(() => run([1, 1, 1], { durationHours: 5 })).toThrow();
  });
});

describe("terrain horizon input validation (mirrors pipeline/analysis.py)", () => {
  const terrain = (elevationDeg: number[], azimuthStepDeg: number): HorizonInput =>
    ({ kind: "terrain", id: "terrain-lola", azimuthStepDeg, elevationDeg, uncertaintyDeg: 0 }) as HorizonInput;

  it("rejects bins that do not cover exactly 360 degrees", () => {
    expect(() => run([1, 1, 1], { horizon: terrain([0, 0, 0], 90) })).toThrow(/360 degrees/);
    expect(() => run([1, 1, 1], { horizon: terrain([], 90) })).toThrow(/360 degrees/);
  });
  it("accepts a full circle", () => {
    expect(run([1, 1, 1], { horizon: terrain([0, 0, 0, 0], 90) }).blockedHours).toBe(0);
  });
});
