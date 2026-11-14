import type { Manifest, SiteDataset } from "../contract/types";

const dataDir = (import.meta.env.VITE_DATA_DIR as string | undefined) ?? "data";

/**
 * URL of a file inside the data dir. Only plain relative paths that stay inside it are accepted
 * (no scheme, no leading slash or backslash, no ".." segment).
 */
export function dataUrl(relative: string): string {
  if (
    /^[a-z][a-z0-9+.-]*:/i.test(relative) ||
    relative.startsWith("/") ||
    relative.includes("\\") ||
    relative.split("/").includes("..")
  )
    throw new DataLoadError(`Refusing data path outside the data folder: ${relative}`);
  return `${import.meta.env.BASE_URL}${dataDir}/${relative}`;
}

export class DataLoadError extends Error {}

async function getJson<T>(relative: string): Promise<T> {
  const url = dataUrl(relative);
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-cache" });
  } catch (e) {
    throw new DataLoadError(`Could not reach ${url}: ${(e as Error).message}`);
  }
  if (!res.ok) throw new DataLoadError(`${url} returned HTTP ${res.status}`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new DataLoadError(`${url} is not valid JSON (the dev server may have returned an HTML fallback page)`);
  }
}

export async function loadManifest(): Promise<Manifest> {
  const m = await getJson<Manifest>("manifest.json");
  if (m.contractVersion !== "1.0.0")
    throw new DataLoadError(`manifest.json has contractVersion ${m.contractVersion}; this app expects 1.0.0`);
  if (!Array.isArray(m.sites) || m.sites.length === 0) throw new DataLoadError("manifest.json lists no sites");
  return m;
}

export async function loadSite(file: string): Promise<SiteDataset> {
  const s = await getJson<SiteDataset>(file);
  if (s.contractVersion !== "1.0.0")
    throw new DataLoadError(`${file} has contractVersion ${s.contractVersion}; this app expects 1.0.0`);
  const { count } = s.time;
  for (const b of ["sun", "earth"] as const) {
    const t = s.ephemeris.bodies[b];
    if (t.azDeg.length !== count || t.elDeg.length !== count)
      throw new DataLoadError(`${file}: ${b} track length does not match time.count (${count})`);
  }
  const terrain = s.horizons.terrain;
  if (terrain) {
    // A malformed profile would still be labelled "Terrain (LOLA)" and give wrong gap hours, so refuse it.
    const n = terrain.elevationDeg.length;
    const wholeCircle = Math.abs(n * terrain.azimuthStepDeg - 360) < 1e-6;
    const finite = terrain.elevationDeg.every((v) => typeof v === "number" && Number.isFinite(v));
    if (n === 0 || !wholeCircle || !finite || terrain.distanceM.length !== n || terrain.coverageLimited.length !== n)
      throw new DataLoadError(`${file}: terrain horizon profile is malformed (bins must be finite and cover 360°)`);
  }
  return s;
}

export const DATA_DIR = dataDir;
