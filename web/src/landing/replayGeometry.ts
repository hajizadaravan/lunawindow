// Geometry for the Sun replay graphic. Pure functions, no DOM: scales, SVG path building and the Sun's position
// at a scrub position. Every coordinate comes from the SunReplay props (dataset + analysis module).
//
// Conventions match the analysis (docs/data-contract.md section 4): the margin above the horizon is the body-centre
// elevation minus the horizon elevation at its azimuth, linearly interpolated in time between samples; the Sun is
// in view while the margin is above 0, and a pair of samples touching a missing sample is "unknown".
import type { SunReplay } from "./types";

export type ReplayState = "visible" | "blocked" | "unknown";

export interface ReplayBox {
  width: number;
  height: number;
  /** Plot insets in px. */
  pad: { top: number; right: number; bottom: number; left: number };
}

export interface Pt {
  x: number;
  y: number;
}

export interface TrackRun {
  state: ReplayState;
  d: string;
  /** Midpoint of the run along its samples, for labels. */
  mid: Pt;
}

export interface ReplayGeometry {
  /** Azimuth to x. Time runs left to right, so x is reversed when the Sun's azimuth decreases. */
  x: (azDeg: number) => number;
  y: (elDeg: number) => number;
  azRange: [number, number];
  elRange: [number, number];
  /** True when x grows with azimuth. */
  azAscending: boolean;
  /** Closed path of the ground below the horizon profile. */
  groundPath: string;
  /** The horizon line on its own. */
  ridgePath: string;
  runs: TrackRun[];
  /** Where the longest interruption begins and ends on the track (null if outside the samples). */
  gapStart: Pt | null;
  gapEnd: Pt | null;
  /** How many times the elevation axis is stretched relative to azimuth (px per degree ratio). */
  exaggeration: number;
  azTicks: number[];
  elTicks: number[];
  t0: number;
  t1: number;
  /** Prepared samples (time, azimuth, elevation, margin), reused by pointAt. */
  samples: ReplaySample[];
  profile: SunReplay["profile"];
}

export interface ReplayPoint {
  ms: number;
  azDeg: number;
  elDeg: number;
  /** Horizon elevation at the Sun's azimuth. */
  horizonDeg: number;
  /** Interpolated margin (elevation above the horizon); null when unknown. */
  marginDeg: number | null;
  state: ReplayState;
  pos: Pt;
}

const clamp01 = (f: number) => (Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : 0);

/** Linear interpolation of the horizon profile (ascending azimuth); holds the end values outside it. */
export function horizonAt(profile: SunReplay["profile"], azDeg: number): number {
  const n = profile.length;
  if (n === 0) return 0;
  if (azDeg <= profile[0].azDeg) return profile[0].elDeg;
  if (azDeg >= profile[n - 1].azDeg) return profile[n - 1].elDeg;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (profile[mid].azDeg <= azDeg) lo = mid;
    else hi = mid;
  }
  const a = profile[lo];
  const b = profile[hi];
  const f = b.azDeg === a.azDeg ? 0 : (azDeg - a.azDeg) / (b.azDeg - a.azDeg);
  return a.elDeg + (b.elDeg - a.elDeg) * f;
}

/** "Nice" tick values covering [lo, hi] with about `count` steps. */
export function niceTicks(lo: number, hi: number, count: number): number[] {
  if (!(hi > lo) || count < 1) return [lo];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

export interface ReplaySample {
  ms: number;
  az: number;
  el: number;
  margin: number;
  /** True when data is missing between the previous kept sample and this one (the segment is "unknown"). */
  breakBefore: boolean;
}

/**
 * Samples with data, in time order. A sample marked unknown, or a hole in the time grid (spacing above 1.5 times
 * the grid step), makes the segment across it unknown: it is never drawn or read as if there were data.
 */
function prepare(replay: SunReplay): ReplaySample[] {
  const times = replay.samples.map((s) => Date.parse(s.utc)).filter(Number.isFinite).sort((a, b) => a - b);
  let step = Infinity;
  for (let i = 1; i < times.length; i++) if (times[i] > times[i - 1]) step = Math.min(step, times[i] - times[i - 1]);
  const out: ReplaySample[] = [];
  let missing = false;
  for (const s of replay.samples) {
    const ms = Date.parse(s.utc);
    if (!Number.isFinite(ms)) continue;
    if (s.state === "unknown" || !Number.isFinite(s.azDeg) || !Number.isFinite(s.elDeg)) {
      missing = true;
      continue;
    }
    const prev = out[out.length - 1];
    const hole = prev !== undefined && ms - prev.ms > step * 1.5;
    out.push({
      ms,
      az: s.azDeg,
      el: s.elDeg,
      margin: s.elDeg - horizonAt(replay.profile, s.azDeg),
      breakBefore: prev !== undefined && (missing || hole),
    });
    missing = false;
  }
  return out;
}

const stateOf = (m: number | null): ReplayState => (m === null ? "unknown" : m > 0 ? "visible" : "blocked");

function lerpSample(a: ReplaySample, b: ReplaySample, f: number): { ms: number; az: number; el: number } {
  return { ms: a.ms + (b.ms - a.ms) * f, az: a.az + (b.az - a.az) * f, el: a.el + (b.el - a.el) * f };
}

/** Sun position, margin and state at an absolute time (clamped to the sample span). */
function at(samples: ReplaySample[], ms: number) {
  const n = samples.length;
  if (ms <= samples[0].ms) return { ...samples[0], state: stateOf(samples[0].margin) };
  if (ms >= samples[n - 1].ms) return { ...samples[n - 1], state: stateOf(samples[n - 1].margin) };
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].ms <= ms) lo = mid;
    else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  // No data between a and b: hold the last known position and report unknown.
  if (b.breakBefore) return { ms, az: a.az, el: a.el, margin: null, state: "unknown" as ReplayState };
  const f = (ms - a.ms) / (b.ms - a.ms);
  const p = lerpSample(a, b, f);
  const margin = a.margin + (b.margin - a.margin) * f;
  // A sample exactly on the horizon belongs to the state the interval takes after it (as in the analysis).
  return { ...p, margin, state: stateOf(margin) };
}

export function buildReplayGeometry(replay: SunReplay, box: ReplayBox): ReplayGeometry | null {
  const samples = prepare(replay);
  const profile = replay.profile.filter((p) => Number.isFinite(p.azDeg) && Number.isFinite(p.elDeg));
  if (samples.length < 2 || profile.length < 2) return null;

  const t0 = samples[0].ms;
  const t1 = samples[samples.length - 1].ms;
  const azAscending = samples[samples.length - 1].az >= samples[0].az;

  // x spans the Sun's azimuth range with a small margin, clipped to the profile.
  const azs = samples.map((s) => s.az);
  const azLo0 = Math.min(...azs);
  const azHi0 = Math.max(...azs);
  const azPad = Math.max((azHi0 - azLo0) * 0.04, 0.2);
  const azLo = Math.max(azLo0 - azPad, profile[0].azDeg);
  const azHi = Math.min(azHi0 + azPad, profile[profile.length - 1].azDeg);
  const visibleProfile = profile.filter((p) => p.azDeg >= azLo && p.azDeg <= azHi);
  const profileEls = [horizonAt(profile, azLo), horizonAt(profile, azHi), ...visibleProfile.map((p) => p.elDeg)];
  const els = [...samples.map((s) => s.el), ...profileEls];
  const elLo0 = Math.min(...els);
  const elHi0 = Math.max(...els);
  const elSpan = Math.max(elHi0 - elLo0, 0.05);
  // Room below the lowest ridge for ground, and above the track for the Sun marker.
  const elLo = elLo0 - elSpan * 0.55;
  const elHi = elHi0 + elSpan * 0.35;

  const { width, height, pad } = box;
  const plotW = Math.max(width - pad.left - pad.right, 1);
  const plotH = Math.max(height - pad.top - pad.bottom, 1);
  const x = (az: number) => {
    const f = (az - azLo) / (azHi - azLo);
    return pad.left + (azAscending ? f : 1 - f) * plotW;
  };
  const y = (el: number) => pad.top + (1 - (el - elLo) / (elHi - elLo)) * plotH;
  const f2 = (v: number) => v.toFixed(2);

  // Ground: the horizon profile across the plot, closed along the bottom.
  const ridge: Pt[] = [
    { x: x(azLo), y: y(horizonAt(profile, azLo)) },
    ...visibleProfile.map((p) => ({ x: x(p.azDeg), y: y(p.elDeg) })),
    { x: x(azHi), y: y(horizonAt(profile, azHi)) },
  ].sort((a, b) => a.x - b.x);
  const ridgePath = ridge.map((p, i) => `${i ? "L" : "M"}${f2(p.x)} ${f2(p.y)}`).join("");
  const bottom = pad.top + plotH;
  const groundPath = `${ridgePath}L${f2(ridge[ridge.length - 1].x)} ${f2(bottom)}L${f2(ridge[0].x)} ${f2(bottom)}Z`;

  // Track runs split at the interpolated zero crossings of the margin.
  type Raw = { state: ReplayState; pts: Pt[] };
  const raws: Raw[] = [];
  const add = (state: ReplayState, p: Pt) => {
    const last = raws[raws.length - 1];
    if (last && last.state === state) last.pts.push(p);
    else {
      const prev = last?.pts[last.pts.length - 1];
      raws.push({ state, pts: prev ? [prev, p] : [p] });
    }
  };
  const pt = (s: { az: number; el: number }) => ({ x: x(s.az), y: y(s.el) });
  for (let k = 0; k < samples.length - 1; k++) {
    const a = samples[k];
    const b = samples[k + 1];
    const sa = stateOf(a.margin);
    const sb = stateOf(b.margin);
    if (k === 0) raws.push({ state: sa, pts: [pt(a)] });
    // A hole in the data: no segment is drawn across it; the track restarts at the next sample.
    if (b.breakBefore) raws.push({ state: sb, pts: [pt(b)] });
    else if (sa === sb) add(sa, pt(b));
    else {
      const f = a.margin / (a.margin - b.margin);
      const c = pt(lerpSample(a, b, f));
      add(sa, c);
      add(sb, pt(b));
    }
  }
  const runs: TrackRun[] = raws
    .filter((r) => r.pts.length > 1)
    .map((r) => ({
      state: r.state,
      d: r.pts.map((p, i) => `${i ? "L" : "M"}${f2(p.x)} ${f2(p.y)}`).join(""),
      mid: r.pts[Math.floor(r.pts.length / 2)],
    }));

  const onTrack = (iso: string): Pt | null => {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms) || ms < t0 || ms > t1) return null;
    const p = at(samples, ms);
    return { x: x(p.az), y: y(p.el) };
  };

  const exaggeration = plotH / (elHi - elLo) / (plotW / (azHi - azLo));

  return {
    x,
    y,
    azRange: [azLo, azHi],
    elRange: [elLo, elHi],
    azAscending,
    groundPath,
    ridgePath,
    runs,
    gapStart: onTrack(replay.gapStartUtc),
    gapEnd: onTrack(replay.gapEndUtc),
    exaggeration,
    azTicks: niceTicks(azLo, azHi, Math.max(2, Math.round(plotW / 130))),
    elTicks: niceTicks(elLo, elHi, Math.max(2, Math.round(plotH / 70))),
    t0,
    t1,
    samples,
    profile,
  };
}

/** Time (ms) at scrub fraction f of the sample span. */
export function timeAtFraction(g: Pick<ReplayGeometry, "t0" | "t1">, f: number): number {
  return g.t0 + (g.t1 - g.t0) * clamp01(f);
}

/** Scrub fraction of an absolute time (clamped). */
export function fractionAt(g: Pick<ReplayGeometry, "t0" | "t1">, ms: number): number {
  return g.t1 > g.t0 ? clamp01((ms - g.t0) / (g.t1 - g.t0)) : 0;
}

/** The Sun at scrub fraction f: position, elevation, margin above the horizon and state. */
export function pointAt(g: ReplayGeometry, f: number): ReplayPoint {
  const p = at(g.samples, timeAtFraction(g, f));
  return {
    ms: p.ms,
    azDeg: p.az,
    elDeg: p.el,
    horizonDeg: horizonAt(g.profile, p.az),
    marginDeg: p.margin,
    state: p.state,
    pos: { x: g.x(p.az), y: g.y(p.el) },
  };
}

/** Tick label with as many decimals as the tick step needs, a true minus sign, and a degree sign. */
export function tickLabel(v: number, ticks: number[]): string {
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1;
  const digits = Math.max(0, Math.min(3, -Math.floor(Math.log10(step) + 1e-9)));
  const s = Math.abs(v).toFixed(digits);
  return `${v < 0 && Number(s) !== 0 ? "−" : ""}${s}°`;
}
