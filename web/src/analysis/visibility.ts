// Visibility analysis, docs/data-contract.md section 4 (normative). Pure functions, no I/O.
import type {
  AnalysisResult,
  BodyId,
  BodyTrack,
  HorizonInput,
  TimeGrid,
  VisInterval,
  VisState,
} from "../contract/types";

const MS_PER_HOUR = 3_600_000;
/** Absorbs floating-point noise only (about 3.6 microseconds); the comparison stays a strict ">". */
const LIMIT_EPSILON_HOURS = 1e-9;

export interface AnalysisInput {
  time: TimeGrid;
  track: Pick<BodyTrack, "azDeg" | "elDeg" | "angularRadiusDeg">;
  horizon: HorizonInput;
  body: BodyId;
  windowStartUtc: string;
  durationHours: number;
  limitHours?: number | null;
}

export class AnalysisInputError extends Error {}

export function parseUtc(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new AnalysisInputError(`Invalid UTC timestamp: ${iso}`);
  return ms;
}

export function toIso(ms: number): string {
  return new Date(Math.round(ms)).toISOString();
}

/** Step 1. Horizon elevation at an azimuth (degrees). */
export function horizonElevationAt(horizon: HorizonInput, azDeg: number): number {
  if (horizon.kind === "geometric") return horizon.elevationDeg;
  const bins = horizon.elevationDeg;
  const n = bins.length;
  if (n === 0) throw new AnalysisInputError("Terrain horizon has no azimuth bins");
  const step = horizon.azimuthStepDeg;
  const az = ((azDeg % 360) + 360) % 360;
  const pos = az / step;
  const k0 = Math.floor(pos) % n;
  const k1 = (k0 + 1) % n;
  const f = pos - Math.floor(pos);
  return bins[k0] + (bins[k1] - bins[k0]) * f;
}

/** Step 2. Margin above the modelled horizon, or null when the sample is missing. */
export function marginAt(horizon: HorizonInput, az: number | null, el: number | null): number | null {
  if (az === null || el === null || az === undefined || el === undefined) return null;
  return el - horizonElevationAt(horizon, az);
}

/** Step 3. */
export function sampleState(m: number | null): VisState {
  if (m === null) return "unknown";
  return m > 0 ? "visible" : "blocked";
}

export function sampleTimeMs(time: TimeGrid, i: number): number {
  return parseUtc(time.startUtc) + i * time.stepSeconds * 1000;
}

/** Index of a grid time, or throws if the time is not on the grid / outside it. */
export function gridIndex(time: TimeGrid, iso: string): number {
  const offsetMs = parseUtc(iso) - parseUtc(time.startUtc);
  const stepMs = time.stepSeconds * 1000;
  const idx = offsetMs / stepMs;
  if (!Number.isInteger(idx)) throw new AnalysisInputError(`${iso} is not a grid time`);
  if (idx < 0 || idx > time.count - 1) throw new AnalysisInputError(`${iso} is outside the time grid`);
  return idx;
}

interface Piece {
  state: VisState;
  start: number;
  end: number;
}

export function analyzeVisibility(input: AnalysisInput): AnalysisResult {
  const { time, track, horizon, body } = input;
  const stepMs = time.stepSeconds * 1000;
  if (!(time.stepSeconds > 0)) throw new AnalysisInputError("stepSeconds must be positive");
  if (!(input.durationHours > 0)) throw new AnalysisInputError("durationHours must be positive");
  if (track.azDeg.length !== time.count || track.elDeg.length !== time.count) {
    throw new AnalysisInputError("Track length does not match time.count");
  }
  if (horizon.kind === "terrain") {
    // Same check as pipeline/analysis.py: the azimuth bins must cover exactly one full circle.
    const n = horizon.elevationDeg.length;
    if (n === 0 || !(horizon.azimuthStepDeg > 0) || Math.abs(n * horizon.azimuthStepDeg - 360) > 1e-9)
      throw new AnalysisInputError("Terrain horizon bins must cover exactly 360 degrees");
  }

  const i0 = gridIndex(time, input.windowStartUtc);
  const t0 = sampleTimeMs(time, i0);
  const t1 = t0 + input.durationHours * MS_PER_HOUR;
  const i1 = gridIndex(time, toIso(t1));

  const margins: (number | null)[] = [];
  for (let i = i0; i <= i1; i++) margins.push(marginAt(horizon, track.azDeg[i], track.elDeg[i]));
  const tAt = (k: number) => t0 + k * stepMs; // k relative to i0

  // Step 4. Segment pieces.
  const pieces: Piece[] = [];
  const push = (state: VisState, start: number, end: number) => {
    if (end - start <= 0) return; // zero-length pieces (exact-zero crossings) carry no duration
    const last = pieces[pieces.length - 1];
    if (last && last.state === state && last.end === start) last.end = end;
    else pieces.push({ state, start, end });
  };
  for (let k = 0; k < margins.length - 1; k++) {
    const a = margins[k];
    const b = margins[k + 1];
    const sa = sampleState(a);
    const sb = sampleState(b);
    const ta = tAt(k);
    const tb = tAt(k + 1);
    if (sa === "unknown" || sb === "unknown") push("unknown", ta, tb);
    else if (sa === sb) push(sa, ta, tb);
    else {
      const ma = a as number;
      const mb = b as number;
      const tStar = ta + (stepMs * ma) / (ma - mb);
      push(sa, ta, tStar);
      push(sb, tStar, tb);
    }
  }

  // Step 5. Intervals (push already merged adjacent equal states).
  const intervals: VisInterval[] = pieces.map((p, idx) => ({
    state: p.state,
    startUtc: toIso(p.start),
    endUtc: toIso(p.end),
    durationHours: (p.end - p.start) / MS_PER_HOUR,
    touchesWindowStart: p.start === t0,
    touchesWindowEnd: p.end === t1,
    adjacentToUnknown:
      (idx > 0 && pieces[idx - 1].state === "unknown") ||
      (idx < pieces.length - 1 && pieces[idx + 1].state === "unknown"),
  }));

  // Step 6. Near-horizon spans.
  const band = track.angularRadiusDeg.max + horizon.uncertaintyDeg;
  const nearHorizonSpans: { startUtc: string; endUtc: string }[] = [];
  let runStart = -1;
  for (let k = 0; k <= margins.length; k++) {
    const m = k < margins.length ? margins[k] : null;
    const flagged = m !== null && Math.abs(m) < band;
    if (flagged && runStart < 0) runStart = k;
    if (!flagged && runStart >= 0) {
      nearHorizonSpans.push({ startUtc: toIso(tAt(runStart)), endUtc: toIso(tAt(k - 1)) });
      runStart = -1;
    }
  }

  const sum = (s: VisState) =>
    intervals.filter((iv) => iv.state === s).reduce((acc, iv) => acc + iv.durationHours, 0);
  const blocked = intervals.filter((iv) => iv.state === "blocked");

  // Step 7.
  let longest: VisInterval | null = null;
  for (const iv of blocked) if (!longest || iv.durationHours > longest.durationHours) longest = iv;

  const unknownHours = sum("unknown");

  // Step 8.
  let limit: AnalysisResult["limit"] = null;
  if (input.limitHours !== undefined && input.limitHours !== null) {
    const L = input.limitHours;
    const exceedingIntervals = blocked.filter((iv) => iv.durationHours > L + LIMIT_EPSILON_HOURS);
    let status: NonNullable<AnalysisResult["limit"]>["status"];
    if (exceedingIntervals.length > 0) status = "exceeded";
    else if (blocked.some((iv) => iv.touchesWindowStart || iv.touchesWindowEnd)) status = "not-exceeded-truncated";
    else if (unknownHours > 0) status = "indeterminate-missing-data";
    else status = "within";
    limit = { limitHours: L, status, exceedingIntervals };
  }

  return {
    body,
    horizonId: horizon.id,
    horizonKind: horizon.kind,
    windowStartUtc: toIso(t0),
    windowEndUtc: toIso(t1),
    stepSeconds: time.stepSeconds,
    intervals,
    nearHorizonSpans,
    nearHorizonBandDeg: band,
    visibleHours: sum("visible"),
    blockedHours: sum("blocked"),
    unknownHours,
    interruptionCount: blocked.length,
    longestInterruption: longest
      ? { ...longest, boundaryTruncated: longest.touchesWindowStart || longest.touchesWindowEnd }
      : null,
    limit,
  };
}
