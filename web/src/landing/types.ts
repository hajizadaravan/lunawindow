// Landing page props. INTERFACE IS FIXED BY THE INTEGRATOR.
// App.tsx (frontend lane) computes every value here from the cached dataset with the analysis module and passes it
// down; the landing lane only renders. No number in the landing is hardcoded: if a value is missing, show a
// skeleton or leave the block out.
import type { LimitStatus, Manifest } from "../contract/types";

/** The example scenario: one point, one start, baseline vs a start delayed by shiftHours. */
export interface DemoStory {
  siteName: string; // e.g. "Demo point A"
  startUtc: string; // ISO, baseline window start
  durationDays: number;
  shiftHours: number; // 24
  limitHours: number; // example Sun limit, 6
  baseSunGapHours: number; // longest Sun gap, baseline window
  shiftedSunGapHours: number; // longest Sun gap, start delayed by shiftHours
  baseEarthGapHours: number;
  shiftedEarthGapHours: number;
  /**
   * The analysis' verdict of each window's Sun result against limitHours (AnalysisResult.limit.status). Every
   * landing verdict is worded from these, never from comparing the gap hours with the limit: a gap that touches
   * the window edge or a window with missing data is not "within the limit".
   */
  baseSunStatus: LimitStatus;
  shiftedSunStatus: LimitStatus;
  horizonLabel: string; // active horizon mode label from the dataset
}

/** One daily start of the example window length at one point (same evaluation the start-date calendar uses). */
export interface StripDay {
  startUtc: string; // ISO start of the baseline window
  sunGapHours: number; // longest Sun interruption, baseline window
  shiftedSunGapHours: number; // same, start delayed by shiftHours
  /** baseline AND delayed start compared with the example Sun limit; "uncertain" as defined by analysis/calendar. */
  status: "meets" | "exceeds" | "uncertain";
}

/** A demonstration point with the example scenario evaluated at it. `result`/`strip` are null until its data loads. */
export interface PointSummary {
  id: string;
  letter: string; // "A", "B", "C" (manifest order)
  name: string;
  locationHint: string;
  latDeg: number;
  lonEastDeg: number;
  /** Position on manifest.map.image, as fractions of its width and height (0..1), or null if outside the map. */
  mapPos: { x: number; y: number } | null;
  result: null | {
    baseSunGapHours: number;
    shiftedSunGapHours: number;
    baseEarthGapHours: number;
    shiftedEarthGapHours: number;
    /** As in DemoStory: the analysis' verdict against the example Sun limit. */
    baseSunStatus: LimitStatus;
    shiftedSunStatus: LimitStatus;
    horizonLabel: string;
  };
  strip: null | StripDay[];
  /**
   * True when this point's data failed to load or its example could not be computed: `result` and/or `strip` stay
   * null for good. Render a short "could not be loaded" message, not a skeleton.
   */
  failed: boolean;
}

/**
 * The longest Sun interruption of the delayed example window, as a short replay: the Sun's body-centre track
 * against the terrain horizon it passes behind. Azimuths are unwrapped (may exceed 360 or go below 0) so both
 * arrays are continuous and share one x axis.
 */
export interface SunReplay {
  siteName: string;
  horizonLabel: string;
  windowStartUtc: string; // delayed window
  windowEndUtc: string;
  gapStartUtc: string;
  gapEndUtc: string;
  gapHours: number;
  /** Horizon profile across the azimuth span the samples cover (plus a margin), ascending azimuth. */
  profile: { azDeg: number; elDeg: number }[];
  /** Sun samples in time order, from some hours before the gap to some hours after it, on the dataset grid. */
  samples: { utc: string; azDeg: number; elDeg: number; state: "visible" | "blocked" | "unknown" }[];
}

export interface LandingProps {
  manifest: Manifest;
  /** null while the example point is loading, or if the example could not be computed (then storyFailed). */
  story: DemoStory | null;
  /**
   * True when the example point failed to load or the example could not be computed: `story` and `replay` stay
   * null for good. Blocks that depend on them show a short message in the skeleton's footprint (no aria-busy).
   */
  storyFailed: boolean;
  /** Always one entry per manifest site, in manifest order. */
  points: PointSummary[];
  /** null while loading, or when the delayed example window has no Sun interruption. */
  replay: SunReplay | null;
  /** Limit and window length the strips were evaluated with (the example scenario's). */
  example: { durationDays: number; shiftHours: number; sunLimitHours: number };
  /** Opens the tool with the example scenario applied and scrolls to its result. */
  onTryDemo: () => void;
  /** Opens the tool at the start-date calendar. */
  onOpenCalendar: () => void;
  /** Opens the tool as it is. */
  onOpenTool: () => void;
  onAssumptions: () => void;
}
