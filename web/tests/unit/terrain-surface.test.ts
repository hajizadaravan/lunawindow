import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SiteDataset } from "../../src/contract/types";
import { marginAt, sampleState } from "../../src/analysis/visibility";
import { fmtDeg } from "../../src/analysis/format";
import { directionsAt, displaySkylineAt, validateDisplaySkyline, type DisplaySkyline, type TerrainMetadata } from "../../src/terrain/geometry";
import { surfaceCheck, surfaceNote } from "../../src/terrain/playback";

const read = <T,>(path: string): T => JSON.parse(readFileSync(new URL(`../../public/data/${path}`, import.meta.url), "utf8"));
const IDS = ["demo-a", "demo-b", "demo-c"] as const;

describe("drawn-surface skyline files", () => {
  it("each shipped skyline belongs to its site's terrain bins and to its exact GLB", () => {
    for (const id of IDS) {
      const site = read<SiteDataset>(`sites/${id}.json`);
      const meta = read<TerrainMetadata>(`terrain3d/${id}.json`);
      const skyline = read<unknown>(`terrain3d/${id}.skyline.json`);
      expect(() => validateDisplaySkyline(skyline, site, meta.sha256)).not.toThrow();
      expect(() => validateDisplaySkyline(skyline, site, "0".repeat(64))).toThrow();
    }
  });

  it("rejects a skyline for another site, bin layout, mast height or with a bad value", () => {
    const site = read<SiteDataset>("sites/demo-a.json");
    const meta = read<TerrainMetadata>("terrain3d/demo-a.json");
    const good = read<DisplaySkyline>("terrain3d/demo-a.skyline.json");
    const bad: unknown[] = [
      { ...good, siteId: "demo-b" },
      { ...good, schemaVersion: 2 },
      { ...good, azimuthStepDeg: 1 },
      { ...good, observerHeightM: 10 },
      { ...good, horizonId: "geometric-reference" },
      { ...good, elevationDeg: good.elevationDeg.slice(1) },
      { ...good, elevationDeg: good.elevationDeg.map((v, i) => (i === 3 ? Number.NaN : v)) },
      { ...good, elevationDeg: good.elevationDeg.map((v, i) => (i === 3 ? "1" : v)) },
      { ...good, elevationDeg: good.elevationDeg.map((v, i) => (i === 3 ? 91 : v)) },
      null, "skyline", [],
    ];
    for (const raw of bad) expect(() => validateDisplaySkyline(raw, site, meta.sha256)).toThrow();
  });
});

describe("drawn surface against the analysis result", () => {
  const skyline = (bins: (number | null)[]): DisplaySkyline => ({
    schemaVersion: 1, siteId: "demo-a", glbSha256: "a".repeat(64), horizonId: "terrain-lola", observerHeightM: 2,
    azimuthStepDeg: 360 / bins.length, elevationDeg: bins,
  });
  const dir = (az: number, el: number, horizon = 0) => ({ az, el, horizon, margin: el - horizon, near: false });

  it("interpolates between bins as the analysis does, across 0°, and gives up next to a bin without surface", () => {
    const s = skyline([1, 2, 3, null]);
    expect(displaySkylineAt(s, 45)).toBeCloseTo(1.5, 12);
    expect(displaySkylineAt(s, 360 + 90)).toBeCloseTo(2, 12);
    expect(displaySkylineAt(s, -315)).toBeCloseTo(1.5, 12);
    expect(displaySkylineAt(s, 200)).toBeNull();
    expect(displaySkylineAt(s, 300)).toBeNull();
  });

  it("flags only a real contradiction and never touches the state", () => {
    const s = skyline([1, 1, 1, 1]);
    expect(surfaceCheck(s, dir(10, 1.5), "visible").agreement).toBe("agrees");
    expect(surfaceCheck(s, dir(10, 0.5), "blocked").agreement).toBe("agrees");
    expect(surfaceCheck(s, dir(10, 0.5), "visible")).toEqual({ agreement: "differs", surfaceDeg: 1 });
    expect(surfaceCheck(s, dir(10, 1.5), "blocked").agreement).toBe("differs");
    // A centre exactly on the drawn skyline is hidden on screen, as the analysis treats a zero margin.
    expect(surfaceCheck(s, dir(10, 1), "visible").agreement).toBe("differs");
    expect(surfaceCheck(s, dir(10, 1.5), "unknown").agreement).toBe("unchecked");
    expect(surfaceCheck(s, null, "visible").agreement).toBe("unchecked");
    expect(surfaceCheck(null, dir(10, 1.5), "visible").agreement).toBe("unchecked");
  });

  it("finds the same contradictions over every real sample as the pipeline measured (A: 369 Sun, 146 Earth)", () => {
    // Counted independently in Python from the same files when the skyline export was added (2026-11-14).
    const expected = { "demo-a": { sun: 369, earth: 146 }, "demo-b": { sun: 69, earth: 8 }, "demo-c": { sun: 35, earth: 2 } };
    for (const id of IDS) {
      const site = read<SiteDataset>(`sites/${id}.json`);
      const s = read<DisplaySkyline>(`terrain3d/${id}.skyline.json`);
      const horizon = site.horizons.terrain!;
      const count = { sun: 0, earth: 0 };
      for (let i = 0; i < site.time.count; i++) {
        const d = directionsAt(site, horizon, i);
        for (const body of ["sun", "earth"] as const) {
          const t = site.ephemeris.bodies[body];
          const state = sampleState(marginAt(horizon, t.azDeg[i], t.elDeg[i]));
          if (surfaceCheck(s, d[body], state).agreement === "differs") count[body]++;
        }
      }
      expect(count).toEqual(expected[id]);
    }
  });

  it("words the note from the active mode and the numbers shown", () => {
    const check = { agreement: "differs" as const, surfaceDeg: 1.42 };
    const terrain = surfaceNote("Sun", check, dir(10, 1.3, 1.18), "visible", false, "LOLA 40 m terrain from 80 m out", v => fmtDeg(v));
    expect(terrain).toContain("rises to 1.42°");
    expect(terrain).toContain("hides the Sun centre (1.30°)");
    expect(terrain).toContain("analysis horizon, 1.18° here (LOLA 40 m terrain from 80 m out)");
    const geometric = surfaceNote("Earth", { agreement: "differs", surfaceDeg: 0.4 }, dir(10, 0.9), "blocked", false, null, v => fmtDeg(v));
    expect(geometric).toContain("leaves the Earth centre (0.90°) clear on screen");
    expect(geometric).toContain("flat 0° geometric horizon");
    expect(surfaceNote("Sun", { agreement: "agrees", surfaceDeg: 1 }, dir(10, 2), "visible", false, null, v => fmtDeg(v))).toBeNull();
    expect(terrain).not.toContain("uncertain either way");
    // The sentence follows the analysis near-horizon flag it is given, not the interpolated direction's own flag.
    const near = surfaceNote("Sun", check, dir(10, 1.3, 1.18), "visible", true, "x", v => fmtDeg(v));
    expect(surfaceNote("Sun", check, { ...dir(10, 1.3, 1.18), near: true }, "visible", false, "x", v => fmtDeg(v))).not.toContain("uncertain");
    expect(near).toContain("within the near-horizon band, so this moment is uncertain either way");
  });
});
