// Derived values for the landing view (src/landing/types.ts). Pure functions over the cached dataset: every
// number comes from the analysis module (visibility.ts, calendar.ts, window.ts, projection.ts) and nothing here
// changes how the analysis works.
import type { AnalysisResult, HorizonInput, Manifest, SiteDataset, SiteIndexEntry } from "../contract/types";
import type { DemoStory, PointSummary, StripDay, SunReplay } from "../landing/types";
import { analyzeVisibility, horizonElevationAt, marginAt, sampleState, sampleTimeMs, toIso } from "../analysis/visibility";
import { classify, evaluateStarts, longestGapHours } from "../analysis/calendar";
import { mapPixel } from "../analysis/projection";

const MS_PER_HOUR = 3_600_000;
const DAY_MS = 86_400_000;

/** The example scenario's inputs, resolved against the manifest (shift comes from manifest defaults). */
export interface ExampleInputs {
  siteId: string;
  startUtc: string;
  durationHours: number;
  shiftHours: number;
  sunLimitHours: number;
}

/** Terrain horizon when the dataset has one, else the geometric reference (the example's "terrain" mode). */
export function exampleHorizon(site: SiteDataset): { horizon: HorizonInput; label: string } {
  const t = site.horizons.terrain;
  return t ? { horizon: t, label: t.label } : { horizon: site.horizons.geometric, label: site.horizons.geometric.label };
}

function runExample(site: SiteDataset, ex: ExampleInputs, offsetHours: number, body: "sun" | "earth"): AnalysisResult {
  const { horizon } = exampleHorizon(site);
  return analyzeVisibility({
    time: site.time,
    track: site.ephemeris.bodies[body],
    horizon,
    body,
    windowStartUtc: toIso(Date.parse(ex.startUtc) + offsetHours * MS_PER_HOUR),
    durationHours: ex.durationHours,
    limitHours: body === "sun" ? ex.sunLimitHours : null,
  });
}

/** The example scenario at one point: longest Sun and Earth gaps, baseline and delayed. Null if it cannot run. */
export function pointResult(site: SiteDataset, ex: ExampleInputs): NonNullable<PointSummary["result"]> | null {
  try {
    const baseSun = runExample(site, ex, 0, "sun");
    const shiftedSun = runExample(site, ex, ex.shiftHours, "sun");
    // runExample always passes the Sun limit, so the analysis always returns a limit verdict for the Sun.
    if (!baseSun.limit || !shiftedSun.limit) return null;
    return {
      baseSunGapHours: longestGapHours(baseSun),
      shiftedSunGapHours: longestGapHours(shiftedSun),
      baseEarthGapHours: longestGapHours(runExample(site, ex, 0, "earth")),
      shiftedEarthGapHours: longestGapHours(runExample(site, ex, ex.shiftHours, "earth")),
      baseSunStatus: baseSun.limit.status,
      shiftedSunStatus: shiftedSun.limit.status,
      horizonLabel: exampleHorizon(site).label,
    };
  } catch {
    return null;
  }
}

/** The landing story: the example scenario at its own point. */
export function computeStory(site: SiteDataset, ex: ExampleInputs): DemoStory | null {
  const r = pointResult(site, ex);
  if (!r) return null;
  return {
    siteName: site.site.name,
    startUtc: toIso(Date.parse(ex.startUtc)),
    durationDays: ex.durationHours / 24,
    shiftHours: ex.shiftHours,
    limitHours: ex.sunLimitHours,
    baseSunGapHours: r.baseSunGapHours,
    shiftedSunGapHours: r.shiftedSunGapHours,
    baseEarthGapHours: r.baseEarthGapHours,
    shiftedEarthGapHours: r.shiftedEarthGapHours,
    baseSunStatus: r.baseSunStatus,
    shiftedSunStatus: r.shiftedSunStatus,
    horizonLabel: r.horizonLabel,
  };
}

/**
 * Daily starts across the allowed range for the example window length, Sun limit and +shift check, with the same
 * evaluation and classification the start-date calendar uses. Null when no start fits the dataset.
 */
export function computeStrip(manifest: Manifest, site: SiteDataset, ex: ExampleInputs): StripDay[] | null {
  const startMs = Date.parse(ex.startUtc);
  let evaluation;
  try {
    evaluation = evaluateStarts({
      time: site.time,
      tracks: site.ephemeris.bodies,
      horizon: exampleHorizon(site).horizon,
      range: manifest.supportedRange,
      durationHours: ex.durationHours,
      shiftHours: ex.shiftHours,
      checkShift: true,
      timeOfDayMs: ((startMs % DAY_MS) + DAY_MS) % DAY_MS,
    });
  } catch {
    return null;
  }
  if (!evaluation) return null;
  return classify(evaluation, { sun: ex.sunLimitHours, earth: null }).map((c) => {
    // A Sun limit is always set here, so the calendar's "no-limits" status cannot occur.
    if (c.status === "no-limits") throw new Error("Strip evaluated without a Sun limit");
    return {
      startUtc: c.startUtc,
      sunGapHours: longestGapHours(c.base.sun),
      shiftedSunGapHours: longestGapHours(c.shifted!.sun),
      status: c.status,
    };
  });
}

/** Position on the map image as fractions of its size, or null without a map or outside it. */
export function mapPosition(manifest: Manifest, entry: Pick<SiteIndexEntry, "latDeg" | "lonEastDeg">) {
  const map = manifest.map;
  if (!map) return null;
  const p = mapPixel(map, entry.latDeg, entry.lonEastDeg);
  if (!p.inside) return null;
  return { x: p.col / map.widthPx, y: p.row / map.heightPx };
}

/**
 * One summary per manifest site, manifest order. `result` and `strip` stay null until that site has loaded.
 * `failed` is set when the site failed to load (`loadFailed`), its example could not be computed, or its strip was
 * computed and came back null: those nulls are final.
 */
export function buildPoints(
  manifest: Manifest,
  loaded: Record<string, SiteDataset | undefined>,
  strips: Record<string, StripDay[] | null | undefined>,
  ex: ExampleInputs,
  loadFailed: Record<string, boolean | undefined> = {},
): PointSummary[] {
  return manifest.sites.map((entry, i) => {
    const site = loaded[entry.id];
    const result = site ? pointResult(site, ex) : null;
    const strip = strips[entry.id];
    return {
      id: entry.id,
      letter: String.fromCharCode(65 + i),
      name: entry.name,
      locationHint: entry.locationHint,
      latDeg: entry.latDeg,
      lonEastDeg: entry.lonEastDeg,
      mapPos: mapPosition(manifest, entry),
      result,
      strip: strip ?? null,
      failed: Boolean(loadFailed[entry.id]) || (site !== undefined && result === null) || strip === null,
    };
  });
}

/** Shift each azimuth by a multiple of 360 so consecutive values never jump by more than 180 degrees. */
export function unwrapAzimuths(az: number[]): number[] {
  const out: number[] = [];
  for (const a of az) {
    if (out.length === 0) {
      out.push(a);
      continue;
    }
    const prev = out[out.length - 1];
    out.push(a + 360 * Math.round((prev - a) / 360));
  }
  return out;
}

export interface ReplayOptions {
  hoursBefore: number;
  hoursAfter: number;
  marginDeg: number;
}
export const REPLAY_DEFAULTS: ReplayOptions = { hoursBefore: 12, hoursAfter: 6, marginDeg: 4 };

/**
 * The longest Sun interruption of the delayed example window, replayed on the dataset grid from about
 * `hoursBefore` before its start to about `hoursAfter` after its end (clamped to the dataset). Sample state uses
 * the analysis' own marginAt/sampleState. Samples with a missing Sun position have no direction to draw and are
 * left out. Null when the window has no Sun interruption or cannot be analysed.
 */
export function computeReplay(site: SiteDataset, ex: ExampleInputs, opt: ReplayOptions = REPLAY_DEFAULTS): SunReplay | null {
  let result: AnalysisResult;
  try {
    result = runExample(site, ex, ex.shiftHours, "sun");
  } catch {
    return null;
  }
  const gap = result.longestInterruption;
  if (!gap) return null;
  const { horizon, label } = exampleHorizon(site);
  const { time } = site;
  const track = site.ephemeris.bodies.sun;
  const stepMs = time.stepSeconds * 1000;
  const t0 = Date.parse(time.startUtc);
  const iFrom = Math.max(0, Math.floor((Date.parse(gap.startUtc) - opt.hoursBefore * MS_PER_HOUR - t0) / stepMs));
  const iTo = Math.min(time.count - 1, Math.ceil((Date.parse(gap.endUtc) + opt.hoursAfter * MS_PER_HOUR - t0) / stepMs));

  const raw: { i: number; az: number; el: number }[] = [];
  for (let i = iFrom; i <= iTo; i++) {
    const az = track.azDeg[i];
    const el = track.elDeg[i];
    if (az === null || el === null) continue;
    raw.push({ i, az, el });
  }
  if (raw.length === 0) return null;
  const unwrapped = unwrapAzimuths(raw.map((r) => r.az));
  const samples: SunReplay["samples"] = raw.map((r, k) => ({
    utc: toIso(sampleTimeMs(time, r.i)),
    azDeg: unwrapped[k],
    elDeg: r.el,
    state: sampleState(marginAt(horizon, r.az, r.el)),
  }));

  const step = horizon.kind === "terrain" ? horizon.azimuthStepDeg : 1;
  const lo = Math.floor((Math.min(...unwrapped) - opt.marginDeg) / step);
  const hi = Math.ceil((Math.max(...unwrapped) + opt.marginDeg) / step);
  const profile: SunReplay["profile"] = [];
  for (let k = lo; k <= hi; k++) {
    const azDeg = k * step;
    profile.push({ azDeg, elDeg: horizonElevationAt(horizon, azDeg) });
  }

  return {
    siteName: site.site.name,
    horizonLabel: label,
    windowStartUtc: result.windowStartUtc,
    windowEndUtc: result.windowEndUtc,
    gapStartUtc: gap.startUtc,
    gapEndUtc: gap.endUtc,
    gapHours: gap.durationHours,
    profile,
    samples,
  };
}
