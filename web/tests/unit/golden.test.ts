// Cross-language golden vectors written by the data lane (docs/data-contract.md section 5).
// Runs automatically once ../fixtures/analysis-golden.json exists; skipped (and reported) until then.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeVisibility } from "../../src/analysis/visibility";
import type { AnalysisResult, GoldenFile, SiteDataset } from "../../src/contract/types";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const repoDir = resolve(webDir, "..");
const goldenPath = join(repoDir, "fixtures", "analysis-golden.json");
const present = existsSync(goldenPath);

function loadSite(siteFile: string): SiteDataset {
  const candidates = [join(repoDir, siteFile), join(webDir, siteFile), join(webDir, "public", "data", siteFile)];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`Golden site file not found: ${siteFile}`);
  return JSON.parse(readFileSync(found, "utf8"));
}

const ms = (iso: string) => Date.parse(iso);

function compare(actual: AnalysisResult, expected: AnalysisResult, tol: number) {
  const tolMs = tol * 3_600_000;
  const closeTime = (a: string, b: string) => expect(Math.abs(ms(a) - ms(b))).toBeLessThanOrEqual(tolMs);
  const closeH = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

  expect(actual.body).toBe(expected.body);
  expect(actual.horizonId).toBe(expected.horizonId);
  expect(actual.horizonKind).toBe(expected.horizonKind);
  closeTime(actual.windowStartUtc, expected.windowStartUtc);
  closeTime(actual.windowEndUtc, expected.windowEndUtc);
  expect(actual.stepSeconds).toBe(expected.stepSeconds);
  expect(actual.intervals.map((i) => i.state)).toEqual(expected.intervals.map((i) => i.state));
  actual.intervals.forEach((iv, k) => {
    const ex = expected.intervals[k];
    closeTime(iv.startUtc, ex.startUtc);
    closeTime(iv.endUtc, ex.endUtc);
    closeH(iv.durationHours, ex.durationHours);
    expect([iv.touchesWindowStart, iv.touchesWindowEnd, iv.adjacentToUnknown]).toEqual([
      ex.touchesWindowStart,
      ex.touchesWindowEnd,
      ex.adjacentToUnknown,
    ]);
  });
  expect(actual.nearHorizonSpans.length).toBe(expected.nearHorizonSpans.length);
  actual.nearHorizonSpans.forEach((s, k) => {
    closeTime(s.startUtc, expected.nearHorizonSpans[k].startUtc);
    closeTime(s.endUtc, expected.nearHorizonSpans[k].endUtc);
  });
  expect(Math.abs(actual.nearHorizonBandDeg - expected.nearHorizonBandDeg)).toBeLessThan(1e-9);
  closeH(actual.visibleHours, expected.visibleHours);
  closeH(actual.blockedHours, expected.blockedHours);
  closeH(actual.unknownHours, expected.unknownHours);
  expect(actual.interruptionCount).toBe(expected.interruptionCount);
  if (expected.longestInterruption === null) expect(actual.longestInterruption).toBeNull();
  else {
    expect(actual.longestInterruption).not.toBeNull();
    closeTime(actual.longestInterruption!.startUtc, expected.longestInterruption.startUtc);
    closeH(actual.longestInterruption!.durationHours, expected.longestInterruption.durationHours);
    expect(actual.longestInterruption!.boundaryTruncated).toBe(expected.longestInterruption.boundaryTruncated);
  }
  if (expected.limit === null) expect(actual.limit).toBeNull();
  else {
    expect(actual.limit?.status).toBe(expected.limit.status);
    expect(actual.limit?.exceedingIntervals.length).toBe(expected.limit.exceedingIntervals.length);
  }
}

describe.skipIf(!present)("golden vectors (fixtures/analysis-golden.json)", () => {
  const golden: GoldenFile = present ? JSON.parse(readFileSync(goldenPath, "utf8")) : { cases: [] };
  it("has the expected contract version", () => expect(golden.contractVersion).toBe("1.0.0"));
  for (const c of golden.cases) {
    it(c.name, () => {
      let result: AnalysisResult;
      if (c.input.kind === "inline") {
        result = analyzeVisibility({
          time: c.input.time,
          track: c.input.track,
          horizon: c.input.horizon,
          body: c.body,
          windowStartUtc: c.windowStartUtc,
          durationHours: c.durationHours,
          limitHours: c.limitHours,
        });
      } else {
        const site = loadSite(c.input.siteFile);
        const horizon = c.input.horizonId === "terrain-lola" ? site.horizons.terrain : site.horizons.geometric;
        if (!horizon) throw new Error(`${c.input.siteFile} has no ${c.input.horizonId} horizon`);
        result = analyzeVisibility({
          time: site.time,
          track: site.ephemeris.bodies[c.body],
          horizon,
          body: c.body,
          windowStartUtc: c.windowStartUtc,
          durationHours: c.durationHours,
          limitHours: c.limitHours,
        });
      }
      compare(result, c.expected, golden.toleranceHours);
    });
  }
});
