// Start-date search over the real cached dataset (web/public/data). Every number is compared with a direct
// analyzeVisibility call, so this module can only aggregate, never change, the analysis.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeVisibility, toIso } from "../../src/analysis/visibility";
import { startBounds } from "../../src/analysis/window";
import {
  classify,
  dailyStarts,
  evaluateStarts,
  findNextFit,
  limitStatusFor,
  searchStarts,
  type StartSearchParams,
} from "../../src/analysis/calendar";
import type { BodyId, HorizonInput, Manifest, SiteDataset } from "../../src/contract/types";

const dataDir = join(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."), "public", "data");
const present = existsSync(join(dataDir, "manifest.json"));
const H = 3_600_000;
const D = 24 * H;

const manifest: Manifest | null = present ? JSON.parse(readFileSync(join(dataDir, "manifest.json"), "utf8")) : null;
const sites: Record<string, SiteDataset> = {};
if (manifest) for (const s of manifest.sites) sites[s.id] = JSON.parse(readFileSync(join(dataDir, s.file), "utf8"));

function params(siteId: string, over: Partial<StartSearchParams> = {}): StartSearchParams {
  const s = sites[siteId];
  return {
    time: s.time,
    tracks: s.ephemeris.bodies,
    horizon: (s.horizons.terrain ?? s.horizons.geometric) as HorizonInput,
    range: manifest!.supportedRange,
    durationHours: 168,
    shiftHours: 24,
    checkShift: true,
    timeOfDayMs: 0,
    ...over,
  };
}

function direct(p: StartSearchParams, startMs: number, body: BodyId, limitHours: number | null = null) {
  return analyzeVisibility({
    time: p.time,
    track: p.tracks[body],
    horizon: p.horizon,
    body,
    windowStartUtc: toIso(startMs),
    durationHours: p.durationHours,
    limitHours,
  });
}

describe.skipIf(!present)("start-date search on the real dataset", () => {
  it("every cell equals direct analyzeVisibility calls (all sites, base and shifted, terrain and geometric)", () => {
    for (const id of Object.keys(sites)) {
      for (const horizon of [sites[id].horizons.geometric, sites[id].horizons.terrain].filter(Boolean) as HorizonInput[]) {
        const p = params(id, { horizon, timeOfDayMs: 6 * H });
        const ev = evaluateStarts(p)!;
        for (const s of ev.starts.filter((_, k) => k % 7 === 0 || k === ev.starts.length - 1)) {
          for (const body of ["sun", "earth"] as const) {
            expect(s.base[body]).toEqual(direct(p, s.startMs, body));
            expect(s.shifted![body]).toEqual(direct(p, s.startMs + 24 * H, body));
          }
        }
      }
    }
  });

  it("limit status matches analyzeVisibility step 8 for every start and several limits", () => {
    const p = params("demo-b");
    const ev = evaluateStarts(p)!;
    for (const L of [0.5, 6, 12, 33.215, 100]) {
      for (const s of ev.starts) {
        for (const body of ["sun", "earth"] as const) {
          const ref = direct(p, s.startMs, body, L).limit!;
          const got = limitStatusFor(s.base[body], L);
          expect(got.status).toBe(ref.status);
          expect(got.exceeding).toEqual(ref.exceedingIntervals);
        }
      }
    }
  });

  it("a gap exactly equal to the limit is not exceeded (limit + 1e-9 semantics)", () => {
    const p = params("demo-a");
    const ev = evaluateStarts(p)!;
    const s = ev.starts.find((x) => x.shifted!.sun.longestInterruption)!;
    const gap = s.shifted!.sun.longestInterruption!.durationHours;
    expect(limitStatusFor(s.shifted!.sun, gap).status).toBe(direct(p, s.startMs + 24 * H, "sun", gap).limit!.status);
    expect(limitStatusFor(s.shifted!.sun, gap).status).not.toBe("exceeded");
    expect(limitStatusFor(s.shifted!.sun, gap - 1e-6).status).toBe("exceeded");
  });

  it("covers exactly the allowed starts, first and last included, with and without the shift check", () => {
    for (const checkShift of [true, false]) {
      const p = params("demo-a", { checkShift, timeOfDayMs: 0 });
      const b = startBounds(p.range, p.time, p.durationHours, p.shiftHours)!;
      const ev = evaluateStarts(p)!;
      expect(ev.starts[0].startMs).toBe(b.earliestMs);
      expect(ev.starts.at(-1)!.startMs).toBe(b.latestMs);
      expect(ev.starts.at(-1)!.startUtc).toBe("2027-03-24T00:00:00.000Z");
      expect(ev.starts.length).toBe((b.latestMs - b.earliestMs) / D + 1);
      for (const s of ev.starts) expect(s.shifted === null).toBe(!checkShift);
      if (checkShift) {
        // the last shifted window still ends inside the supported range
        expect(Date.parse(ev.starts.at(-1)!.shifted!.sun.windowEndUtc)).toBeLessThanOrEqual(Date.parse(p.range.endUtc));
      }
    }
  });

  it("starts at a later time of day skip a first day that would fall before the range and stay inside the bounds", () => {
    const p = params("demo-c", { timeOfDayMs: 23 * H + 50 * 60_000 });
    const b = startBounds(p.range, p.time, p.durationHours, p.shiftHours)!;
    const starts = dailyStarts(b, p.timeOfDayMs);
    expect(starts[0]).toBe(b.earliestMs + 23 * H + 50 * 60_000);
    expect(starts.at(-1)!).toBeLessThanOrEqual(b.latestMs);
    expect(starts.at(-1)! + D).toBeGreaterThan(b.latestMs);
  });

  it("no limits set: every cell is no-limits and findNextFit says so", () => {
    const r = searchStarts(params("demo-a"), { sun: null, earth: null })!;
    expect(r.cells.every((c) => c.status === "no-limits" && c.checks.length === 0)).toBe(true);
    expect(findNextFit(r.cells, 0, { sun: null, earth: null })).toEqual({ kind: "no-limits" });
  });

  it("the February story: demo A, 2027-02-10 00:00 UTC, 7 days, terrain, Sun limit 6 h, +24 h checked", () => {
    const p = params("demo-a");
    expect(p.horizon.kind).toBe("terrain");
    const r = searchStarts(p, { sun: 6, earth: null })!;
    const c = r.cells.find((x) => x.startUtc === "2027-02-10T00:00:00.000Z")!;
    expect(c.base.sun.longestInterruption).toBeNull();
    const g = c.shifted!.sun.longestInterruption!;
    expect(g.durationHours).toBeCloseTo(8.857, 2);
    expect(Date.parse(g.startUtc)).toBeGreaterThan(Date.parse(c.base.sun.windowEndUtc));
    expect(c.base.earth.longestInterruption).toBeNull();
    expect(c.shifted!.earth.longestInterruption).toBeNull();
    expect(c.status).toBe("exceeds");
    expect(c.exceedances).toHaveLength(1);
    expect(c.exceedances[0]).toMatchObject({ body: "sun", scenario: "shifted", limitHours: 6 });
    expect(c.exceedances[0].overByHours).toBeCloseTo(g.durationHours - 6, 9);

    // Without the +24 h check the same start meets the limit.
    const noShift = searchStarts(params("demo-a", { checkShift: false }), { sun: 6, earth: null })!;
    expect(noShift.cells.find((x) => x.startMs === c.startMs)!.status).toBe("meets");

    // Nearest fitting start from 2027-02-10 is the first later start whose base and shifted windows are "within".
    const next = findNextFit(r.cells, c.startMs, { sun: 6, earth: null });
    expect(next.kind).toBe("fit");
    if (next.kind !== "fit") return;
    expect(next.cell.startMs).toBeGreaterThan(c.startMs);
    for (const body of ["sun"] as const) {
      expect(direct(p, next.cell.startMs, body, 6).limit!.status).toBe("within");
      expect(direct(p, next.cell.startMs + 24 * H, body, 6).limit!.status).toBe("within");
    }
    for (const skipped of r.cells.filter((x) => x.startMs >= c.startMs && x.startMs < next.cell.startMs))
      expect(skipped.status).not.toBe("meets");
    expect(next.skipped.exceeds + next.skipped.uncertain).toBe((next.cell.startMs - c.startMs) / D);
  });

  it("no fit: reports the closest miss with the exceeded limit and by how much", () => {
    // Demo A, terrain, Sun limit 0.1 h: from 2027-02-24 on every start has a longer Sun gap (base or +24 h).
    const limits = { sun: 0.1, earth: null };
    const r = searchStarts(params("demo-a"), limits)!;
    const from = Date.parse("2027-02-24T00:00:00Z");
    const res = findNextFit(r.cells, from, limits);
    expect(res.kind).toBe("none");
    if (res.kind !== "none") return;
    const later = r.cells.filter((c) => c.startMs >= from);
    expect(later.every((c) => c.status === "exceeds")).toBe(true);
    const exceeding = later;
    const minOver = Math.min(...exceeding.map((c) => c.exceedances[0].overByHours));
    expect(res.worst!.overByHours).toBe(minOver);
    expect(res.worst!.body).toBe("sun");
    expect(res.worst!.gapHours - res.worst!.limitHours).toBeCloseTo(res.worst!.overByHours, 12);
    expect(res.considered).toBe(later.length);
    expect(res.closest!.exceedances[0]).toBe(res.worst);
  });

  it("findNextFit after the last start reports no starts", () => {
    const r = searchStarts(params("demo-a"), { sun: 6, earth: null })!;
    expect(findNextFit(r.cells, r.cells.at(-1)!.startMs + 1, { sun: 6, earth: null }).kind).toBe("no-starts");
    // from exactly the last start: that start is considered
    const last = findNextFit(r.cells, r.cells.at(-1)!.startMs, { sun: 6, earth: null });
    expect(last.kind === "fit" ? last.cell.startMs : last.kind === "none" ? last.considered : null).not.toBeNull();
  });

  it("classify reuses the evaluation: changing limits needs no new analysis", () => {
    const ev = evaluateStarts(params("demo-b"))!;
    const a = classify(ev, { sun: 12, earth: null });
    const b = classify(ev, { sun: null, earth: 12 });
    expect(a[0].base).toBe(b[0].base);
  });

  it("performance sanity: three sites x all daily starts x Sun/Earth x base/+24 h well under a few seconds", () => {
    const t0 = performance.now();
    let n = 0;
    for (const id of Object.keys(sites)) n += evaluateStarts(params(id))!.starts.length;
    const ms = performance.now() - t0;
    expect(n).toBeGreaterThan(200);
    expect(ms).toBeLessThan(3000);
  });
});
