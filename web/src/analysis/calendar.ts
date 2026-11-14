// Start-date search: aggregation over analyzeVisibility (docs/data-contract.md section 4). The analysis itself is
// unchanged; this module only evaluates many daily starts and applies the user's limits with the same
// comparison semantics as step 8 (longer than the limit means durationHours > limitHours + 1e-9).
import type { AnalysisResult, BodyId, BodyTrack, HorizonInput, LimitStatus, TimeGrid } from "../contract/types";
import { analyzeVisibility, toIso } from "./visibility";
import { startBounds, type StartBounds } from "./window";

const MS_PER_HOUR = 3_600_000;
const DAY_MS = 86_400_000;
/** Same value as visibility.ts (contract section 4, step 8). */
const LIMIT_EPSILON_HOURS = 1e-9;

export const BODIES: readonly BodyId[] = ["sun", "earth"];
export type Scenario = "base" | "shifted";

export interface StartSearchParams {
  time: TimeGrid;
  tracks: Record<BodyId, Pick<BodyTrack, "azDeg" | "elDeg" | "angularRadiusDeg">>;
  horizon: HorizonInput;
  /** Manifest supportedRange. */
  range: { startUtc: string; endUtc: string };
  durationHours: number;
  /** The comparison shift (24 h). Bounds always reserve room for it, so every start is selectable in the app. */
  shiftHours: number;
  /** Also evaluate the window starting shiftHours later. */
  checkShift: boolean;
  /** Time of day of each daily start, ms after 00:00 UTC (taken from the selected start). */
  timeOfDayMs: number;
}

export interface Limits {
  sun: number | null;
  earth: number | null;
}

export type BodyPair = Record<BodyId, AnalysisResult>;

export interface EvaluatedStart {
  startMs: number;
  startUtc: string;
  base: BodyPair;
  /** null when checkShift is off. */
  shifted: BodyPair | null;
}

export interface Evaluation {
  bounds: StartBounds;
  starts: EvaluatedStart[];
  shiftHours: number;
  checkShift: boolean;
  durationHours: number;
  horizonKind: HorizonInput["kind"];
}

export interface Exceedance {
  body: BodyId;
  scenario: Scenario;
  limitHours: number;
  gapHours: number;
  overByHours: number;
  gapStartUtc: string;
  gapEndUtc: string;
}

/**
 * no-limits: no limit set. meets: every set limit is "within" in every evaluated window. uncertain: nothing
 * exceeds, but a gap touches a window edge or data is missing. exceeds: some set limit is exceeded.
 */
export type CellStatus = "no-limits" | "meets" | "uncertain" | "exceeds";

export interface CalendarCell extends EvaluatedStart {
  status: CellStatus;
  /** Per evaluated (scenario, body) with a limit set. */
  checks: { body: BodyId; scenario: Scenario; status: LimitStatus }[];
  /** All exceedances, worst (largest overBy) first. */
  exceedances: Exceedance[];
}

/** Daily starts at the given time of day, inside the bounds, on the time grid. */
export function dailyStarts(bounds: StartBounds, timeOfDayMs: number): number[] {
  const tod = ((timeOfDayMs % DAY_MS) + DAY_MS) % DAY_MS;
  const out: number[] = [];
  let t = Math.floor(bounds.earliestMs / DAY_MS) * DAY_MS + tod;
  if (t < bounds.earliestMs) t += DAY_MS;
  for (; t <= bounds.latestMs; t += DAY_MS) {
    const onGrid = (t - bounds.gridStartMs) % bounds.stepMs === 0;
    if (onGrid) out.push(t);
  }
  return out;
}

/** Runs the analysis (without limits) for every daily start and, if enabled, its shifted copy. */
export function evaluateStarts(p: StartSearchParams): Evaluation | null {
  const bounds = startBounds(p.range, p.time, p.durationHours, p.shiftHours);
  if (!bounds) return null;
  const cache = new Map<number, BodyPair>();
  const at = (ms: number): BodyPair => {
    let r = cache.get(ms);
    if (!r) {
      const run = (body: BodyId) =>
        analyzeVisibility({
          time: p.time,
          track: p.tracks[body],
          horizon: p.horizon,
          body,
          windowStartUtc: toIso(ms),
          durationHours: p.durationHours,
          limitHours: null,
        });
      r = { sun: run("sun"), earth: run("earth") };
      cache.set(ms, r);
    }
    return r;
  };
  const starts = dailyStarts(bounds, p.timeOfDayMs).map((ms) => ({
    startMs: ms,
    startUtc: toIso(ms),
    base: at(ms),
    shifted: p.checkShift ? at(ms + p.shiftHours * MS_PER_HOUR) : null,
  }));
  return {
    bounds,
    starts,
    shiftHours: p.shiftHours,
    checkShift: p.checkShift,
    durationHours: p.durationHours,
    horizonKind: p.horizon.kind,
  };
}

/** Step 8 of the contract applied to an already computed result (same order, same epsilon). */
export function limitStatusFor(r: AnalysisResult, limitHours: number): { status: LimitStatus; exceeding: AnalysisResult["intervals"] } {
  const blocked = r.intervals.filter((iv) => iv.state === "blocked");
  const exceeding = blocked.filter((iv) => iv.durationHours > limitHours + LIMIT_EPSILON_HOURS);
  if (exceeding.length > 0) return { status: "exceeded", exceeding };
  if (blocked.some((iv) => iv.touchesWindowStart || iv.touchesWindowEnd)) return { status: "not-exceeded-truncated", exceeding };
  if (r.unknownHours > 0) return { status: "indeterminate-missing-data", exceeding };
  return { status: "within", exceeding };
}

export function classifyStart(s: EvaluatedStart, limits: Limits): CalendarCell {
  const checks: CalendarCell["checks"] = [];
  const exceedances: Exceedance[] = [];
  const scenarios: [Scenario, BodyPair | null][] = [
    ["base", s.base],
    ["shifted", s.shifted],
  ];
  for (const [scenario, pair] of scenarios) {
    if (!pair) continue;
    for (const body of BODIES) {
      const L = limits[body];
      if (L === null) continue;
      const { status, exceeding } = limitStatusFor(pair[body], L);
      checks.push({ body, scenario, status });
      if (exceeding.length) {
        const worst = exceeding.reduce((a, b) => (b.durationHours > a.durationHours ? b : a));
        exceedances.push({
          body,
          scenario,
          limitHours: L,
          gapHours: worst.durationHours,
          overByHours: worst.durationHours - L,
          gapStartUtc: worst.startUtc,
          gapEndUtc: worst.endUtc,
        });
      }
    }
  }
  exceedances.sort((a, b) => b.overByHours - a.overByHours);
  const status: CellStatus =
    checks.length === 0
      ? "no-limits"
      : checks.some((c) => c.status === "exceeded")
        ? "exceeds"
        : checks.every((c) => c.status === "within")
          ? "meets"
          : "uncertain";
  return { ...s, status, checks, exceedances };
}

export function classify(ev: Evaluation, limits: Limits): CalendarCell[] {
  return ev.starts.map((s) => classifyStart(s, limits));
}

/** Convenience: evaluate and classify in one call. */
export function searchStarts(p: StartSearchParams, limits: Limits): { evaluation: Evaluation; cells: CalendarCell[] } | null {
  const evaluation = evaluateStarts(p);
  if (!evaluation) return null;
  return { evaluation, cells: classify(evaluation, limits) };
}

/** Longest blocked gap (hours) of a result, 0 when there is none. */
export function longestGapHours(r: AnalysisResult): number {
  return r.longestInterruption?.durationHours ?? 0;
}

export type NextFit =
  | { kind: "no-limits" }
  | { kind: "no-starts" }
  | { kind: "fit"; cell: CalendarCell; skipped: { exceeds: number; uncertain: number } }
  | {
      kind: "none";
      /** Closest miss: the start whose worst exceedance is smallest; null when no start exceeds (only uncertain). */
      closest: CalendarCell | null;
      worst: Exceedance | null;
      uncertain: number;
      considered: number;
    };

/** Nearest start >= fromMs that meets every set limit in every evaluated window. */
export function findNextFit(cells: CalendarCell[], fromMs: number, limits: Limits): NextFit {
  if (limits.sun === null && limits.earth === null) return { kind: "no-limits" };
  const later = cells.filter((c) => c.startMs >= fromMs).sort((a, b) => a.startMs - b.startMs);
  if (later.length === 0) return { kind: "no-starts" };
  let exceeds = 0;
  let uncertain = 0;
  for (const c of later) {
    if (c.status === "meets") return { kind: "fit", cell: c, skipped: { exceeds, uncertain } };
    if (c.status === "exceeds") exceeds++;
    else if (c.status === "uncertain") uncertain++;
  }
  let closest: CalendarCell | null = null;
  for (const c of later) {
    if (c.status !== "exceeds") continue;
    if (!closest || c.exceedances[0].overByHours < closest.exceedances[0].overByHours - 1e-12) closest = c;
  }
  return { kind: "none", closest, worst: closest ? closest.exceedances[0] : null, uncertain, considered: later.length };
}
