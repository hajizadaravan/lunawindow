import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowCounterClockwise, Flask, Info, Warning, WarningOctagon } from "@phosphor-icons/react";
import type { AnalysisResult, HorizonInput, Manifest } from "./contract/types";
import { analyzeVisibility, toIso } from "./analysis/visibility";
import { clampStart, durationOnGrid, startBounds } from "./analysis/window";
import { fmtUtc } from "./analysis/format";
import { DataLoadError, loadManifest, loadSite, DATA_DIR } from "./lib/data";
import { SitePicker } from "./components/SitePicker";
import { MissionForm, type LimitsInput } from "./components/MissionForm";
import { HorizonSwitch, type HorizonMode } from "./components/HorizonSwitch";
import { BodyCard } from "./components/BodyCard";
import { Timelines } from "./components/Timelines";
import { HorizonView } from "./components/HorizonView";
import { Comparison } from "./components/Comparison";
import { AssumptionsDialog } from "./components/AssumptionsDialog";
import { Headline } from "./components/Headline";
import { StartCalendar, type SiteState } from "./components/StartCalendar";
import { TerrainView } from "./components/TerrainView";
import { LandingHero, LandingSections, type DemoStory } from "./landing";

const MS_PER_HOUR = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * The example scenario (docs/demo-script.md section 3). These are inputs only; every result shown for them is
 * computed from the cached dataset.
 */
export const EXAMPLE = {
  siteId: "demo-a",
  startUtc: "2027-02-10T00:00:00Z",
  durationHours: 168,
  mode: "terrain" as HorizonMode,
  limits: { sun: "6", earth: "" } as LimitsInput,
  compare: true,
};

export function parseLimit(raw: string): { value: number | null; error: string | null } {
  const t = raw.trim();
  if (t === "") return { value: null, error: null };
  const v = Number(t);
  if (!Number.isFinite(v) || v <= 0) return { value: null, error: "Enter a positive number of hours, or leave it empty." };
  if (v > 10_000) return { value: null, error: "That is longer than any analysis window here." };
  return { value: v, error: null };
}

type Pair = { sun: AnalysisResult; earth: AnalysisResult };

function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return false;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  const focusTarget = el.querySelector<HTMLElement>("h2[tabindex='-1']") ?? el;
  focusTarget.focus({ preventScroll: true });
  return true;
}

export function App() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [sites, setSites] = useState<Record<string, SiteState>>({});
  const [requestedStartMs, setRequestedStartMs] = useState<number | null>(null);
  const [durationHours, setDurationHours] = useState(EXAMPLE.durationHours);
  const [limits, setLimits] = useState<LimitsInput>(EXAMPLE.limits);
  const [mode, setMode] = useState<HorizonMode>(EXAMPLE.mode);
  const [compare, setCompare] = useState(EXAMPLE.compare);
  const [cursor, setCursor] = useState(0);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  const loadingRef = useRef(new Set<string>());

  useEffect(() => {
    loadManifest()
      .then((m) => {
        setManifest(m);
        const hasExample = m.sites.some((s) => s.id === EXAMPLE.siteId);
        if (hasExample) {
          setSiteId(EXAMPLE.siteId);
          setRequestedStartMs(Date.parse(EXAMPLE.startUtc));
        } else {
          // A dataset without the example point opens on its own defaults with no example applied.
          setSiteId(m.sites.some((s) => s.id === m.defaults.siteId) ? m.defaults.siteId : m.sites[0].id);
          setDurationHours(m.defaults.durationHours);
          setRequestedStartMs(Date.parse(m.supportedRange.startUtc));
          setLimits({ sun: "", earth: "" });
          setCompare(false);
        }
      })
      .catch((e: unknown) => setManifestError(e instanceof DataLoadError ? e.message : String(e)));
  }, []);

  const requestSite = useCallback(
    (id: string) => {
      const entry = manifest?.sites.find((s) => s.id === id);
      if (!entry || loadingRef.current.has(id)) return;
      loadingRef.current.add(id);
      setSites((s) => ({ ...s, [id]: { status: "loading" } }));
      loadSite(entry.file)
        .then((data) => setSites((s) => ({ ...s, [id]: { status: "ok", data } })))
        .catch((e: unknown) => {
          loadingRef.current.delete(id);
          setSites((s) => ({ ...s, [id]: { status: "error", message: e instanceof Error ? e.message : String(e) } }));
        });
    },
    [manifest],
  );

  useEffect(() => {
    if (siteId) requestSite(siteId);
  }, [siteId, requestSite]);

  const siteState = siteId ? sites[siteId] : undefined;
  const site = siteState?.status === "ok" ? siteState.data : null;

  // The other points (for the calendar) load only after the selected one is on screen.
  useEffect(() => {
    if (!manifest || !site) return;
    const t = window.setTimeout(() => manifest.sites.forEach((s) => requestSite(s.id)), 50);
    return () => window.clearTimeout(t);
  }, [manifest, site, requestSite]);

  const shiftHours = manifest?.defaults.shiftHours ?? 24;

  const bounds = useMemo(
    () => (manifest && site ? startBounds(manifest.supportedRange, site.time, durationHours, shiftHours) : null),
    [manifest, site, durationHours, shiftHours],
  );
  const startMs = bounds && requestedStartMs !== null ? clampStart(requestedStartMs, bounds) : null;
  const durationOk = site ? durationOnGrid(durationHours, site.time.stepSeconds) : true;

  const terrainAvailable = Boolean(site?.horizons.terrain);
  const effectiveMode: HorizonMode = mode === "terrain" && terrainAvailable ? "terrain" : "geometric";
  const horizon: HorizonInput | null = site
    ? effectiveMode === "terrain"
      ? site.horizons.terrain!
      : site.horizons.geometric
    : null;

  const sunLimit = parseLimit(limits.sun);
  const earthLimit = parseLimit(limits.earth);
  const parsedLimits = useMemo(() => ({ sun: sunLimit.value, earth: earthLimit.value }), [sunLimit.value, earthLimit.value]);

  const analysis = useMemo(() => {
    if (!site || !horizon || startMs === null || !durationOk) return null;
    try {
      const run = (offsetH: number, body: "sun" | "earth", limitHours: number | null): AnalysisResult =>
        analyzeVisibility({
          time: site.time,
          track: site.ephemeris.bodies[body],
          horizon,
          body,
          windowStartUtc: toIso(startMs + offsetH * MS_PER_HOUR),
          durationHours,
          limitHours,
        });
      return {
        base: { sun: run(0, "sun", sunLimit.value), earth: run(0, "earth", earthLimit.value) } as Pair,
        shifted: { sun: run(shiftHours, "sun", sunLimit.value), earth: run(shiftHours, "earth", earthLimit.value) } as Pair,
        error: null as string | null,
      };
    } catch (e) {
      return { base: null, shifted: null, error: (e as Error).message };
    }
  }, [site, horizon, startMs, durationHours, durationOk, sunLimit.value, earthLimit.value, shiftHours]);

  // The landing story: the example scenario computed from the demo-a dataset with the analysis module.
  const exampleState = sites[EXAMPLE.siteId];
  const story: DemoStory | null = useMemo(() => {
    if (!manifest || exampleState?.status !== "ok") return null;
    const s = exampleState.data;
    const h: HorizonInput = s.horizons.terrain ?? s.horizons.geometric;
    const label = s.horizons.terrain ? s.horizons.terrain.label : s.horizons.geometric.label;
    const limit = Number(EXAMPLE.limits.sun);
    const sh = manifest.defaults.shiftHours;
    try {
      const run = (offsetH: number, body: "sun" | "earth") =>
        analyzeVisibility({
          time: s.time,
          track: s.ephemeris.bodies[body],
          horizon: h,
          body,
          windowStartUtc: toIso(Date.parse(EXAMPLE.startUtc) + offsetH * MS_PER_HOUR),
          durationHours: EXAMPLE.durationHours,
          limitHours: body === "sun" ? limit : null,
        }).longestInterruption?.durationHours ?? 0;
      return {
        siteName: s.site.name,
        startUtc: toIso(Date.parse(EXAMPLE.startUtc)),
        durationDays: EXAMPLE.durationHours / 24,
        shiftHours: sh,
        limitHours: limit,
        baseSunGapHours: run(0, "sun"),
        shiftedSunGapHours: run(sh, "sun"),
        baseEarthGapHours: run(0, "earth"),
        shiftedEarthGapHours: run(sh, "earth"),
        horizonLabel: label,
      };
    } catch {
      return null;
    }
  }, [manifest, exampleState]);

  const sampleCount = site ? Math.round((durationHours * 3600) / site.time.stepSeconds) + 1 : 1;
  useEffect(() => {
    setCursor((c) => Math.min(c, sampleCount - 1));
  }, [sampleCount]);
  // The effect above runs after render, so a shorter window would be drawn once with the old, larger cursor
  // (reading past the dataset and crashing the page). Everything below uses the clamped value.
  const cursorInWindow = Math.max(0, Math.min(cursor, sampleCount - 1));

  // Scroll after the state change has rendered the target.
  useEffect(() => {
    if (!scrollTarget) return;
    if (scrollToId(scrollTarget)) setScrollTarget(null);
  }, [scrollTarget, analysis]);

  const exampleAvailable = Boolean(manifest?.sites.some((s) => s.id === EXAMPLE.siteId));
  const applyExample = useCallback(() => {
    setSiteId(EXAMPLE.siteId);
    setRequestedStartMs(Date.parse(EXAMPLE.startUtc));
    setDurationHours(EXAMPLE.durationHours);
    setLimits(EXAMPLE.limits);
    setMode(EXAMPLE.mode);
    setCompare(EXAMPLE.compare);
    setCursor(0);
    setScrollTarget("result");
  }, []);
  const clearExample = () => {
    if (!manifest) return;
    setRequestedStartMs(Date.parse(manifest.supportedRange.startUtc));
    setDurationHours(manifest.defaults.durationHours);
    setLimits({ sun: "", earth: "" });
    setCompare(false);
    setCursor(0);
  };

  if (manifestError) {
    return (
      <div className="error-page">
        <h1>LunaWindow could not load its data</h1>
        <div className="notice error" role="alert">
          <WarningOctagon size={18} weight="bold" aria-hidden />
          <span>{manifestError}</span>
        </div>
        <p className="muted">
          The app reads cached data from <code>public/{DATA_DIR}/manifest.json</code>. Generate the dataset first (see
          web/README.md), or start with <code>npm run dev:synthetic</code> to use clearly labelled synthetic test data.
        </p>
      </div>
    );
  }

  if (!manifest) {
    return (
      <div className="tool" aria-busy="true">
        <div className="skeleton" style={{ height: 160 }} />
        <div className="skeleton" style={{ height: 360, marginTop: 16 }} />
        <span className="sr-only">Loading dataset</span>
      </div>
    );
  }

  const anySynthetic = manifest.synthetic || Object.values(sites).some((s) => s.status === "ok" && s.data.synthetic);
  const entry = manifest.sites.find((s) => s.id === siteId) ?? manifest.sites[0];
  const adjusted = startMs !== null && requestedStartMs !== null && startMs !== requestedStartMs;
  const openAssumptions = () => setAssumptionsOpen(true);
  const isExample =
    exampleAvailable &&
    siteId === EXAMPLE.siteId &&
    startMs === Date.parse(EXAMPLE.startUtc) &&
    durationHours === EXAMPLE.durationHours &&
    mode === EXAMPLE.mode &&
    limits.sun.trim() === EXAMPLE.limits.sun &&
    limits.earth.trim() === EXAMPLE.limits.earth &&
    compare === EXAMPLE.compare;
  const timeOfDayMs = startMs !== null ? ((startMs % DAY_MS) + DAY_MS) % DAY_MS : 0;

  return (
    <>
      {anySynthetic && (
        <div className="synthetic-banner" role="status" data-testid="synthetic-banner">
          <Warning size={18} weight="bold" aria-hidden />
          Synthetic test data, not NASA measurements. Every number on this page is made up for interface testing.
        </div>
      )}
      <header className="topbar">
        <div className="brand">
          <h1>LunaWindow</h1>
          <p>Longest continuous loss of Sun or Earth visibility at lunar south-pole demonstration points</p>
        </div>
        <button className="btn" type="button" onClick={openAssumptions}>
          <Info size={16} weight="bold" aria-hidden />
          Assumptions &amp; sources
        </button>
      </header>

      <LandingHero
        story={story}
        onTryDemo={applyExample}
        onOpenCalendar={() => setScrollTarget("calendar")}
        onAssumptions={openAssumptions}
      />

      <div className="tool" id="tool">
        <section className="panel scenario" aria-labelledby="scenario-h" data-testid="scenario">
          <div className="scenario-head">
            <h2 id="scenario-h">Mission scenario</h2>
            {isExample ? (
              <span className="example-tag" data-testid="example-tag">
                <Flask size={14} weight="bold" aria-hidden />
                Example scenario
                <button type="button" className="btn link" onClick={clearExample}>
                  <ArrowCounterClockwise size={13} weight="bold" aria-hidden />
                  Clear example
                </button>
              </span>
            ) : (
              exampleAvailable && (
                <button type="button" className="btn" onClick={applyExample} data-testid="try-delay">
                  <Flask size={15} weight="bold" aria-hidden />
                  Try a 24 h delay
                </button>
              )
            )}
          </div>
          <div className="scenario-grid">
            <div className="field f-site">
              <label htmlFor="site-select">Demonstration point</label>
              <select id="site-select" value={entry.id} onChange={(e) => setSiteId(e.target.value)}>
                {manifest.sites.map((s, i) => (
                  <option key={s.id} value={s.id}>
                    {String.fromCharCode(65 + i)}. {s.name}
                  </option>
                ))}
              </select>
            </div>
            <MissionForm
              manifest={manifest}
              bounds={bounds}
              startMs={startMs}
              durationHours={durationHours}
              shiftHours={shiftHours}
              stepSeconds={site?.time.stepSeconds ?? manifest.supportedRange.stepSeconds}
              onStart={(ms) => setRequestedStartMs(ms)}
              onDuration={setDurationHours}
              limits={limits}
              limitErrors={{ sun: sunLimit.error, earth: earthLimit.error }}
              onLimits={setLimits}
            />
            <div className="field f-horizon">
              <span className="label" id="horizon-h">
                Horizon model
              </span>
              <HorizonSwitch
                mode={effectiveMode}
                onChange={setMode}
                terrainAvailable={terrainAvailable}
                siteLoaded={Boolean(site)}
                siteName={entry.name}
              />
            </div>
            <div className="field f-compare">
              <span className="label">Delay check</span>
              <label className="toggle">
                <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
                Also check a start {shiftHours} hours later
              </label>
            </div>
          </div>
          <p id="start-help" className="hint">
            {bounds ? (
              <>
                Allowed starts <span className="num">{fmtUtc(bounds.earliestMs)}</span> to{" "}
                <span className="num">{fmtUtc(bounds.latestMs)}</span> (the window plus {shiftHours} h stays inside the data
                range).
              </>
            ) : (
              "Waiting for site data."
            )}{" "}
            <span id="limits-help">Limits are your own tolerances, not computed battery or radio budgets.</span>
          </p>
          {adjusted && startMs !== null && (
            <div className="notice info" role="status">
              <Info size={16} weight="bold" aria-hidden />
              <span>
                Start moved to <span className="num">{fmtUtc(startMs)}</span> to stay inside the allowed range.
              </span>
            </div>
          )}
        </section>

        {site && horizon && startMs !== null && durationOk && (
          <TerrainView site={site} horizon={horizon} windowStartMs={startMs}
            sampleCount={sampleCount} cursor={cursorInWindow} onCursor={setCursor} />
        )}

        <div className="tool-grid">
          <main className="main" id="results" aria-label="Results">
            {siteState?.status === "error" && (
              <div className="notice error" role="alert">
                <WarningOctagon size={18} weight="bold" aria-hidden />
                <span>
                  Could not load {entry.name}: {siteState.message}{" "}
                  <button
                    className="btn link"
                    type="button"
                    onClick={() => {
                      loadingRef.current.delete(entry.id);
                      requestSite(entry.id);
                    }}
                  >
                    Retry
                  </button>
                </span>
              </div>
            )}
            {(!siteState || siteState.status === "loading") && (
              <div aria-busy="true">
                <span className="sr-only">Loading {entry.name}</span>
                <div className="skeleton" style={{ height: 180, marginBottom: 16 }} />
                <div className="skeleton" style={{ height: 280 }} />
              </div>
            )}
            {site && !bounds && (
              <div className="notice error" role="alert">
                <WarningOctagon size={18} weight="bold" aria-hidden />
                <span>
                  The data range for {entry.name} is too short for a {durationHours / 24}-day window plus the {shiftHours} h
                  comparison. Choose a shorter duration.
                </span>
              </div>
            )}
            {site && !durationOk && (
              <div className="notice error" role="alert">
                <WarningOctagon size={18} weight="bold" aria-hidden />
                <span>The selected duration is not a whole number of {site.time.stepSeconds} s data steps.</span>
              </div>
            )}
            {analysis?.error && (
              <div className="notice error" role="alert">
                <WarningOctagon size={18} weight="bold" aria-hidden />
                <span>Analysis could not run: {analysis.error}</span>
              </div>
            )}
            {site && horizon && analysis?.base && analysis.shifted && startMs !== null && (
              <>
                <div id="result" className="result-anchor">
                  {mode === "terrain" && !terrainAvailable && (
                    <div className="notice" role="status" style={{ marginBottom: 12 }}>
                      <Info size={16} weight="bold" aria-hidden />
                      <span>
                        No terrain horizon exists for {site.site.name}, so these results use the geometric reference
                        horizon (no terrain).
                      </span>
                    </div>
                  )}
                  <Headline
                    siteName={site.site.name}
                    base={analysis.base}
                    shifted={compare ? analysis.shifted : null}
                    shiftHours={shiftHours}
                    durationHours={durationHours}
                    horizon={horizon}
                    onAssumptions={openAssumptions}
                  />
                </div>

                <HorizonView
                  site={site}
                  horizon={horizon}
                  windowStartMs={startMs}
                  sampleCount={sampleCount}
                  cursor={cursorInWindow}
                  bands={{ sun: analysis.base.sun.nearHorizonBandDeg, earth: analysis.base.earth.nearHorizonBandDeg }}
                  onAssumptions={openAssumptions}
                />

                <Timelines
                  sun={analysis.base.sun}
                  earth={analysis.base.earth}
                  site={site}
                  horizon={horizon}
                  cursor={cursorInWindow}
                  onCursor={setCursor}
                  sampleCount={sampleCount}
                  onAssumptions={openAssumptions}
                />

                <section className="panel window-panel" aria-label="Selected analysis interval">
                  <p className="window-line">
                    Selected analysis interval: <span className="num">{fmtUtc(analysis.base.sun.windowStartUtc)}</span> to{" "}
                    <span className="num">{fmtUtc(analysis.base.sun.windowEndUtc)}</span> ({durationHours / 24} days),{" "}
                    {site.site.name} ({site.site.locationHint})
                  </p>
                </section>

                <div className="cards">
                  <BodyCard result={analysis.base.sun} horizon={horizon} onAssumptions={openAssumptions} />
                  <BodyCard result={analysis.base.earth} horizon={horizon} onAssumptions={openAssumptions} />
                </div>

                {compare && (
                  <Comparison
                    shiftHours={shiftHours}
                    base={analysis.base}
                    shifted={analysis.shifted}
                    horizon={horizon}
                    onAssumptions={openAssumptions}
                  />
                )}
              </>
            )}
          </main>
          <aside className="aside" aria-label="Map of the demonstration points">
            <SitePicker manifest={manifest} selectedId={entry.id} onSelect={setSiteId} />
          </aside>
        </div>

        <StartCalendar
          manifest={manifest}
          sites={sites}
          mode={mode}
          durationHours={durationHours}
          shiftHours={shiftHours}
          checkShift={compare}
          onCheckShift={setCompare}
          limits={parsedLimits}
          timeOfDayMs={timeOfDayMs}
          selectedSiteId={entry.id}
          selectedStartMs={startMs}
          onSelect={(id, ms) => {
            setSiteId(id);
            setRequestedStartMs(ms);
            setCursor(0);
            setScrollTarget("result");
          }}
          onEditLimits={() => {
            const el = document.getElementById("limit-sun");
            el?.scrollIntoView({ block: "center" });
            el?.focus({ preventScroll: true });
          }}
          onAssumptions={openAssumptions}
        />
      </div>

      <LandingSections onAssumptions={openAssumptions} />

      <AssumptionsDialog
        open={assumptionsOpen}
        onClose={() => setAssumptionsOpen(false)}
        manifest={manifest}
        site={site}
        horizon={horizon}
        bands={
          analysis?.base
            ? { sun: analysis.base.sun.nearHorizonBandDeg, earth: analysis.base.earth.nearHorizonBandDeg }
            : null
        }
      />
    </>
  );
}
