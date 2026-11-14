import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowCounterClockwise, ArrowSquareOut, Cube, Pause, Play, Sun, GlobeHemisphereWest } from "@phosphor-icons/react";
import type { HorizonInput, SiteDataset } from "../contract/types";
import { fmtDeg, fmtUtc } from "../analysis/format";
import { directionsAt } from "../terrain/geometry";
import type { TerrainScene } from "../terrain/scene";
import { ModeTag } from "./ModeTag";
import "../terrain/terrain.css";

interface Props {
  site: SiteDataset;
  horizon: HorizonInput;
  windowStartMs: number;
  sampleCount: number;
  cursor: number;
  onCursor: (index: number) => void;
}

/** Remount per site, so an old terrain model can never be labelled as a new site. */
export function TerrainView(props: Props) {
  return <TerrainPanel key={props.site.site.id} {...props} />;
}

function TerrainPanel(p: Props) {
  const [active, setActive] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [relief, setRelief] = useState(true);
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<TerrainScene | null>(null);
  const i0 = Math.round((p.windowStartMs - Date.parse(p.site.time.startUtc)) / (p.site.time.stepSeconds * 1000));
  const directions = useMemo(() => directionsAt(p.site, p.horizon, i0 + p.cursor), [p.site, p.horizon, i0, p.cursor]);
  const latest = useRef({ directions, relief });
  latest.current = { directions, relief };
  const cursorRef = useRef(p.cursor);
  cursorRef.current = p.cursor;
  const cursorMs = p.windowStartMs + p.cursor * p.site.time.stepSeconds * 1000;
  const available = !p.site.synthetic && Boolean(p.site.horizons.terrain);

  useEffect(() => {
    if (!active || !host.current) return;
    const controller = new AbortController();
    let instance: TerrainScene | null = null;
    setReady(false); setError(null);
    import("../terrain/scene")
      .then(module => module.createTerrainScene(host.current!, p.site, controller.signal, () => {
        setError("The 3D view was interrupted by your device. Reload it to continue.");
        setReady(false); setPlaying(false);
      }))
      .then(result => {
        if (controller.signal.aborted) { result.dispose(); return; }
        instance = result; scene.current = result;
        result.update(latest.current.directions, latest.current.relief);
        setReady(true);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : "The 3D view could not be opened.");
      });
    return () => { controller.abort(); instance?.dispose(); scene.current = null; };
  }, [active, attempt, p.site]);

  useEffect(() => { scene.current?.update(directions, relief); }, [directions, relief]);
  useEffect(() => { setPlaying(false); }, [p.windowStartMs, p.sampleCount, active]);
  useEffect(() => {
    if (!playing || !ready || error) return;
    const timer = window.setInterval(() => {
      const next = Math.min(cursorRef.current + Math.max(1, Math.round(3600 / p.site.time.stepSeconds)), p.sampleCount - 1);
      p.onCursor(next);
      if (next >= p.sampleCount - 1) setPlaying(false);
    }, 400);
    const pauseWhenHidden = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", pauseWhenHidden); };
  }, [playing, ready, error, p.sampleCount, p.site.time.stepSeconds, p.onCursor]);

  return (
    <section className="terrain-panel" aria-labelledby="terrain-title" data-testid="terrain-panel">
      <div className="terrain-heading">
        <div>
          <p className="terrain-kicker">THE LANDSCAPE BEHIND THE NUMBERS</p>
          <h2 id="terrain-title"><Cube size={23} aria-hidden /> Explore the terrain in 3D</h2>
          <p>{p.site.site.name} · {p.site.site.locationHint}</p>
        </div>
        <span className="terrain-source">NASA LOLA · 40 m source</span>
      </div>
      {!active ? (
        <div className="terrain-intro">
          <div>
            <strong>A real lunar surface, at its true scale.</strong>
            <p>Orbit the measured terrain. Follow the Sun and Earth directions as you move through your mission.</p>
            <p className="terrain-small">No invented mountains. No height exaggeration.</p>
          </div>
          <button className="terrain-primary" disabled={!available} onClick={() => setActive(true)}>
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
              {error && <button className="terrain-button" onClick={() => setAttempt(a => a + 1)}>Reload 3D view</button>}
            </div>}
            {ready && !error && <div className="terrain-overlay" aria-hidden="true">
              <span>{relief ? "RELIEF LIGHT · FIXED" : "SUN DIRECTION · LIVE"}</span>
              <span>HEIGHT 1×</span>
            </div>}
            <span className="terrain-gesture">Drag to orbit · Scroll to zoom</span>
          </div>
          <div className="terrain-tools" aria-label="Terrain camera and lighting">
            <div className="terrain-buttons">
              <button className="terrain-button" disabled={!ready} onClick={() => scene.current?.view("overview")}><ArrowCounterClockwise size={16} aria-hidden /> Reset view</button>
              <button className="terrain-button" disabled={!ready} onClick={() => scene.current?.view("top")}>Top view</button>
              <button className="terrain-button" disabled={!ready || !directions.sun} onClick={() => scene.current?.view("sun")}><Sun size={16} aria-hidden /> Face Sun</button>
              <button className="terrain-button" disabled={!ready || !directions.earth} onClick={() => scene.current?.view("earth")}><GlobeHemisphereWest size={16} aria-hidden /> Face Earth</button>
            </div>
            <label className="terrain-light"><input type="checkbox" checked={relief} onChange={e => setRelief(e.target.checked)} /> Relief light</label>
          </div>
          <div className="terrain-time">
            <button className="terrain-button terrain-play" disabled={!ready || Boolean(error)} aria-label={playing ? "Pause terrain time" : "Play terrain time"} onClick={() => {
              if (!playing && p.cursor >= p.sampleCount - 1) { cursorRef.current = 0; p.onCursor(0); }
              setPlaying(v => !v);
            }}>{playing ? <Pause size={18} weight="fill" aria-hidden /> : <Play size={18} weight="fill" aria-hidden />}</button>
            <div className="terrain-time-track">
              <label htmlFor="terrain-time-slider">Shared mission time <span className="num" data-testid="terrain-time-readout">{fmtUtc(cursorMs)}</span></label>
              <input id="terrain-time-slider" aria-label="3D mission time" type="range" min={0} max={p.sampleCount - 1} step={1} value={p.cursor}
                onChange={e => { setPlaying(false); p.onCursor(Number(e.target.value)); }} />
            </div>
            <span className="terrain-small">1 h / play step</span>
          </div>
          <div className="terrain-readouts" data-testid="terrain-readouts">
            {(["sun", "earth"] as const).map(body => {
              const d = directions[body];
              return <div key={body} className={`terrain-body terrain-${body}`}>
                <strong>{body === "sun" ? "☀ Sun" : "◇ Earth"}</strong>
                <span>{!d ? "No sample" : d.margin > 0 ? "Centre visible" : "Centre blocked"}{d?.near ? " · near horizon" : ""}</span>
                <small>Az {fmtDeg(d?.az ?? null)} · El {fmtDeg(d?.el ?? null)}</small>
              </div>;
            })}
            <ModeTag horizon={p.horizon} />
          </div>
          {p.horizon.kind === "geometric" && <p className="terrain-model-note">Terrain is shown for context. The visibility labels currently use the flat 0° geometric horizon.</p>}
          <p className="terrain-footnote">
            {relief ? "Fixed relief lighting reveals the landscape." : "Surface shading follows the Sun, with a small fill light for legibility."}
            {" "}Cast shadows are not simulated. The dashed rays and enlarged markers show directions from the 2 m mast, not body distances or sizes.
            Visibility labels use the original horizon calculation.
          </p>
          <div className="terrain-footer">
            <a href="https://pgda.gsfc.nasa.gov/products/90" target="_blank" rel="noreferrer">NASA / GSFC / LOLA · Barker et al. 2023 <ArrowSquareOut size={14} aria-hidden /></a>
            <button className="terrain-button" onClick={() => { setPlaying(false); setActive(false); }}>Close 3D view</button>
          </div>
        </>
      )}
    </section>
  );
}
