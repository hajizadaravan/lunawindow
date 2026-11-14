import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SiteDataset } from "../../src/contract/types";
import { directionFromAzEl, directionsAt, validateTerrainMetadata, type TerrainMetadata } from "../../src/terrain/geometry";
import { marginAt, sampleState } from "../../src/analysis/visibility";

const site: SiteDataset = JSON.parse(readFileSync(new URL("../../public/data/sites/demo-a.json", import.meta.url), "utf8"));

describe("3D coordinate and analysis agreement", () => {
  it("places cardinal directions in an east/up/south frame without mirroring", () => {
    for (const [az, expected] of [[0, [0, 0, -1]], [90, [1, 0, 0]], [180, [0, 0, 1]], [270, [-1, 0, 0]]] as const) {
      directionFromAzEl(az, 0).forEach((v, i) => expect(v).toBeCloseTo(expected[i], 12));
    }
    expect(directionFromAzEl(50, 90)[1]).toBeCloseTo(1, 12);
  });
  it("matches the existing visibility core at every real sample in both modes", () => {
    for (const horizon of [site.horizons.geometric, site.horizons.terrain!]) {
      for (let i = 0; i < site.time.count; i++) {
        const d = directionsAt(site, horizon, i);
        for (const body of ["sun", "earth"] as const) {
          const t = site.ephemeris.bodies[body];
          const m = marginAt(horizon, t.azDeg[i], t.elDeg[i]);
          expect(d[body]?.margin ?? null).toBe(m);
          expect(d[body] === null ? "unknown" : d[body]!.margin > 0 ? "visible" : "blocked").toBe(sampleState(m));
        }
      }
    }
  });
  it("does not invent directions outside the data range", () => {
    expect(directionsAt(site, site.horizons.terrain!, site.time.count)).toEqual({ sun: null, earth: null });
  });
  it("rejects a terrain model for another coordinate or vertical datum", () => {
    const meta: TerrainMetadata = {
      schemaVersion: 1, siteId: site.site.id, sourceProduct: site.horizons.terrain!.dem.product,
      sourceResolutionM: 40, sourceSha256: "a".repeat(64), localAxes: "east,up,south", units: "metres",
      referenceRadiusM: 1737400, verticalExaggeration: 1,
      origin: { latDeg: site.site.latDeg, lonEastDeg: site.site.lonEastDeg, surfaceElevationM: site.site.surfaceElevationM! },
      file: "demo-a.glb", bytes: 100, sha256: "b".repeat(64),
    };
    const dem = "a".repeat(64);
    expect(() => validateTerrainMetadata(meta, site, dem)).not.toThrow();
    expect(() => validateTerrainMetadata({ ...meta, siteId: "demo-b" }, site, dem)).toThrow();
    expect(() => validateTerrainMetadata({ ...meta, localAxes: "east,north,up" }, site, dem)).toThrow();
    expect(() => validateTerrainMetadata({ ...meta, origin: { ...meta.origin, surfaceElevationM: meta.origin.surfaceElevationM + 1 } }, site, dem)).toThrow();
  });
  it("rejects a model built from another DEM, file or resolution, and malformed metadata", () => {
    const meta: TerrainMetadata = JSON.parse(readFileSync(new URL("../../public/data/terrain3d/demo-a.json", import.meta.url), "utf8"));
    const manifest = JSON.parse(readFileSync(new URL("../../public/data/manifest.json", import.meta.url), "utf8"));
    const dem: string = manifest.sources.find((s: { id: string }) => s.id === site.horizons.terrain!.dem.sourceId).sha256;
    expect(() => validateTerrainMetadata(meta, site, dem)).not.toThrow(); // the shipped model passes
    expect(() => validateTerrainMetadata(meta, site, "c".repeat(64))).toThrow();
    expect(() => validateTerrainMetadata(meta, site, null)).toThrow();
    expect(() => validateTerrainMetadata({ ...meta, sourceResolutionM: 5 }, site, dem)).toThrow();
    expect(() => validateTerrainMetadata({ ...meta, file: "demo-b.glb" }, site, dem)).toThrow();
    for (const bad of [null, 42, "x", {}, { ...meta, origin: null }, { ...meta, sha256: 7 }]) {
      expect(() => validateTerrainMetadata(bad, site, dem)).toThrow("does not match");
    }
    expect(() => validateTerrainMetadata(meta, { ...site, synthetic: true }, dem)).toThrow();
  });
});
