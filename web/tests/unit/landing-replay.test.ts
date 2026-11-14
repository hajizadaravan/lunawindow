import { describe, expect, it } from "vitest";
import {
  buildReplayGeometry,
  fractionAt,
  horizonAt,
  niceTicks,
  pointAt,
  tickLabel,
  timeAtFraction,
  type ReplayBox,
} from "../../src/landing/replayGeometry";
import type { SunReplay } from "../../src/landing/types";

const H = 3_600_000;
const T0 = Date.parse("2027-02-17T00:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

/**
 * A hand-built replay: flat horizon at 0 deg except a 1 deg ridge between az 100 and 104. The Sun moves from az 106
 * down to az 98 (decreasing, like the real data near the pole) at 0.5 deg elevation, one sample per hour, so it is
 * behind the ridge while its azimuth is inside it.
 */
function replay(): SunReplay {
  const profile = [
    { azDeg: 95, elDeg: 0 },
    { azDeg: 99.5, elDeg: 0 },
    { azDeg: 100, elDeg: 1 },
    { azDeg: 104, elDeg: 1 },
    { azDeg: 104.5, elDeg: 0 },
    { azDeg: 110, elDeg: 0 },
  ];
  const samples: SunReplay["samples"] = [];
  for (let k = 0; k <= 16; k++) {
    const az = 106 - k * 0.5;
    const el = 0.5;
    const h = horizonAt(profile, az);
    samples.push({ utc: iso(T0 + k * H), azDeg: az, elDeg: el, state: el - h > 0 ? "visible" : "blocked" });
  }
  // margin crosses zero at az 104.25 (k = 3.5) and az 99.75 (k = 12.5)
  return {
    siteName: "Test point",
    horizonLabel: "Test horizon",
    windowStartUtc: iso(T0 - 24 * H),
    windowEndUtc: iso(T0 + 48 * H),
    gapStartUtc: iso(T0 + 3.5 * H),
    gapEndUtc: iso(T0 + 12.5 * H),
    gapHours: 9,
    profile,
    samples,
  };
}

const BOX: ReplayBox = { width: 1000, height: 400, pad: { top: 20, right: 20, bottom: 30, left: 50 } };

describe("horizonAt", () => {
  it("interpolates linearly and holds the ends", () => {
    const p = replay().profile;
    expect(horizonAt(p, 99.75)).toBeCloseTo(0.5, 10);
    expect(horizonAt(p, 102)).toBe(1);
    expect(horizonAt(p, 50)).toBe(0);
    expect(horizonAt(p, 200)).toBe(0);
    expect(horizonAt([], 1)).toBe(0);
  });
});

describe("buildReplayGeometry", () => {
  const g = buildReplayGeometry(replay(), BOX)!;

  it("runs time left to right even though the azimuth decreases", () => {
    expect(g.azAscending).toBe(false);
    const first = g.samples[0];
    const last = g.samples[g.samples.length - 1];
    expect(g.x(first.az)).toBeLessThan(g.x(last.az));
    expect(g.x(g.azRange[1])).toBeCloseTo(BOX.pad.left, 6);
    expect(g.x(g.azRange[0])).toBeCloseTo(BOX.width - BOX.pad.right, 6);
  });

  it("keeps every drawn point inside the plot box", () => {
    for (const s of g.samples) {
      expect(g.y(s.el)).toBeGreaterThanOrEqual(BOX.pad.top);
      expect(g.y(s.el)).toBeLessThanOrEqual(BOX.height - BOX.pad.bottom);
    }
    expect(g.y(1)).toBeGreaterThanOrEqual(BOX.pad.top);
  });

  it("splits the track into visible, blocked, visible at the margin's zero crossings", () => {
    expect(g.runs.map((r) => r.state)).toEqual(["visible", "blocked", "visible"]);
    // The blocked run starts and ends where the gap does.
    const blocked = g.runs[1].d;
    const start = blocked.match(/^M([\d.]+) ([\d.]+)/)!;
    expect(Number(start[1])).toBeCloseTo(g.gapStart!.x, 1);
    expect(Number(start[2])).toBeCloseTo(g.gapStart!.y, 1);
    expect(blocked.endsWith(`${g.gapEnd!.x.toFixed(2)} ${g.gapEnd!.y.toFixed(2)}`)).toBe(true);
  });

  it("closes the ground path along the bottom of the plot", () => {
    expect(g.groundPath.endsWith("Z")).toBe(true);
    expect(g.groundPath).toContain(` ${(BOX.height - BOX.pad.bottom).toFixed(2)}L`);
  });

  it("reports how much elevation is stretched relative to azimuth", () => {
    const pxPerDegY = (BOX.height - BOX.pad.top - BOX.pad.bottom) / (g.elRange[1] - g.elRange[0]);
    const pxPerDegX = (BOX.width - BOX.pad.left - BOX.pad.right) / (g.azRange[1] - g.azRange[0]);
    expect(g.exaggeration).toBeCloseTo(pxPerDegY / pxPerDegX, 9);
  });

  it("returns null when there is nothing to draw", () => {
    expect(buildReplayGeometry({ ...replay(), samples: replay().samples.slice(0, 1) }, BOX)).toBeNull();
    expect(buildReplayGeometry({ ...replay(), profile: [] }, BOX)).toBeNull();
  });
});

describe("pointAt / scrub fractions", () => {
  const r = replay();
  const g = buildReplayGeometry(r, BOX)!;

  it("maps fractions to times over the sample span and back", () => {
    expect(timeAtFraction(g, 0)).toBe(T0);
    expect(timeAtFraction(g, 1)).toBe(T0 + 16 * H);
    expect(timeAtFraction(g, 2)).toBe(T0 + 16 * H);
    expect(fractionAt(g, T0 + 4 * H)).toBeCloseTo(0.25, 12);
    expect(fractionAt(g, T0 - H)).toBe(0);
  });

  it("interpolates position and margin like the analysis (linear in time between samples)", () => {
    const p = pointAt(g, fractionAt(g, T0 + 1.5 * H));
    expect(p.azDeg).toBeCloseTo(105.25, 9);
    expect(p.elDeg).toBeCloseTo(0.5, 9);
    expect(p.marginDeg).toBeCloseTo(0.5, 9);
    expect(p.state).toBe("visible");
    expect(p.pos.x).toBeCloseTo(g.x(105.25), 9);
  });

  it("is blocked inside the gap and visible after it", () => {
    const mid = pointAt(g, fractionAt(g, T0 + 8 * H));
    expect(mid.state).toBe("blocked");
    expect(mid.marginDeg).toBeCloseTo(-0.5, 9);
    expect(mid.horizonDeg).toBe(1);
    expect(pointAt(g, fractionAt(g, T0 + 14 * H)).state).toBe("visible");
  });

  it("treats time next to a sample marked unknown as unknown, without using its coordinates or drawing across it", () => {
    const withGap = replay();
    withGap.samples[10] = { ...withGap.samples[10], azDeg: 0, elDeg: 0, state: "unknown" };
    const g2 = buildReplayGeometry(withGap, BOX)!;
    for (const h of [9.5, 10, 10.5]) {
      const p = pointAt(g2, fractionAt(g2, T0 + h * H));
      expect(p.state).toBe("unknown");
      expect(p.marginDeg).toBeNull();
      expect(p.azDeg).toBe(101.5); // held at the last known sample (k = 9)
    }
    expect(g2.runs.map((x) => x.state)).toEqual(["visible", "blocked", "blocked", "visible"]); // no segment across the hole
    // The placeholder el = 0 does not stretch the elevation axis.
    expect(g2.elRange).toEqual(buildReplayGeometry(replay(), BOX)!.elRange);
  });

  it("treats a hole in the time grid (a dropped sample) as unknown", () => {
    const dropped = replay();
    dropped.samples.splice(10, 1);
    const g2 = buildReplayGeometry(dropped, BOX)!;
    expect(pointAt(g2, fractionAt(g2, T0 + 10 * H)).state).toBe("unknown");
    expect(g2.runs.map((x) => x.state)).toEqual(["visible", "blocked", "blocked", "visible"]); // no segment across the hole
    expect(pointAt(g2, fractionAt(g2, T0 + 11.5 * H)).state).toBe("blocked");
  });
});

describe("ticks", () => {
  it("covers the range with round steps", () => {
    expect(niceTicks(0.13, 0.97, 4)).toEqual([0.2, 0.4, 0.6, 0.8]);
    expect(niceTicks(176.2, 187.4, 6)).toEqual([178, 180, 182, 184, 186]);
    expect(niceTicks(5, 5, 3)).toEqual([5]);
  });

  it("labels with the step's decimals, a true minus sign and a degree sign", () => {
    expect(tickLabel(-0.7, [-0.8, -0.7])).toBe("−0.7°");
    expect(tickLabel(180, [178, 180])).toBe("180°");
    expect(tickLabel(-0.0000001, [-0.2, 0])).toBe("0.0°");
  });
});
