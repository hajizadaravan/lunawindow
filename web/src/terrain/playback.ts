import type { AnalysisResult, BodyId, VisState } from "../contract/types";
import { stateAt } from "../components/Timelines";

/** Visibility of each body centre at a time, read from the analysis results (the same lookup the timelines use). */
export type BodyStatus = { state: VisState; near: boolean };
export type Statuses = Record<BodyId, BodyStatus>;

export function statusAt(results: Record<BodyId, AnalysisResult>, tMs: number): Statuses {
  return { sun: stateAt(results.sun, tMs), earth: stateAt(results.earth, tMs) };
}

export const STATE_LABEL: Record<VisState, string> = {
  visible: "Centre visible",
  blocked: "Centre blocked",
  unknown: "No data",
};

/** Playback speeds in hours of mission time per real second. */
export const SPEEDS = [1, 6, 24] as const;
export type Speed = (typeof SPEEDS)[number];
export const DEFAULT_SPEED: Speed = 6;

/**
 * The most real time one frame may count for. A longer gap between frames is a stall (a device that slept, a paused
 * debugger; a hidden tab pauses playback by itself): it counts as this much, so playback neither leaps ahead by the
 * whole stall nor freezes on a device whose every frame is this slow. Every shorter frame, however slow, counts in
 * full, so mission time follows real time at the labelled speed.
 */
export const STALL_MS = 2000;
/** While playing, the shared cursor (sky plot, timelines) is published at most this often; exact again on pause. */
export const PUBLISH_MS = 250;

/** Next fractional window position after dtMs of real time. Stops exactly on the last sample. */
export function advance(
  position: number,
  dtMs: number,
  hoursPerSecond: number,
  stepSeconds: number,
  lastIndex: number,
): { position: number; done: boolean } {
  const dt = dtMs > 0 ? Math.min(dtMs, STALL_MS) : 0;
  const next = position + ((dt / 1000) * hoursPerSecond * 3600) / stepSeconds;
  if (next >= lastIndex) return { position: lastIndex, done: true };
  return { position: next, done: false };
}
