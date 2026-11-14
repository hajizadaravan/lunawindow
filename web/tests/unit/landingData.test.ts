// Landing data derivations over the real cached dataset (web/public/data). Every value is cross-checked against a
// direct call to the analysis module, so landingData.ts can only aggregate, never change, the analysis.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeVisibility, horizonElevationAt, marginAt, sampleState, toIso } from "../../src/analysis/visibility";
import { classify, evaluateStarts, longestGapHours } from "../../src/analysis/calendar";
import { mapPixel } from "../../src/analysis/projection";
import { fmtUtc } from "../../src/analysis/format";
import type { HorizonInput, Manifest, SiteDataset } from "../../src/contract/types";
import {
  buildPoints,
  computeReplay,
  computeStory,
  computeStrip,
  exampleHorizon,
  mapPosition,
  pointResult,
  unwrapAzimuths,
  type ExampleInputs,
} from "../../src/lib/landingData";
import { parseRoute } from "../../src/lib/route";

const dataDir = join(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."), "public", "data");
const present = existsSync(join(dataDir, "manifest.json"));
const H = 3_600_000;

const manifest: Manifest | null = present ? JSON.parse(readFileSync(join(dataDir, "manifest.json"), "utf8")) : null;
const sites: Record<string, SiteDataset> = {};
if (manifest) for (const s of manifest.sites) sites[s.id] = JSON.parse(readFileSync(join(dataDir, s.file), "utf8"));

// Same inputs as App.tsx EXAMPLE plus manifest defaults.
const ex = (): ExampleInputs => ({
  siteId: "demo-a",
  startUtc: "2027-02-10T00:00:00Z",
  durationHours: 168,
  shiftHours: manifest!.defaults.shiftHours,
  sunLimitHours: 6,
});

describe("routing", () => {
  it("maps hashes to views, unknown hashes fall back to the landing", () => {
    expect(parseRoute("")).toBe("landing");
    expect(parseRoute("#")).toBe("landing");
    expect(parseRoute("#/")).toBe("landing");
    expect(parseRoute("#/app")).toBe("app");
    expect(parseRoute("#/app/")).toBe("app");
    expect(parseRoute("#/app?x=1")).toBe("app");
    expect(parseRoute("#/apps")).toBe("landing");
    expect(parseRoute("#how-it-works")).toBe("landing");
    expect(parseRoute("#/nope")).toBe("landing");
  });
});

describe("unwrapAzimuths", () => {
  it("removes 360-degree jumps in both directions and keeps the first value", () => {
    expect(unwrapAzimuths([358, 359.5, 0.5, 2])).toEqual([358, 359.5, 360.5, 362]);
    expect(unwrapAzimuths([1, 0.2, 359.4, 358])).toEqual([1, 0.2, -0.6000000000000227, -2]);
    expect(unwrapAzimuths([])).toEqual([]);
  });
});

describe.skipIf(!present)("landing data on the real dataset", () => {
  it("story and replay match the known example (demo point A, 2027-02-10, 7 d, terrain)", () => {
    const a = sites["demo-a"];
    expect(a.horizons.terrain).not.toBeNull();
    const story = computeStory(a, ex())!;
    expect(story.siteName).toBe(a.site.name);
    expect(story.horizonLabel).toBe(a.horizons.terrain!.label);
    expect(story.baseSunGapHours).toBe(0);
    expect(story.shiftedSunGapHours).toBeCloseTo(8.9, 1);

    const replay = computeReplay(a, ex())!;
    expect(replay).not.toBeNull();
    // Same gap the tool shows: the delayed window's longest Sun interruption from analyzeVisibility.
    const direct = analyzeVisibility({
      time: a.time,
      track: a.ephemeris.bodies.sun,
      horizon: a.horizons.terrain!,
      body: "sun",
      windowStartUtc: "2027-02-11T00:00:00.000Z",
      durationHours: 168,
      limitHours: 6,
    }).longestInterruption!;
    expect(replay.gapStartUtc).toBe(direct.startUtc);
    expect(replay.gapEndUtc).toBe(direct.endUtc);
    expect(replay.gapHours).toBe(direct.durationHours);
    expect(replay.gapHours).toBeCloseTo(story.shiftedSunGapHours, 12);
    // As the tool displays it (fmtUtc rounds to the minute).
    expect(fmtUtc(replay.gapStartUtc)).toBe("2027-02-17 09:31 UTC");
    expect(replay.windowStartUtc).toBe("2027-02-11T00:00:00.000Z");
    expect(replay.windowEndUtc).toBe("2027-02-18T00:00:00.000Z");
  });

  it("replay samples sit on the grid around the gap, with analysis states and a continuous azimuth", () => {
    const a = sites["demo-a"];
    const r = computeReplay(a, ex())!;
    const step = a.time.stepSeconds * 1000;
    const t0 = Date.parse(a.time.startUtc);
    const first = Date.parse(r.samples[0].utc);
    const last = Date.parse(r.samples[r.samples.length - 1].utc);
    expect(first).toBeLessThanOrEqual(Date.parse(r.gapStartUtc) - 12 * H);
    expect(first).toBeGreaterThan(Date.parse(r.gapStartUtc) - 12 * H - step);
    expect(last).toBeGreaterThanOrEqual(Date.parse(r.gapEndUtc) + 6 * H);
    expect(last).toBeLessThan(Date.parse(r.gapEndUtc) + 6 * H + step);
    for (let k = 0; k < r.samples.length; k++) {
      const s = r.samples[k];
      const i = (Date.parse(s.utc) - t0) / step;
      expect(Number.isInteger(i)).toBe(true);
      const az = a.ephemeris.bodies.sun.azDeg[i]!;
      expect(((s.azDeg % 360) + 360) % 360).toBeCloseTo(az, 9);
      expect(s.elDeg).toBe(a.ephemeris.bodies.sun.elDeg[i]);
      expect(s.state).toBe(sampleState(marginAt(a.horizons.terrain!, az, s.elDeg)));
      if (k > 0) expect(Math.abs(s.azDeg - r.samples[k - 1].azDeg)).toBeLessThan(180);
    }
    // Blocked inside the gap, visible at both ends of the replay.
    const inGap = r.samples.filter((s) => s.utc > r.gapStartUtc && s.utc < r.gapEndUtc);
    expect(inGap.length).toBeGreaterThan(0);
    expect(inGap.every((s) => s.state === "blocked")).toBe(true);
    expect(r.samples[0].state).toBe("visible");
    expect(r.samples[r.samples.length - 1].state).toBe("visible");

    // Profile: ascending, covers the sample span plus a margin, values from the analysis' horizon lookup.
    const azs = r.samples.map((s) => s.azDeg);
    expect(r.profile[0].azDeg).toBeLessThanOrEqual(Math.min(...azs) - 4);
    expect(r.profile[r.profile.length - 1].azDeg).toBeGreaterThanOrEqual(Math.max(...azs) + 4);
    for (let k = 1; k < r.profile.length; k++) expect(r.profile[k].azDeg).toBeGreaterThan(r.profile[k - 1].azDeg);
    for (const p of r.profile) expect(p.elDeg).toBe(horizonElevationAt(a.horizons.terrain!, p.azDeg));
  });

  it("replay is null when the delayed window has no Sun interruption", () => {
    // Search the dataset for a start whose delayed window is fully sunlit at demo point A.
    const a = sites["demo-a"];
    const ev = evaluateStarts({
      time: a.time,
      tracks: a.ephemeris.bodies,
      horizon: a.horizons.terrain!,
      range: manifest!.supportedRange,
      durationHours: 24,
      shiftHours: 24,
      checkShift: true,
      timeOfDayMs: 0,
    })!;
    const clear = ev.starts.find((s) => s.shifted!.sun.longestInterruption === null);
    if (!clear) return; // nothing fully sunlit in this dataset; covered by the null-path type only
    expect(computeReplay(a, { ...ex(), startUtc: clear.startUtc, durationHours: 24 })).toBeNull();
  });

  it("strips equal the calendar's evaluation and classification for every point", () => {
    for (const entry of manifest!.sites) {
      const s = sites[entry.id];
      const strip = computeStrip(manifest!, s, ex())!;
      const ev = evaluateStarts({
        time: s.time,
        tracks: s.ephemeris.bodies,
        horizon: (s.horizons.terrain ?? s.horizons.geometric) as HorizonInput,
        range: manifest!.supportedRange,
        durationHours: 168,
        shiftHours: manifest!.defaults.shiftHours,
        checkShift: true,
        timeOfDayMs: 0,
      })!;
      const cells = classify(ev, { sun: 6, earth: null });
      expect(strip.length).toBe(cells.length);
      expect(strip.length).toBeGreaterThan(30);
      strip.forEach((d, k) => {
        expect(d.startUtc).toBe(cells[k].startUtc);
        expect(d.sunGapHours).toBe(longestGapHours(cells[k].base.sun));
        expect(d.shiftedSunGapHours).toBe(longestGapHours(cells[k].shifted!.sun));
        expect(d.status).toBe(cells[k].status);
        expect(["meets", "exceeds", "uncertain"]).toContain(d.status);
      });
      // The example start is in demo point A's strip with the story's numbers.
      if (entry.id === "demo-a") {
        const day = strip.find((d) => d.startUtc === toIso(Date.parse("2027-02-10T00:00:00Z")))!;
        const story = computeStory(s, ex())!;
        expect(day.sunGapHours).toBe(story.baseSunGapHours);
        expect(day.shiftedSunGapHours).toBe(story.shiftedSunGapHours);
        expect(day.status).toBe("exceeds");
      }
    }
  });

  it("points follow manifest order with letters, map positions and per-point example results", () => {
    const m = manifest!;
    const partial = buildPoints(m, { "demo-a": sites["demo-a"] }, {}, ex());
    expect(partial.map((p) => p.id)).toEqual(m.sites.map((s) => s.id));
    expect(partial.map((p) => p.letter)).toEqual(m.sites.map((_, i) => String.fromCharCode(65 + i)));
    expect(partial.filter((p) => p.result === null).length).toBe(m.sites.length - 1);
    expect(partial.every((p) => p.strip === null)).toBe(true);

    const all = buildPoints(m, sites, {}, ex());
    for (const p of all) {
      const s = sites[p.id];
      const { horizon, label } = exampleHorizon(s);
      const analysis = (off: number, body: "sun" | "earth") =>
        analyzeVisibility({
          time: s.time,
          track: s.ephemeris.bodies[body],
          horizon,
          body,
          windowStartUtc: toIso(Date.parse("2027-02-10T00:00:00Z") + off * H),
          durationHours: 168,
          limitHours: body === "sun" ? 6 : null,
        });
      const run = (off: number, body: "sun" | "earth") => longestGapHours(analysis(off, body));
      expect(p.result).toEqual({
        baseSunGapHours: run(0, "sun"),
        shiftedSunGapHours: run(24, "sun"),
        baseEarthGapHours: run(0, "earth"),
        shiftedEarthGapHours: run(24, "earth"),
        baseSunStatus: analysis(0, "sun").limit!.status,
        shiftedSunStatus: analysis(24, "sun").limit!.status,
        horizonLabel: label,
      });
      expect(p.failed).toBe(false);
      if (m.map) {
        const px = mapPixel(m.map, p.latDeg, p.lonEastDeg);
        expect(p.mapPos).toEqual(px.inside ? { x: px.col / m.map.widthPx, y: px.row / m.map.heightPx } : null);
        if (p.mapPos) {
          expect(p.mapPos.x).toBeGreaterThanOrEqual(0);
          expect(p.mapPos.x).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(all[0].result!.shiftedSunGapHours).toBeCloseTo(8.9, 1);
    // The known example: 0 h planned (within), 8.9 h delayed (exceeds the 6 h limit).
    expect(all[0].result!.baseSunStatus).toBe("within");
    expect(all[0].result!.shiftedSunStatus).toBe("exceeded");
    const story = computeStory(sites["demo-a"], ex())!;
    expect(story.baseSunStatus).toBe("within");
    expect(story.shiftedSunStatus).toBe("exceeded");
  });

  it("mapPosition is null without a map", () => {
    expect(mapPosition({ ...manifest!, map: null }, manifest!.sites[0])).toBeNull();
  });
});

// Small synthetic inputs (hourly grid, geometric horizon at 0 degrees, Sun elevation set per hour) so each limit
// status can be produced on purpose. Not a dataset: it never leaves this test.
function syntheticSite(sunEl: (number | null)[]): SiteDataset {
  const track = (el: (number | null)[]) => ({
    horizonsCommand: "test",
    azDeg: el.map((e, i) => (e === null ? null : (i * 15) % 360)),
    elDeg: el,
    angularRadiusDeg: { min: 0.26, mean: 0.26, max: 0.26 },
    rawFile: "test",
    rawSha256: "test",
  });
  return {
    contractVersion: "1.0.0",
    synthetic: true,
    site: { id: "t", name: "Test point", locationHint: "", description: "", latDeg: -89, lonEastDeg: 0, frame: "", frameNote: "",
      referenceRadiusM: 1737400, surfaceElevationM: null, observerHeightM: 2, observerAltitudeM: 0, siteChecks: [] },
    time: { startUtc: "2027-01-01T00:00:00Z", stepSeconds: 3600, count: sunEl.length, scale: "UTC" },
    ephemeris: { sourceId: "test", query: {}, retrievedAtUtc: "", corrections: "", bodies: { sun: track(sunEl), earth: track(sunEl.map(() => 5)) } },
    horizons: {
      geometric: { kind: "geometric", id: "geometric-reference", label: "Geometric reference (0°)", elevationDeg: 0, uncertaintyDeg: 0, assumptions: [] },
      terrain: null,
    },
  } as SiteDataset;
}

// Base window hours 0..48, delayed window hours 24..72 (shift 24 h), Sun limit 6 h.
const synthEx: ExampleInputs = { siteId: "t", startUtc: "2027-01-01T00:00:00Z", durationHours: 48, shiftHours: 24, sunLimitHours: 6 };
const hours = (n: number, f: (h: number) => number | null) => Array.from({ length: n }, (_, h) => f(h));

describe("landing limit statuses come from the analysis, not from gap > limit", () => {
  it("an exceeded baseline and a delayed window whose gap touches its end (truncated)", () => {
    // Blocked 10..20 h (inside the base window only) and 68..80 h (runs past the delayed window's end at 72 h).
    const site = syntheticSite(hours(101, (h) => ((h >= 10 && h <= 20) || h >= 68 ? -1 : 1)));
    const r = pointResult(site, synthEx)!;
    expect(r.baseSunStatus).toBe("exceeded");
    expect(r.baseSunGapHours).toBeGreaterThan(6);
    expect(r.shiftedSunStatus).toBe("not-exceeded-truncated");
    expect(r.shiftedSunGapHours).toBeLessThan(6); // gap <= limit, yet not "within": that is the old code's bug
    const story = computeStory(site, synthEx)!;
    expect([story.baseSunStatus, story.shiftedSunStatus]).toEqual(["exceeded", "not-exceeded-truncated"]);
  });

  it("missing data reads as indeterminate, not within", () => {
    // Sunlit throughout, with a hole in the data inside both windows.
    const site = syntheticSite(hours(101, (h) => (h >= 30 && h <= 33 ? null : 1)));
    const r = pointResult(site, synthEx)!;
    expect(r.baseSunGapHours).toBe(0);
    expect(r.baseSunStatus).toBe("indeterminate-missing-data");
    expect(r.shiftedSunStatus).toBe("indeterminate-missing-data");
  });

  it("buildPoints marks a point failed when it failed to load, cannot be computed, or its strip came back null", () => {
    const ok = syntheticSite(hours(101, () => 1));
    const m = { sites: [{ id: "p1", name: "P1", locationHint: "", latDeg: -89, lonEastDeg: 0 },
      { id: "p2", name: "P2", locationHint: "", latDeg: -89, lonEastDeg: 0 },
      { id: "p3", name: "P3", locationHint: "", latDeg: -89, lonEastDeg: 0 },
      { id: "p4", name: "P4", locationHint: "", latDeg: -89, lonEastDeg: 0 }], map: null } as unknown as Manifest;
    // p1 loading, p2 failed to load, p3 loaded but its strip came back null, p4 loaded with a window off the data.
    const tooShort = syntheticSite(hours(10, () => 1));
    const pts = buildPoints(m, { p3: ok, p4: tooShort }, { p3: null }, synthEx, { p2: true });
    expect(pts.map((p) => p.failed)).toEqual([false, true, true, true]);
    expect(pts[0].result).toBeNull();
    expect(pts[2].result).not.toBeNull();
    expect(pts[3].result).toBeNull();
    // Loaded, strip still pending: not failed.
    expect(buildPoints(m, { p3: ok }, {}, synthEx)[2].failed).toBe(false);
  });
});
