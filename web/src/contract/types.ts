// Copied from docs/data-contract.md v1.0.0 (sections 3, 4 and 5). Do not edit independently of the contract.

// ---------- manifest.json ----------
export interface Manifest {
  contractVersion: "1.0.0";
  synthetic: boolean;
  generatedAtUtc: string;
  generator: { name: string; version: string };
  supportedRange: { startUtc: string; endUtc: string; stepSeconds: number }; // endUtc = last sample time
  defaults: { siteId: string; durationHours: number; shiftHours: number };
  sites: SiteIndexEntry[];
  map: MapInfo | null;
  sources: SourceRef[];
  disclaimers: string[];
}

export interface SiteIndexEntry {
  id: string;
  name: string;
  locationHint: string;
  latDeg: number;
  lonEastDeg: number;
  file: string;
  hasTerrainHorizon: boolean;
}

export interface MapInfo {
  image: string;
  widthPx: number;
  heightPx: number;
  projection: "south-polar-stereographic";
  referenceRadiusM: 1737400;
  xMinM: number;
  xMaxM: number;
  yMinM: number;
  yMaxM: number;
  rendering: string;
  sourceId: string;
}

export interface SourceRef {
  id: string;
  title: string;
  url: string;
  usedFor: string;
  retrievedAtUtc: string | null;
  citation: string | null;
  sha256: string | null;
}

// ---------- sites/<siteId>.json ----------
export interface SiteDataset {
  contractVersion: "1.0.0";
  synthetic: boolean;
  site: {
    id: string;
    name: string;
    locationHint: string;
    description: string;
    latDeg: number;
    lonEastDeg: number;
    frame: string;
    frameNote: string;
    referenceRadiusM: 1737400;
    surfaceElevationM: number | null;
    observerHeightM: number;
    observerAltitudeM: number;
    siteChecks: string[];
  };
  time: TimeGrid;
  ephemeris: {
    sourceId: string;
    query: Record<string, string>;
    retrievedAtUtc: string;
    corrections: string;
    bodies: { sun: BodyTrack; earth: BodyTrack };
  };
  horizons: {
    geometric: GeometricHorizon;
    terrain: TerrainHorizon | null;
  };
}

export interface TimeGrid {
  startUtc: string;
  stepSeconds: number;
  count: number;
  scale: "UTC";
}

export interface BodyTrack {
  horizonsCommand: string;
  azDeg: (number | null)[];
  elDeg: (number | null)[];
  angularRadiusDeg: { min: number; mean: number; max: number };
  rawFile: string;
  rawSha256: string;
}

export interface GeometricHorizon {
  kind: "geometric";
  id: "geometric-reference";
  label: string;
  elevationDeg: 0;
  uncertaintyDeg: 0;
  assumptions: string[];
}

export interface TerrainHorizon {
  kind: "terrain";
  id: "terrain-lola";
  label: string;
  azimuthStepDeg: number;
  elevationDeg: number[];
  distanceM: number[];
  coverageLimited: boolean[];
  searchExtentM: number;
  nearFieldStartM: number;
  curvatureModel: string;
  uncertaintyDeg: number;
  dem: {
    sourceId: string;
    product: string;
    resolutionM: number;
    projection: string;
    heightReference: string;
    scaling: string;
  };
  assumptions: string[];
}

// ---------- analysis (section 4) ----------
export type VisState = "visible" | "blocked" | "unknown";
export type BodyId = "sun" | "earth";
export type HorizonId = "geometric-reference" | "terrain-lola";
export type LimitStatus = "within" | "exceeded" | "not-exceeded-truncated" | "indeterminate-missing-data";

export interface VisInterval {
  state: VisState;
  startUtc: string;
  endUtc: string;
  durationHours: number;
  touchesWindowStart: boolean;
  touchesWindowEnd: boolean;
  adjacentToUnknown: boolean;
}

export interface AnalysisResult {
  body: BodyId;
  horizonId: HorizonId;
  horizonKind: "geometric" | "terrain";
  windowStartUtc: string;
  windowEndUtc: string;
  stepSeconds: number;
  intervals: VisInterval[];
  nearHorizonSpans: { startUtc: string; endUtc: string }[];
  nearHorizonBandDeg: number;
  visibleHours: number;
  blockedHours: number;
  unknownHours: number;
  interruptionCount: number;
  longestInterruption: (VisInterval & { boundaryTruncated: boolean }) | null;
  limit: null | {
    limitHours: number;
    status: LimitStatus;
    exceedingIntervals: VisInterval[];
  };
}

// ---------- fixtures/analysis-golden.json (section 5) ----------
export type HorizonInput =
  | GeometricHorizon
  | Pick<TerrainHorizon, "kind" | "id" | "azimuthStepDeg" | "elevationDeg" | "uncertaintyDeg">;

export interface GoldenFile {
  contractVersion: "1.0.0";
  generatedBy: string;
  toleranceHours: number;
  cases: GoldenCase[];
}

export interface GoldenCase {
  name: string;
  input:
    | {
        kind: "inline";
        time: TimeGrid;
        track: Pick<BodyTrack, "azDeg" | "elDeg" | "angularRadiusDeg">;
        horizon: HorizonInput;
      }
    | { kind: "site"; siteFile: string; horizonId: HorizonId };
  body: BodyId;
  windowStartUtc: string;
  durationHours: number;
  limitHours: number | null;
  expected: AnalysisResult;
}
