import type { AnalysisResult, BodyId, VisState } from "../contract/types";
import { stateAt } from "../components/Timelines";
import { displaySkylineAt, type BodyDirection, type DisplaySkyline } from "./geometry";

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

/**
 * Does the drawn 3D surface tell the same story as the analysis state at this moment? Display only: the state itself
 * always comes from the analysis. "differs" means the surface on screen rises above a centre the analysis counts as
 * visible, or stays below one it counts as blocked. "unchecked": no direction, no data, or no surface to compare.
 */
export type SurfaceAgreement = "agrees" | "differs" | "unchecked";
export interface SurfaceCheck {
  agreement: SurfaceAgreement;
  /** Skyline of the drawn surface in the body's direction (deg), or null. */
  surfaceDeg: number | null;
}

export function surfaceCheck(skyline: DisplaySkyline | null, d: BodyDirection | null, state: VisState): SurfaceCheck {
  if (!skyline || !d || state === "unknown") return { agreement: "unchecked", surfaceDeg: null };
  const surfaceDeg = displaySkylineAt(skyline, d.az);
  if (surfaceDeg === null) return { agreement: "unchecked", surfaceDeg: null };
  // Same rule as the analysis (visible when the margin is above zero), applied to the drawn surface.
  const clearOnScreen = d.el - surfaceDeg > 0;
  return { agreement: clearOnScreen === (state === "visible") ? "agrees" : "differs", surfaceDeg };
}

/**
 * Readout sentence for a moment where the drawn surface and the analysis disagree; null when they agree.
 * `terrainSource` describes the terrain horizon from the dataset (e.g. "LOLA 40 m terrain from 80 m out"), or is null
 * in the geometric mode.
 */
export function surfaceNote(body: "Sun" | "Earth", check: SurfaceCheck, d: BodyDirection | null, state: VisState,
  near: boolean, terrainSource: string | null, fmt: (deg: number) => string): string | null {
  if (check.agreement !== "differs" || check.surfaceDeg === null || !d) return null;
  const drawn = state === "visible"
    ? `the drawn surface rises to ${fmt(check.surfaceDeg)} in this direction and hides the ${body} centre (${fmt(d.el)}) on screen`
    : `the drawn surface reaches only ${fmt(check.surfaceDeg)} in this direction and leaves the ${body} centre (${fmt(d.el)}) clear on screen`;
  const used = terrainSource === null
    ? "The result uses the flat 0° geometric horizon, which ignores terrain."
    : `The result uses the analysis horizon, ${fmt(d.horizon)} here (${terrainSource}); the 3D mesh is a simplified display surface.`;
  // Most disagreements are a few hundredths of a degree, inside the band the readout already marks as uncertain.
  // `near` is the analysis flag the readout's state line shows, so the two never disagree.
  const uncertain = near ? " The centre is within the near-horizon band, so this moment is uncertain either way." : "";
  return `3D view differs: ${drawn}. ${used}${uncertain}`;
}

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
