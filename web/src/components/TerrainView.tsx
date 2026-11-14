import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowCounterClockwise, ArrowSquareOut, Cube, Pause, Play, Sun, GlobeHemisphereWest } from "@phosphor-icons/react";
import type { AnalysisResult, BodyId, HorizonInput, SiteDataset, VisState } from "../contract/types";
import { fmtDeg, fmtUtc } from "../analysis/format";
import { directionsAt, directionsAtPosition } from "../terrain/geometry";
import { advance, DEFAULT_SPEED, PUBLISH_MS, SPEEDS, STATE_LABEL, statusAt, surfaceCheck, surfaceNote, type Speed } from "../terrain/playback";
import type { Lighting, TerrainScene } from "../terrain/scene";
import { ModeTag } from "./ModeTag";
import "../terrain/terrain.css";

interface Props {
  site: SiteDataset;
  horizon: HorizonInput;
  /** Analysis results for the selected interval and the active horizon mode; the only source of visibility states. */
  results: Record<BodyId, AnalysisResult>;
  /** Pinned sha256 of the DEM the terrain horizon was built from (manifest sources); the model must name the same. */
  demSha256: string | null;
  windowStartMs: number;
  sampleCount: number;
  cursor: number;
  onCursor: (index: number) => void;
}

/**
 * Lighting when the view opens. Checked on screenshots of real frames: with the Sun about 1° below or above the
 * horizon, Sun-direction lighting still reads clearly (lit and unlit slopes), so it is the default; the fixed relief
 * light stays available as a labelled alternative.
 */
const OPENING_LIGHTING: Lighting = "sun";
const BODIES: BodyId[] = ["sun", "earth"];
const BODY_LABEL = { sun: "Sun", earth: "Earth" } as const satisfies Record<BodyId, string>;

/** Remount per site, so an old terrain model can never be labelled as a new site. */
export function TerrainView(props: Props) {
  return <TerrainPanel key={props.site.site.id} {...props} />;
}

type ReadoutRefs = Record<BodyId, { box: HTMLDivElement | null; state: HTMLSpanElement | null; angles: HTMLElement | null; surface: HTMLElement | null }>;

function TerrainPanel(p: Props) {
  const [active, setActive] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [lighting, setLighting] = useState<Lighting>(OPENING_LIGHTING);
  const [speed, setSpeed] = useState<Speed>(DEFAULT_SPEED);
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<TerrainScene | null>(null);
  const stepMs = p.site.time.stepSeconds * 1000;
  const lastIndex = p.sampleCount - 1;
  const i0 = Math.round((p.windowStartMs - Date.parse(p.site.time.startUtc)) / stepMs);
  // Directions at the shared cursor, for the view buttons (the animated frame is painted imperatively below).
  const directions = useMemo(() => directionsAt(p.site, p.horizon, i0 + p.cursor), [p.site, p.horizon, i0, p.cursor]);
  const available = !p.site.synthetic && Boolean(p.site.horizons.terrain);
  // The source tag is shown only for measured terrain, with the resolution the dataset records for it.
  const terrainDem = available ? p.site.horizons.terrain?.dem : undefined;

  // Playback position in samples from the window start (fractional while playing). Everything inside this panel is
  // painted from it every frame without React; the shared cursor (sky plot, timelines) is published at most every
  // PUBLISH_MS while playing, and exactly when playback stops.
  const position = useRef(p.cursor);
  /**
   * The last index we published, and the indexes of this playback run that may still arrive as the shared cursor: the
   * index the run started from and every index published since (a transition may land late). A run only moves
   * forward and its publishes land in order, so once one has arrived the earlier ones are dropped: after that, the
   * same value coming in again is someone else moving the cursor back.
   */
  const sentIndex = useRef(p.cursor);
  const sentDuringRun = useRef(new Set<number>());
  const alive = useRef(true);
  // Set on every mount: React's development StrictMode runs effects, cleans them up and runs them again.
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const latest = useRef({ p, speed });
  latest.current = { p, speed };
  const timeRef = useRef<HTMLSpanElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const readouts = useRef<ReadoutRefs>({ sun: { box: null, state: null, angles: null, surface: null }, earth: { box: null, state: null, angles: null, surface: null } });

  /** Draw one moment: scene, text readouts and strip playhead all from the same directions and analysis states. */
  const paint = useCallback((pos: number) => {
    const { site, horizon, results, windowStartMs, sampleCount } = latest.current.p;
    const step = site.time.stepSeconds * 1000;
    const first = Math.round((windowStartMs - Date.parse(site.time.startUtc)) / step);
    const tMs = windowStartMs + pos * step;
    const d = directionsAtPosition(site, horizon, first + pos);
    const status = statusAt(results, tMs);
    // Does the drawn surface tell the same story as the analysis? Display only: it flags, it never sets a state.
    const skyline = scene.current?.skyline ?? null;
    const check = { sun: surfaceCheck(skyline, d.sun, status.sun.state), earth: surfaceCheck(skyline, d.earth, status.earth.state) };
    const terrain = horizon.kind === "terrain" ? site.horizons.terrain : undefined;
    const terrainSource = terrain
      ? `LOLA ${terrain.dem.resolutionM} m terrain from ${terrain.nearFieldStartM} m out, seen from the ${site.site.observerHeightM} m mast`
      : null;
    scene.current?.setFrame({
      directions: d,
      state: { sun: status.sun.state, earth: status.earth.state },
      surface: { sun: check.sun.agreement, earth: check.earth.agreement },
      geometric: horizon.kind === "geometric",
    });
    if (timeRef.current) timeRef.current.textContent = fmtUtc(tMs);
    if (sliderRef.current) sliderRef.current.value = String(Math.floor(pos));
    if (playheadRef.current) playheadRef.current.style.left = `${sampleCount > 1 ? (pos / (sampleCount - 1)) * 100 : 0}%`;
    for (const body of BODIES) {
      const r = readouts.current[body];
      const s = status[body];
      if (r.box) r.box.dataset.state = s.state;
      if (r.state) r.state.textContent = `${STATE_LABEL[s.state]}${s.near ? " · near horizon (uncertain)" : ""}`;
      if (r.angles) r.angles.textContent = `Az ${fmtDeg(d[body]?.az ?? null)} · El ${fmtDeg(d[body]?.el ?? null)}`;
      if (r.surface) {
        const c = check[body];
        r.surface.dataset.surface = c.agreement;
        r.surface.textContent = c.agreement === "differs"
          ? surfaceNote(BODY_LABEL[body], c, d[body], s.state, s.near, terrainSource, v => fmtDeg(v, 3))
          : c.agreement !== "agrees" || c.surfaceDeg === null ? ""
          : terrainSource === null ? `Drawn 3D surface here: ${fmtDeg(c.surfaceDeg)} (this mode ignores terrain)`
          : `Drawn 3D surface here: ${fmtDeg(c.surfaceDeg)} · the drawn skyline matches the result (display only)`;
      }
    }
  }, []);

  /** Stop any playback at once and rest on this exact index, without publishing anything. */
  const restOn = useCallback((index: number) => {
    scene.current?.setDriver(null); // now, not at the next effect cleanup: no further frame may advance or publish
    setPlaying(false);
    sentIndex.current = index;
    sentDuringRun.current = new Set();
    position.current = index;
  }, []);

  useEffect(() => {
    if (!active || !host.current) return;
    const controller = new AbortController();
    let instance: TerrainScene | null = null;
    setReady(false); setError(null);
    import("../terrain/scene")
      .then(module => module.createTerrainScene(host.current!, p.site, p.demSha256, controller.signal, () => {
        setError("The 3D view was interrupted by your device. Reload it to continue.");
        setReady(false); setPlaying(false);
      }))
      .then(result => {
        if (controller.signal.aborted) { result.dispose(); return; }
        instance = result; scene.current = result;
        setReady(true);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : "The 3D view could not be opened.");
      });
    return () => { controller.abort(); instance?.dispose(); scene.current = null; };
  }, [active, attempt, p.site, p.demSha256]);

  // Shared cursor moved by anything other than our own playback (timeline drag, slider, window change): follow it.
  // A value we published ourselves (possibly landing late, as a transition) is not an outside move.
  useLayoutEffect(() => {
    if (p.cursor === sentIndex.current || sentDuringRun.current.has(p.cursor)) {
      if (!playing && p.cursor === sentIndex.current) sentDuringRun.current = new Set(); // settled on the exact value
      else for (const sent of sentDuringRun.current) if (sent < p.cursor) sentDuringRun.current.delete(sent);
      return;
    }
    restOn(p.cursor);
    paint(p.cursor);
  }, [p.cursor, playing, active, paint, restOn]);
  // A new window or a closed panel is an outside change too, even when the cursor value itself did not move.
  useLayoutEffect(() => { restOn(latest.current.p.cursor); }, [p.windowStartMs, p.sampleCount, active, restOn]);
  // New results, horizon mode or a freshly opened panel or scene: redraw the current moment.
  useLayoutEffect(() => { paint(position.current); }, [p.results, p.horizon, active, ready, paint]);
  useEffect(() => { scene.current?.setLighting(lighting); }, [lighting, ready]);

  useEffect(() => {
    const s = scene.current;
    if (!playing || !ready || error || !s) return;
    let last: number | null = null;
    let lastPublish = -Infinity;
    s.setDriver(now => {
      const { p: q, speed: hoursPerSecond } = latest.current;
      const next = advance(position.current, last === null ? 0 : now - last, hoursPerSecond, q.site.time.stepSeconds, q.sampleCount - 1);
      last = now;
      position.current = next.position;
      paint(next.position);
      const index = Math.floor(next.position);
      if (index !== sentIndex.current && now - lastPublish >= PUBLISH_MS && !next.done) {
        // A transition: React may render the rest of the app in slices, so it never blocks a frame for long.
        lastPublish = now;
        sentIndex.current = index;
        sentDuringRun.current.add(index);
        startTransition(() => q.onCursor(index));
      }
      if (next.done) { setPlaying(false); return false; }
      return true;
    });
    const pauseWhenHidden = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => {
      s.setDriver(null);
      document.removeEventListener("visibilitychange", pauseWhenHidden);
      // At rest everything shows exactly one sample, and the shared cursor is published exactly (not as a transition).
      // Always, even when this index was already sent: that earlier publish may still be a pending transition, and
      // an urgent one after it leaves nothing to land later, so the panel and the shared cursor rest on one sample.
      const index = Math.floor(position.current);
      position.current = index;
      sentIndex.current = index;
      if (alive.current) latest.current.p.onCursor(index);
      paint(index);
    };
  }, [playing, ready, error, paint]);

  const togglePlay = () => {
    if (playing) { setPlaying(false); return; }
    let from = p.cursor;
    if (from >= lastIndex) { from = 0; p.onCursor(0); }
    sentIndex.current = from;
    sentDuringRun.current = new Set([from]);
    position.current = from;
    setPlaying(true);
  };

  return (
    <section className="terrain-panel" aria-labelledby="terrain-title" data-testid="terrain-panel">
      <div className="terrain-heading">
        <div>
          <p className="terrain-kicker">THE LANDSCAPE BEHIND THE NUMBERS</p>
          <h2 id="terrain-title"><Cube size={23} aria-hidden /> Explore the terrain in 3D</h2>
          <p>{p.site.site.name} · {p.site.site.locationHint}</p>
        </div>
        {terrainDem && <span className="mode-tag terrain-source">NASA LOLA · {terrainDem.resolutionM} m source</span>}
      </div>
      {!active ? (
        <div className="terrain-intro">
          <div>
            <strong>A real lunar surface, at its true scale.</strong>
            <p>Orbit the measured terrain. Press play to watch the Sun and Earth move around the horizon through your mission.</p>
            <p className="terrain-small">No invented mountains. No height exaggeration.</p>
          </div>
          <button className="btn primary terrain-primary" disabled={!available} onClick={() => setActive(true)}>
            <Cube size={19} aria-hidden /> {available ? "Open 3D terrain" : "No measured 3D data"}
          </button>
        </div>
      ) : (
        <>
          <div className="terrain-viewport">
            <div className="terrain-canvas" ref={host} data-testid="terrain-canvas" data-ready={ready && !error} />
            {(!ready || error) && <div className="terrain-status" role="status">
              <Cube size={32} aria-hidden />
              <p>{error ?? "Loading measured lunar terrain…"}</p>
              {error && <button className="btn" onClick={() => setAttempt(a => a + 1)}>Reload 3D view</button>}
            </div>}
            {ready && !error && <div className="terrain-overlay" aria-hidden="true">
              <span data-testid="terrain-lighting-tag">{lighting === "relief" ? "RELIEF LIGHT · FIXED" : "SUN DIRECTION · LIVE"}</span>
              <span>HEIGHT 1×</span>
            </div>}
            <span className="terrain-gesture">Drag to orbit · Scroll to zoom</span>
          </div>
          <div className="terrain-tools" aria-label="Terrain camera and lighting">
            <div className="terrain-buttons">
              <button className="btn" disabled={!ready} onClick={() => scene.current?.view("overview")}><ArrowCounterClockwise size={16} aria-hidden /> Reset view</button>
              <button className="btn" disabled={!ready} onClick={() => scene.current?.view("top")}>Top view</button>
              <button className="btn" disabled={!ready || !directions.sun} onClick={() => scene.current?.view("sun")}><Sun size={16} aria-hidden /> Face Sun</button>
              <button className="btn" disabled={!ready || !directions.earth} onClick={() => scene.current?.view("earth")}><GlobeHemisphereWest size={16} aria-hidden /> Face Earth</button>
            </div>
            <fieldset className="terrain-light">
              <legend>Lighting</legend>
              <label><input type="radio" name="terrain-lighting" checked={lighting === "sun"} onChange={() => setLighting("sun")} /> Sun direction</label>
              <label><input type="radio" name="terrain-lighting" checked={lighting === "relief"} onChange={() => setLighting("relief")} /> Fixed relief</label>
            </fieldset>
          </div>
          <div className="terrain-time">
            <button className="btn terrain-play" disabled={!ready || Boolean(error)} aria-label={playing ? "Pause terrain time" : "Play terrain time"} onClick={togglePlay}>
              {playing ? <Pause size={18} weight="fill" aria-hidden /> : <Play size={18} weight="fill" aria-hidden />}
            </button>
            <div className="terrain-time-track">
              <label htmlFor="terrain-time-slider">Mission time <span className="num" data-testid="terrain-time-readout" ref={timeRef} /></label>
              <div className="terrain-strip-grid">
                <VisibilityStrip results={p.results} windowStartMs={p.windowStartMs} windowEndMs={p.windowStartMs + lastIndex * stepMs} playheadRef={playheadRef} />
                <span className="terrain-strip-spacer" aria-hidden />
                <input id="terrain-time-slider" ref={sliderRef} aria-label="3D mission time" type="range" min={0} max={lastIndex} step={1}
                  defaultValue={p.cursor}
                  onChange={e => {
                    // Uncontrolled: paint() moves it every frame; a scrub pauses and becomes the exact shared cursor.
                    const index = Number(e.target.value);
                    sentIndex.current = index; position.current = index;
                    setPlaying(false); p.onCursor(index); paint(index);
                  }} />
              </div>
            </div>
            <label className="terrain-speed">
              <span>Speed</span>
              <select aria-label="Playback speed" value={speed} onChange={e => setSpeed(Number(e.target.value) as Speed)}>
                {SPEEDS.map(h => <option key={h} value={h}>{h} h of mission time per second</option>)}
              </select>
            </label>
          </div>
          <div className="terrain-readouts" data-testid="terrain-readouts" aria-live={playing ? "off" : "polite"}>
            {BODIES.map(body => (
              <div key={body} className={`terrain-body terrain-${body}`} data-testid={`terrain-state-${body}`}
                ref={el => { readouts.current[body].box = el; }}>
                <strong><span className="terrain-swatch" aria-hidden /> {BODY_LABEL[body]}</strong>
                <span ref={el => { readouts.current[body].state = el; }} />
                <small ref={el => { readouts.current[body].angles = el; }} />
                <small className="terrain-surface" data-testid={`terrain-surface-${body}`} ref={el => { readouts.current[body].surface = el; }} />
              </div>
            ))}
            <ModeTag horizon={p.horizon} />
          </div>
          {p.horizon.kind === "geometric" && <p className="terrain-model-note">Terrain is shown for context. The visibility states currently use the flat 0° geometric horizon.</p>}
          <p className="terrain-footnote">
            {lighting === "relief"
              ? "Fixed relief lighting reveals the landscape and casts no shadows."
              : "Sunlight and cast shadows come from the drawn 3D surface, with a uniform fill light so ground in shadow stays readable. Shadows are display only: their edges are approximate, they fall on the ground rather than at the mast top, and they are not compared with the result."}
            {" "}The drawn surface is a simplified display mesh, so at a few moments it can hide a centre the analysis counts as visible, or the reverse: the view checks this whenever it can compare the two and says so on the ray and in the readout above.
            {" "}Visible, blocked and no-data states on the rays, the marker rings (inner Sun, outer Earth), the strip and these readouts come from the same analysis as the timelines: solid and coloured when the centre is visible, grey and dashed with an open marker when blocked, faint and dotted when there is no data.
            {" "}The rays and markers show directions from the {p.site.site.observerHeightM} m mast, not body distances or sizes.
          </p>
          <div className="terrain-footer">
            <a href="https://pgda.gsfc.nasa.gov/products/90" target="_blank" rel="noreferrer">NASA / GSFC / LOLA · Barker et al. 2023 <ArrowSquareOut size={14} aria-hidden /></a>
            <button className="btn" onClick={() => { setPlaying(false); setActive(false); }}>Close 3D view</button>
          </div>
        </>
      )}
    </section>
  );
}

const STRIP_W = 1000;
const ROW_H = 10;
const ROW_GAP = 4;

/** Visible / blocked / no-data stretches per body across the window, drawn from the analysis intervals. */
function VisibilityStrip({ results, windowStartMs, windowEndMs, playheadRef }: {
  results: Record<BodyId, AnalysisResult>;
  windowStartMs: number;
  windowEndMs: number;
  playheadRef: React.RefObject<HTMLDivElement | null>;
}) {
  const span = Math.max(1, windowEndMs - windowStartMs);
  const x = (iso: string) => ((Date.parse(iso) - windowStartMs) / span) * STRIP_W;
  const fill = (body: BodyId, s: VisState) => (s === "visible" ? `var(--t3d-${body})` : `url(#t3d-${s})`);
  return (
    <>
      <span className="terrain-strip-labels" aria-hidden><span>Sun</span><span>Earth</span></span>
      <div className="terrain-strip" data-testid="terrain-strip" role="img"
        aria-label="Sun and Earth centre visibility across the selected analysis interval, from the same analysis as the timelines. Solid: visible. Striped: blocked. Cross-hatched: no data.">
        <svg viewBox={`0 0 ${STRIP_W} ${ROW_H * 2 + ROW_GAP}`} preserveAspectRatio="none" aria-hidden>
          <defs>
            <pattern id="t3d-blocked" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="5" height="5" fill="#2a3543" />
              <line x1="0" y1="0" x2="0" y2="5" stroke="#7d8a9b" strokeWidth="1.6" />
            </pattern>
            <pattern id="t3d-unknown" width="6" height="6" patternUnits="userSpaceOnUse">
              <rect width="6" height="6" fill="#121b26" />
              <path d="M0 0 L6 6 M6 0 L0 6" stroke="#5b6676" strokeWidth="1" />
            </pattern>
          </defs>
          {BODIES.map((body, row) => (
            <g key={body} data-body={body}>
              <rect x={0} y={row * (ROW_H + ROW_GAP)} width={STRIP_W} height={ROW_H} fill="#121b26" />
              {results[body].intervals.map((iv, k) => {
                const a = x(iv.startUtc);
                return <rect key={k} data-state={iv.state} x={a} y={row * (ROW_H + ROW_GAP)} width={Math.max(0.8, x(iv.endUtc) - a)} height={ROW_H} fill={fill(body, iv.state)} />;
              })}
            </g>
          ))}
        </svg>
        <div className="terrain-playhead" ref={playheadRef} />
      </div>
    </>
  );
}
