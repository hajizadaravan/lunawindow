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

/** Signed azimuth change from a to b the short way round, in (-180, 180]. */
export function shortAzimuthDelta(aDeg: number, bDeg: number): number {
  const d = (((bDeg - aDeg) % 360) + 540) % 360 - 180;
  return d === -180 ? 180 : d;
}

/**
 * Directions at a fractional dataset index. Between samples, azimuth (the short way across 0°/360°) and elevation are
 * linearly interpolated, as docs/data-contract.md section 4 treats the time between samples. A missing sample on
 * either side gives no direction. At an integer index this is exactly directionsAt.
 */
export function directionsAtPosition(site: SiteDataset, horizon: HorizonInput, position: number): Directions {
  if (!Number.isFinite(position)) return { sun: null, earth: null };
  const k = Math.floor(position);
  const f = position - k;
  const a = directionsAt(site, horizon, k);
  if (f === 0) return a;
  const b = directionsAt(site, horizon, k + 1);
  const mix = (body: BodyId): BodyDirection | null => {
    const p = a[body];
    const q = b[body];
    if (!p || !q) return null;
    const az = (((p.az + shortAzimuthDelta(p.az, q.az) * f) % 360) + 360) % 360;
    const el = p.el + (q.el - p.el) * f;
    const h = horizonElevationAt(horizon, az);
    const margin = el - h;
    const band = horizon.uncertaintyDeg + site.ephemeris.bodies[body].angularRadiusDeg.max;
    return { az, el, horizon: h, margin, near: Math.abs(margin) <= band };
  };
  return { sun: mix("sun"), earth: mix("earth") };
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
  file: string;
  bytes: number;
  sha256: string;
}

/**
 * Throws unless the model metadata belongs to this site and was built from the same DEM as its terrain horizon.
 * demSha256 is the pinned sha256 of that DEM from the manifest sources (null when the manifest has none).
 */
export function validateTerrainMetadata(raw: unknown, site: SiteDataset, demSha256: string | null): asserts raw is TerrainMetadata {
  const meta = raw as Partial<TerrainMetadata> | null;
  const terrain = site.horizons.terrain;
  const origin = meta && typeof meta === "object" && meta.origin && typeof meta.origin === "object" ? meta.origin : null;
  if (!meta || !origin || site.synthetic || !terrain || meta.schemaVersion !== 1 || meta.siteId !== site.site.id ||
      meta.sourceProduct !== terrain.dem.product || meta.sourceResolutionM !== terrain.dem.resolutionM ||
      !demSha256 || meta.sourceSha256 !== demSha256 || meta.file !== `${site.site.id}.glb` ||
      meta.localAxes !== "east,up,south" ||
      meta.units !== "metres" || meta.referenceRadiusM !== site.site.referenceRadiusM || meta.verticalExaggeration !== 1 ||
      origin.latDeg !== site.site.latDeg || origin.lonEastDeg !== site.site.lonEastDeg ||
      site.site.surfaceElevationM === null || typeof origin.surfaceElevationM !== "number" || !Number.isFinite(origin.surfaceElevationM) ||
      Math.abs(origin.surfaceElevationM - site.site.surfaceElevationM) > 0.01 ||
      !Number.isInteger(meta.bytes) || meta.bytes! < 20 || meta.bytes! > 40_000_000 ||
      typeof meta.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(meta.sha256)) {
    throw new Error("The terrain model does not match this site's coordinates or source data.");
  }
}
