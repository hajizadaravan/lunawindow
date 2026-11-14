import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { HorizonInput, SiteDataset } from "../../src/contract/types";
import { directionsAt, directionsAtPosition, shortAzimuthDelta } from "../../src/terrain/geometry";
import { advance, DEFAULT_SPEED, PUBLISH_MS, STALL_MS, statusAt } from "../../src/terrain/playback";
import { analyzeVisibility, marginAt, sampleState } from "../../src/analysis/visibility";

const site: SiteDataset = JSON.parse(readFileSync(new URL("../../public/data/sites/demo-a.json", import.meta.url), "utf8"));
const horizons: HorizonInput[] = [site.horizons.geometric, site.horizons.terrain!];

/** A copy of the real site with the first samples of one body replaced. */
function withTrack(az: (number | null)[], el: (number | null)[]): SiteDataset {
  const copy: SiteDataset = structuredClone(site);
  const t = copy.ephemeris.bodies.sun;
  az.forEach((v, i) => (t.azDeg[i] = v));
  el.forEach((v, i) => (t.elDeg[i] = v));
  return copy;
}

describe("interpolated 3D directions", () => {
  it("equal directionsAt exactly at every integer index, in both horizon modes", () => {
    for (const horizon of horizons) {
      for (let i = 0; i < site.time.count; i += 7) {
        expect(directionsAtPosition(site, horizon, i)).toEqual(directionsAt(site, horizon, i));
      }
    }
  });

  it("take the short way across 0°/360°", () => {
    expect(shortAzimuthDelta(359, 1)).toBeCloseTo(2, 12);
    expect(shortAzimuthDelta(1, 359)).toBeCloseTo(-2, 12);
    expect(shortAzimuthDelta(10, 200)).toBeCloseTo(-170, 12);
    const s = withTrack([359, 1], [0, 2]);
    const g = site.horizons.geometric;
    expect(directionsAtPosition(s, g, 0.25).sun!.az).toBeCloseTo(359.5, 9);
    expect(directionsAtPosition(s, g, 0.5).sun!.az % 360).toBeCloseTo(0, 9);
    expect(directionsAtPosition(s, g, 0.75).sun!.az).toBeCloseTo(0.5, 9);
    expect(directionsAtPosition(s, g, 0.5).sun!.el).toBeCloseTo(1, 12);
    const back = withTrack([1, 359], [0, 0]);
    expect(directionsAtPosition(back, g, 0.25).sun!.az).toBeCloseTo(0.5, 9);
  });

  it("give no direction when either neighbouring sample is missing", () => {
    const g = site.horizons.terrain!;
    const nextMissing = withTrack([100, null], [1, null]);
    expect(directionsAtPosition(nextMissing, g, 0).sun).not.toBeNull();
    expect(directionsAtPosition(nextMissing, g, 0.5).sun).toBeNull();
    expect(directionsAtPosition(nextMissing, g, 1).sun).toBeNull();
    const prevMissing = withTrack([null, 100], [null, 1]);
    expect(directionsAtPosition(prevMissing, g, 0.01).sun).toBeNull();
    expect(directionsAtPosition(prevMissing, g, 1).sun).not.toBeNull();
    // Earth is untouched and still interpolated.
    expect(directionsAtPosition(nextMissing, g, 0.5).earth).not.toBeNull();
    expect(directionsAtPosition(site, g, site.time.count - 0.5)).toEqual({ sun: null, earth: null });
    expect(directionsAtPosition(site, g, Number.NaN)).toEqual({ sun: null, earth: null });
  });
});

describe("3D visibility state comes from the analysis intervals", () => {
  // Terrain: a real 8.9 h Sun-centre loss starts 2027-02-17 09:30:47. Geometric: the Sun centre sets 2027-02-10 10:56.
  const cases = [
    { horizon: site.horizons.terrain!, start: "2027-02-17T06:00:00Z", hours: 168 },
    { horizon: site.horizons.geometric, start: "2027-02-10T00:00:00Z", hours: 168 },
  ];
  for (const c of cases) {
    it(`matches every interval edge, gap interior and sample in ${c.horizon.id}`, () => {
      const run = (body: "sun" | "earth") =>
        analyzeVisibility({ time: site.time, track: site.ephemeris.bodies[body], horizon: c.horizon, body, windowStartUtc: c.start, durationHours: c.hours });
      const results = { sun: run("sun"), earth: run("earth") };
      const sun = results.sun.intervals;
      expect(sun.some(iv => iv.state === "blocked")).toBe(true);
      sun.forEach((iv, k) => {
        const s = Date.parse(iv.startUtc);
        const e = Date.parse(iv.endUtc);
        expect(statusAt(results, s).sun.state).toBe(iv.state);
        expect(statusAt(results, (s + e) / 2).sun.state).toBe(iv.state);
        expect(statusAt(results, e - 1).sun.state).toBe(iv.state);
        if (k > 0) expect(statusAt(results, s - 1).sun.state).toBe(sun[k - 1].state);
      });
      const t0 = Date.parse(results.sun.windowStartUtc);
      const t1 = Date.parse(results.sun.windowEndUtc);
      expect(statusAt(results, t1).sun.state).toBe(sun[sun.length - 1].state);
      expect(statusAt(results, t0 - 1).sun.state).toBe("unknown");
      expect(statusAt(results, t1 + 1).sun.state).toBe("unknown");
      // At every sample time the state agrees with the per-sample margin of the visibility core.
      const i0 = (t0 - Date.parse(site.time.startUtc)) / (site.time.stepSeconds * 1000);
      for (let k = 0; k <= (c.hours * 3600) / site.time.stepSeconds; k++) {
        const tMs = t0 + k * site.time.stepSeconds * 1000;
        for (const body of ["sun", "earth"] as const) {
          const tr = site.ephemeris.bodies[body];
          expect(statusAt(results, tMs)[body].state).toBe(sampleState(marginAt(c.horizon, tr.azDeg[i0 + k], tr.elDeg[i0 + k])));
        }
      }
    });
  }
});

describe("playback clock", () => {
  it("plays a 7-day window in about half a minute at the default speed", () => {
    const samples = (7 * 24 * 3600) / site.time.stepSeconds;
    let pos = 0;
    let ms = 0;
    for (;;) {
      const next = advance(pos, 1000 / 60, DEFAULT_SPEED, site.time.stepSeconds, samples);
      ms += 1000 / 60;
      pos = next.position;
      if (next.done) break;
    }
    expect(ms / 1000).toBeGreaterThan(25);
    expect(ms / 1000).toBeLessThan(35);
    expect(pos).toBe(samples);
  });
  it("gives the same mission time for the same real time at 16 ms and at 250 ms frames", () => {
    const run = (frameMs: number) => {
      let pos = 0;
      for (let t = 0; t < 4000; t += frameMs) pos = advance(pos, frameMs, 6, 600, 100_000).position;
      return pos;
    };
    expect(run(16)).toBeCloseTo((4000 / 16) * 16 / 1000 * 36, 9); // 6 h/s = 36 samples/s
    expect(run(250)).toBeCloseTo(run(16), 9);
    expect(run(1000)).toBeCloseTo(run(16), 9);
  });
  it("advances in mission hours per real second and counts a stall as one capped frame", () => {
    expect(advance(0, 1000 / 60, 6, 600, 1000).position).toBeCloseTo(0.6, 12);
    expect(advance(0, 250, 6, 600, 1000).position).toBeCloseTo(9, 12);
    expect(advance(0, STALL_MS, 6, 600, 1000).position).toBeCloseTo(72, 12);
    // A stall neither leaps ahead by its whole length nor freezes playback: it counts as STALL_MS.
    expect(advance(5, STALL_MS + 1, 6, 600, 1000).position).toBeCloseTo(77, 12);
    expect(advance(5, 3_600_000, 6, 600, 1000).position).toBeCloseTo(77, 12);
    // A device whose every frame is slower than STALL_MS still moves forward.
    let slow = 0;
    for (let i = 0; i < 3; i++) slow = advance(slow, STALL_MS * 2, 6, 600, 1000).position;
    expect(slow).toBeCloseTo(216, 12);
    expect(advance(10, -5, 6, 600, 1000).position).toBe(10);
    expect(advance(999.9, 100, 24, 600, 1000)).toEqual({ position: 1000, done: true });
    expect(PUBLISH_MS).toBeLessThanOrEqual(250);
  });
});
