// Mission-window constraints: the baseline window and its shifted (+24 h) copy must both lie inside
// the supported range and on the time grid.
import type { TimeGrid } from "../contract/types";
import { parseUtc } from "./visibility";

const MS_PER_HOUR = 3_600_000;

export interface StartBounds {
  /** Earliest allowed start (ms, grid time). */
  earliestMs: number;
  /** Latest allowed start (ms, grid time) so that start + duration + shift <= last sample. */
  latestMs: number;
  stepMs: number;
  gridStartMs: number;
}

/**
 * Bounds on the window start. `range` is the manifest supportedRange, `grid` the site time grid.
 * The usable span is their intersection. Returns null when no start fits.
 */
export function startBounds(
  range: { startUtc: string; endUtc: string },
  grid: TimeGrid,
  durationHours: number,
  shiftHours: number,
): StartBounds | null {
  const stepMs = grid.stepSeconds * 1000;
  const gridStartMs = parseUtc(grid.startUtc);
  const gridEndMs = gridStartMs + (grid.count - 1) * stepMs;
  const lo = Math.max(parseUtc(range.startUtc), gridStartMs);
  const hi = Math.min(parseUtc(range.endUtc), gridEndMs);
  const earliestMs = gridStartMs + Math.ceil((lo - gridStartMs) / stepMs) * stepMs;
  const latestRaw = hi - (durationHours + shiftHours) * MS_PER_HOUR;
  const latestMs = gridStartMs + Math.floor((latestRaw - gridStartMs) / stepMs) * stepMs;
  if (latestMs < earliestMs) return null;
  return { earliestMs, latestMs, stepMs, gridStartMs };
}

/** Snap a requested start down to the grid and clamp it into the bounds. */
export function clampStart(requestedMs: number, b: StartBounds): number {
  if (!Number.isFinite(requestedMs)) return b.earliestMs;
  const snapped = b.gridStartMs + Math.floor((requestedMs - b.gridStartMs) / b.stepMs) * b.stepMs;
  return Math.min(Math.max(snapped, b.earliestMs), b.latestMs);
}

/** True when a duration (hours) is a whole number of grid steps. */
export function durationOnGrid(durationHours: number, stepSeconds: number): boolean {
  const steps = (durationHours * 3600) / stepSeconds;
  return Math.abs(steps - Math.round(steps)) < 1e-9;
}
