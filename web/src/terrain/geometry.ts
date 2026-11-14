import type { BodyId, HorizonInput, SiteDataset } from "../contract/types";
import { horizonElevationAt } from "../analysis/visibility";

/** Clockwise from north, Y up, Z south, in the same local frame as the exported GLB. */
export function directionFromAzEl(azDeg: number, elDeg: number): [number, number, number] {
  const az = azDeg * Math.PI / 180;
  const el = elDeg * Math.PI / 180;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
}

export interface BodyDirection {
  az: number;
  el: number;
  horizon: number;
  margin: number;
  near: boolean;
}
export type Directions = Record<BodyId, BodyDirection | null>;

export function directionsAt(site: SiteDataset, horizon: HorizonInput, index: number): Directions {
  const get = (body: BodyId): BodyDirection | null => {
    const t = site.ephemeris.bodies[body];
    const az = t.azDeg[index];
    const el = t.elDeg[index];
    if (az == null || el == null || !Number.isFinite(az) || !Number.isFinite(el)) return null;
    const h = horizonElevationAt(horizon, az);
    const margin = el - h;
    return { az, el, horizon: h, margin, near: Math.abs(margin) <= horizon.uncertaintyDeg + t.angularRadiusDeg.max };
  };
  return { sun: get("sun"), earth: get("earth") };
}

export interface TerrainMetadata {
  schemaVersion: number;
  siteId: string;
  sourceProduct: string;
  sourceResolutionM: number;
  sourceSha256: string;
  localAxes: string;
  units: string;
  referenceRadiusM: number;
  verticalExaggeration: number;
  origin: { latDeg: number; lonEastDeg: number; surfaceElevationM: number };
  bytes: number;
  sha256: string;
}

export function validateTerrainMetadata(meta: TerrainMetadata, site: SiteDataset) {
  if (site.synthetic || !site.horizons.terrain || meta.schemaVersion !== 1 || meta.siteId !== site.site.id ||
      meta.sourceProduct !== site.horizons.terrain.dem.product || meta.localAxes !== "east,up,south" ||
      meta.units !== "metres" || meta.referenceRadiusM !== site.site.referenceRadiusM || meta.verticalExaggeration !== 1 ||
      meta.origin.latDeg !== site.site.latDeg || meta.origin.lonEastDeg !== site.site.lonEastDeg ||
      site.site.surfaceElevationM === null || !Number.isFinite(meta.origin.surfaceElevationM) ||
      Math.abs(meta.origin.surfaceElevationM - site.site.surfaceElevationM) > 0.01 ||
      !Number.isInteger(meta.bytes) || meta.bytes < 20 || meta.bytes > 40_000_000 || !/^[a-f0-9]{64}$/.test(meta.sha256)) {
    throw new Error("The terrain model does not match this site's coordinates or source data.");
  }
}
