#!/usr/bin/env node
// Emits a contract-valid (docs/data-contract.md v1.0.0) SYNTHETIC dataset into web/public/data-synthetic/.
// These are made-up smooth curves for UI development only. They are NOT NASA measurements and must never be
// copied into web/public/data/. manifest.synthetic = true makes the UI show a permanent banner.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "public", "data-synthetic");
mkdirSync(join(outDir, "sites"), { recursive: true });

const START = Date.parse("2027-01-01T00:00:00Z");
const STEP = 900; // seconds
const DAYS = 60;
const COUNT = (DAYS * 86400) / STEP + 1;
const iso = (ms) => new Date(ms).toISOString().replace(".000Z", "Z");
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const DEG = Math.PI / 180;

let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

const SYNODIC_D = 29.530589;
const DRACONIC_D = 27.212221;
const ANOMALISTIC_D = 27.554550;

function sunTrack(site, gaps) {
  const az = [];
  const el = [];
  const colat = 90 + site.latDeg;
  for (let i = 0; i < COUNT; i++) {
    const tDays = (i * STEP) / 86400;
    const sunLon = (360 * tDays) / SYNODIC_D + 40; // sub-solar longitude drifts once per synodic month
    const dec = -1.54 * Math.sin((2 * Math.PI * tDays) / 173.3); // made-up seasonal tilt
    const dLon = (sunLon - site.lonEastDeg) * DEG;
    const e = dec + colat * Math.cos(dLon);
    const a = ((site.lonEastDeg + 180 - (sunLon - site.lonEastDeg)) % 360 + 360) % 360;
    az.push(r4(a));
    el.push(r4(e));
  }
  for (const [s, n] of gaps) for (let i = s; i < s + n && i < COUNT; i++) (az[i] = null), (el[i] = null);
  return {
    horizonsCommand: "10",
    azDeg: az,
    elDeg: el,
    angularRadiusDeg: { min: 0.2617, mean: 0.2666, max: 0.2717 },
    rawFile: "synthetic/none",
    rawSha256: "0".repeat(64),
  };
}

function earthTrack(site) {
  const az = [];
  const el = [];
  const colat = 90 + site.latDeg;
  for (let i = 0; i < COUNT; i++) {
    const tDays = (i * STEP) / 86400;
    const libLat = 6.7 * Math.sin((2 * Math.PI * tDays) / DRACONIC_D);
    const libLon = 7.9 * Math.sin((2 * Math.PI * tDays) / ANOMALISTIC_D + 1.1);
    const dLon = (libLon - site.lonEastDeg) * DEG;
    const e = libLat * 0.35 + colat * Math.cos(dLon) - 0.4;
    const a = ((site.lonEastDeg + 180 - (libLon - site.lonEastDeg)) % 360 + 360) % 360;
    az.push(r4(a));
    el.push(r4(e));
  }
  return {
    horizonsCommand: "399",
    azDeg: az,
    elDeg: el,
    angularRadiusDeg: { min: 0.9, mean: 0.95, max: 1.0 },
    rawFile: "synthetic/none",
    rawSha256: "0".repeat(64),
  };
}

function terrain(peaks) {
  const step = 1;
  const elevationDeg = [];
  const distanceM = [];
  const coverageLimited = [];
  for (let k = 0; k < 360 / step; k++) {
    let v = 0.15 + 0.1 * Math.sin(k * DEG * 3) + 0.05 * rand();
    for (const [c, h, w] of peaks) {
      const d = Math.min(Math.abs(k - c), 360 - Math.abs(k - c));
      v += h * Math.exp(-(d * d) / (2 * w * w));
    }
    elevationDeg.push(r4(v));
    distanceM.push(Math.round(8000 + 40000 * rand()));
    coverageLimited.push(k >= 300 && k < 306);
  }
  return {
    kind: "terrain",
    id: "terrain-lola",
    label: "Terrain horizon from LOLA elevation data",
    azimuthStepDeg: step,
    elevationDeg,
    distanceM,
    coverageLimited,
    searchExtentM: 150000,
    nearFieldStartM: 120,
    curvatureModel: "SYNTHETIC: made-up profile, no curvature model applied",
    uncertaintyDeg: 0.1,
    dem: {
      sourceId: "synthetic",
      product: "SYNTHETIC (no DEM)",
      resolutionM: 0,
      projection: "none",
      heightReference: "none",
      scaling: "none",
    },
    assumptions: ["SYNTHETIC profile drawn from sine waves and Gaussian ridges. Not derived from LOLA."],
  };
}

const sites = [
  { id: "demo-a", name: "Demo point A", locationHint: "synthetic ridge", latDeg: -89.45, lonEastDeg: 222.7,
    peaks: [[350, 1.4, 6], [120, 0.9, 10]], gaps: [] },
  { id: "demo-b", name: "Demo point B", locationHint: "synthetic crater rim", latDeg: -89.78, lonEastDeg: 204.3,
    peaks: [[60, 1.1, 8], [250, 0.6, 15]], gaps: [[2000, 30]] },
  { id: "demo-c", name: "Demo point C", locationHint: "synthetic plain", latDeg: -88.8, lonEastDeg: 128.5,
    peaks: null, gaps: [[700, 12]] },
];

const sources = [
  { id: "synthetic", title: "SYNTHETIC test generator (not NASA data)", url: "about:blank",
    usedFor: "Every number in this dataset", retrievedAtUtc: null, citation: null, sha256: null },
];

for (const s of sites) {
  const ds = {
    contractVersion: "1.0.0",
    synthetic: true,
    site: {
      id: s.id, name: s.name, locationHint: s.locationHint,
      description: "Synthetic demonstration point for interface testing.",
      latDeg: s.latDeg, lonEastDeg: s.lonEastDeg,
      frame: "SYNTHETIC (no frame; made-up geometry)",
      frameNote: "Synthetic data: frame realisation not applicable.",
      referenceRadiusM: 1737400,
      surfaceElevationM: s.peaks ? 1200 : null,
      observerHeightM: 2,
      observerAltitudeM: (s.peaks ? 1200 : 0) + 2,
      siteChecks: ["SYNTHETIC: nothing was checked against terrain data."],
    },
    time: { startUtc: iso(START), stepSeconds: STEP, count: COUNT, scale: "UTC" },
    ephemeris: {
      sourceId: "synthetic",
      query: { NOTE: "synthetic, no Horizons query made", STEP_SIZE: `${STEP / 60} m` },
      retrievedAtUtc: iso(Date.now()),
      corrections: "SYNTHETIC: smooth made-up curves, no corrections",
      bodies: { sun: sunTrack(s, s.gaps), earth: earthTrack(s) },
    },
    horizons: {
      geometric: {
        kind: "geometric", id: "geometric-reference",
        label: "Geometric reference horizon (no terrain)",
        elevationDeg: 0, uncertaintyDeg: 0,
        assumptions: ["Local horizontal plane perpendicular to the radial direction on a 1737400 m sphere."],
      },
      terrain: s.peaks ? terrain(s.peaks) : null,
    },
  };
  writeFileSync(join(outDir, "sites", `${s.id}.json`), JSON.stringify(ds));
}

const manifest = {
  contractVersion: "1.0.0",
  synthetic: true,
  generatedAtUtc: iso(Date.now()),
  generator: { name: "web/scripts/make-synthetic-data.mjs", version: "0.1.0" },
  supportedRange: { startUtc: iso(START), endUtc: iso(START + (COUNT - 1) * STEP * 1000), stepSeconds: STEP },
  defaults: { siteId: "demo-a", durationHours: 168, shiftHours: 24 },
  sites: sites.map((s) => ({
    id: s.id, name: s.name, locationHint: s.locationHint, latDeg: s.latDeg, lonEastDeg: s.lonEastDeg,
    file: `sites/${s.id}.json`, hasTerrainHorizon: Boolean(s.peaks),
  })),
  map: null,
  sources,
  disclaimers: [
    "SYNTHETIC TEST DATA. Every value here is made up for interface development and is not a NASA measurement.",
  ],
};
writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`Wrote synthetic dataset (${sites.length} sites, ${COUNT} samples each) to ${outDir}`);
