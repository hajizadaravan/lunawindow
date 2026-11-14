import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowCounterClockwise, ArrowLeft, Flask, Info, Warning, WarningOctagon } from "@phosphor-icons/react";
import type { AnalysisResult, HorizonInput, Manifest, SiteDataset } from "./contract/types";
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
import { Landing, type DemoStory, type StripDay } from "./landing";
import { Mark } from "./landing/Nav";
import { buildPoints, computeReplay, computeStory, computeStrip, type ExampleInputs } from "./lib/landingData";
import { navigate, ROUTE_TITLE, useRoute } from "./lib/route";

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

/**
 * Ref callback for the synthetic-data banner: publishes its height as --lw-banner-h so the landing's sticky nav sits
 * directly below it (landing/styles/nav.css). Without a banner the variable is unset and the nav stays at top 0.
 */
function trackBannerHeight(el: HTMLDivElement | null) {
  if (!el) return;
  const root = document.documentElement;
  const set = () => root.style.setProperty("--lw-banner-h", `${el.getBoundingClientRect().height}px`);
  set();
  const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(set);
  ro?.observe(el);
  return () => {
    ro?.disconnect();
    root.style.removeProperty("--lw-banner-h");
  };
}

/** A story section of the navigator: a landing-scale heading and one plain sentence saying what it shows. */
function StorySection({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: string;
  lead: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="story-section" aria-labelledby={id}>
      <div className="story-head">
        <h2 id={id} className="story-title">
          {title}
        </h2>
        <p className="story-lead">{lead}</p>
      </div>
      {children}
    </section>
  );
}

export function App() {
  const route = useRoute();
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

  // The other points (for the calendar) load only after the selected one is on screen, or has failed to load (else
  // a failed selected point would leave every other point loading forever). The selected point is requested by the
  // effect above only, so a failed one is not retried in a loop from here.
  const selectedSettled = Boolean(site) || siteState?.status === "error";
  useEffect(() => {
    if (!manifest || !selectedSettled) return;
    const t = window.setTimeout(() => manifest.sites.forEach((s) => s.id !== siteId && requestSite(s.id)), 50);
    return () => window.clearTimeout(t);
  }, [manifest, selectedSettled, siteId, requestSite]);

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

  // Landing data: the example scenario evaluated with the analysis module (src/lib/landingData.ts).
  const exampleInputs: ExampleInputs | null = useMemo(
    () =>
      manifest
        ? {
            siteId: EXAMPLE.siteId,
            startUtc: EXAMPLE.startUtc,
            durationHours: EXAMPLE.durationHours,
            shiftHours: manifest.defaults.shiftHours,
            sunLimitHours: Number(EXAMPLE.limits.sun),
          }
        : null,
    [manifest],
  );
  const exampleState = sites[EXAMPLE.siteId];
  const exampleData = exampleState?.status === "ok" ? exampleState.data : null;
  const story: DemoStory | null = useMemo(
    () => (exampleInputs && exampleData ? computeStory(exampleData, exampleInputs) : null),
    [exampleInputs, exampleData],
  );
  const replay = useMemo(
    () => (exampleInputs && exampleData ? computeReplay(exampleData, exampleInputs) : null),
    [exampleInputs, exampleData],
  );
  // The example will never arrive: its point is missing from the manifest, failed to load, or could not be computed.
  const storyFailed = Boolean(
    manifest &&
      (!manifest.sites.some((s) => s.id === EXAMPLE.siteId) ||
        exampleState?.status === "error" ||
        (exampleData && exampleInputs && story === null)),
  );
  const loadFailed = useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const [id, st] of Object.entries(sites)) if (st.status === "error") out[id] = true;
    return out;
  }, [sites]);
  const loadedSites = useMemo(() => {
    const out: Record<string, SiteDataset> = {};
    for (const [id, st] of Object.entries(sites)) if (st.status === "ok") out[id] = st.data;
    return out;
  }, [sites]);
  // The strips (about 80 analysis runs per point) are computed one point at a time after paint, only while the
  // landing is shown, and kept: a loaded dataset never changes.
  const [strips, setStrips] = useState<Record<string, StripDay[] | null>>({});
  useEffect(() => {
    if (route !== "landing" || !manifest || !exampleInputs) return;
    const next = manifest.sites.find((e) => loadedSites[e.id] && !(e.id in strips));
    if (!next) return;
    let timer = 0;
    const frame = window.requestAnimationFrame(() => {
      timer = window.setTimeout(() => {
        let strip: StripDay[] | null;
        try {
          strip = computeStrip(manifest, loadedSites[next.id], exampleInputs);
        } catch {
          strip = null;
        }
        setStrips((prev) => ({ ...prev, [next.id]: strip }));
      }, 0);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [route, manifest, exampleInputs, loadedSites, strips]);
  const points = useMemo(
    () => (manifest && exampleInputs ? buildPoints(manifest, loadedSites, strips, exampleInputs, loadFailed) : []),
    [manifest, exampleInputs, loadedSites, strips, loadFailed],
  );

  const sampleCount = site ? Math.round((durationHours * 3600) / site.time.stepSeconds) + 1 : 1;
  useEffect(() => {
    setCursor((c) => Math.min(c, sampleCount - 1));
  }, [sampleCount]);
  // The effect above runs after render, so a shorter window would be drawn once with the old, larger cursor
  // (reading past the dataset and crashing the page). Everything below uses the clamped value.
  const cursorInWindow = Math.max(0, Math.min(cursor, sampleCount - 1));

  // Scroll after the state change has rendered the target (targets live in the tool view). A target that cannot
  // appear (the selected point failed to load, so neither the result nor the calendar renders) is dropped, and the
  // view falls back to what a plain route change does: top of the page, focus on the main heading.
  const selectedFailed = siteState?.status === "error";
  useEffect(() => {
    if (!scrollTarget || route !== "app") return;
    if (scrollToId(scrollTarget)) {
      setScrollTarget(null);
      return;
    }
    // loadingRef: a retry of the failed point started in this same commit (requestSite runs in an earlier effect).
    if (selectedFailed && !(siteId && loadingRef.current.has(siteId))) {
      setScrollTarget(null);
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      document.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
    }
  }, [scrollTarget, analysis, route, selectedFailed, siteId]);

  useEffect(() => {
    document.title = ROUTE_TITLE[route];
  }, [route]);

  // On a route change (not on first load): back to the top and focus on the view's main heading, unless a scroll
  // target is pending (the effect above has then already scrolled to it and focused it).
  const shownRoute = useRef(route);
  useEffect(() => {
    if (shownRoute.current === route) return;
    shownRoute.current = route;
    // Targets live in the tool view: leaving it drops any target still pending, so it cannot block later changes.
    if (route !== "app") {
      if (scrollTarget) setScrollTarget(null);
    } else if (scrollTarget) return;
    const toTop = () => window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    toTop();
    // A smooth scroll still running in the previous view can land one frame later; reset again after it.
    const frame = window.requestAnimationFrame(toTop);
    const heading = document.querySelector<HTMLElement>("h1");
    if (heading) {
      if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }
    return () => window.cancelAnimationFrame(frame);
    // Only the route change triggers this; scrollTarget is read as of that render.
  }, [route]);

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
        <div className="brand error-brand" aria-hidden>
          <Mark />
          <span>LunaWindow</span>
        </div>
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
      <div className="tool tool-loading" aria-busy="true">
        <div className="app-intro">
          <div className="skeleton skel-title" />
          <div className="skeleton skel-lead" />
        </div>
        <div className="app-hero">
          <div className="skeleton skel-scenario" />
          <div className="skeleton skel-result" />
        </div>
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

  const onTryDemo = () => {
    if (exampleAvailable) applyExample();
    navigate("app");
  };
  const onOpenCalendar = () => {
    setScrollTarget("calendar");
    navigate("app");
  };
  const formProps = {
    manifest,
    bounds,
    startMs,
    durationHours,
    shiftHours,
    stepSeconds: site?.time.stepSeconds ?? manifest.supportedRange.stepSeconds,
    onStart: (ms: number) => setRequestedStartMs(ms),
    onDuration: setDurationHours,
    limits,
    limitErrors: { sun: sunLimit.error, earth: earthLimit.error },
    onLimits: setLimits,
  };
  const onOpenTool = () => {
    setScrollTarget(null);
    navigate("app");
  };

  return (
    <>
      {anySynthetic && (
        <div className="synthetic-banner" role="status" data-testid="synthetic-banner" ref={trackBannerHeight}>
          <Warning size={18} weight="bold" aria-hidden />
          Synthetic test data, not NASA measurements. Every number on this page is made up for interface testing.
        </div>
      )}
      {route === "landing" ? (
        <Landing
          manifest={manifest}
          story={story}
          storyFailed={storyFailed}
          points={points}
          replay={replay}
          example={{
            durationDays: EXAMPLE.durationHours / 24,
            shiftHours: manifest.defaults.shiftHours,
            sunLimitHours: Number(EXAMPLE.limits.sun),
          }}
          onTryDemo={onTryDemo}
          onOpenCalendar={onOpenCalendar}
          onOpenTool={onOpenTool}
          onAssumptions={openAssumptions}
        />
      ) : (
        <>
          <header className="topbar">
            <div className="topbar-inner">
              <div className="brand">
                <Mark />
                <h1 tabIndex={-1}>LunaWindow</h1>
              </div>
              <nav className="topbar-actions" aria-label="LunaWindow">
                <a className="nav-link" href="#/">
                  <ArrowLeft size={16} weight="bold" aria-hidden />
                  About LunaWindow
                </a>
                <button className="btn" type="button" onClick={openAssumptions}>
                  <Info size={16} weight="bold" aria-hidden />
                  Assumptions &amp; sources
                </button>
              </nav>
            </div>
          </header>

          <main className="tool" id="tool">
            <div className="app-intro">
              <h2 className="app-title">Does your mission window fit your limits?</h2>
              <p className="app-lead">
                Choose a point, a start and a duration. You get the longest continuous loss of Sun and Earth visibility
                in that window{compare ? `, and what a start ${shiftHours} hours later changes` : ""}.
              </p>
            </div>

            <div className="app-hero">
              <section className="scenario" aria-labelledby="scenario-h" data-testid="scenario">
                <div className="scenario-head">
                  <h2 id="scenario-h" className="scenario-title">
                    Mission scenario
                  </h2>
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
                <fieldset className="group g-when">
                  <legend>Where and when</legend>
                  <div className="group-fields">
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
                    <MissionForm part="when" {...formProps} />
                  </div>
                  <p id="start-help" className="hint">
                    {bounds ? (
                      <>
                        Allowed starts <span className="num">{fmtUtc(bounds.earliestMs)}</span> to{" "}
                        <span className="num">{fmtUtc(bounds.latestMs)}</span> (the window plus {shiftHours} h stays inside
                        the data range).
                      </>
                    ) : (
                      "Waiting for site data."
                    )}
                  </p>
                </fieldset>
                <fieldset className="group g-limits">
                  <legend>Your limits (optional)</legend>
                  <div className="group-fields">
                    <MissionForm part="limits" {...formProps} />
                  </div>
                  <p id="limits-help" className="hint">
                    Limits are your own tolerances, not computed battery or radio budgets.
                  </p>
                </fieldset>
                <fieldset className="group g-model">
                  <legend>Model and comparison</legend>
                  <div className="group-fields">
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
                </fieldset>
                {adjusted && startMs !== null && (
                  <div className="notice info" role="status">
                    <Info size={16} weight="bold" aria-hidden />
                    <span>
                      Start moved to <span className="num">{fmtUtc(startMs)}</span> to stay inside the allowed range.
                    </span>
                  </div>
                )}
              </section>

              <div className="answer-col" id="results">
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
                  <div className="skel-stack" aria-busy="true">
                    <p className="skel-caption">Loading {entry.name} from the cached dataset…</p>
                    <div className="skeleton skel-result" />
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
                  <div id="result" className="result-anchor">
                    {mode === "terrain" && !terrainAvailable && (
                      <div className="notice result-notice" role="status">
                        <Info size={16} weight="bold" aria-hidden />
                        <span>
                          No terrain horizon exists for {site.site.name}, so these results use the geometric reference
                          horizon (no terrain).
                        </span>
                      </div>
                    )}
                    <Headline
                      siteName={site.site.name}
                      siteHint={site.site.locationHint}
                      base={analysis.base}
                      shifted={compare ? analysis.shifted : null}
                      shiftHours={shiftHours}
                      durationHours={durationHours}
                      horizon={horizon}
                      onAssumptions={openAssumptions}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="story">
              {site && horizon && analysis?.base && analysis.shifted && startMs !== null && (
                <>
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

                  <HorizonView
                    site={site}
                    horizon={horizon}
                    windowStartMs={startMs}
                    sampleCount={sampleCount}
                    cursor={cursorInWindow}
                    bands={{ sun: analysis.base.sun.nearHorizonBandDeg, earth: analysis.base.earth.nearHorizonBandDeg }}
                    onAssumptions={openAssumptions}
                  />

                  <StorySection
                    id="bodies-h"
                    title="Sun and Earth, one at a time"
                    lead="The longest gap for each body, when it starts and ends, and how it compares with your own limit."
                  >
                    <div className="cards">
                      <BodyCard result={analysis.base.sun} horizon={horizon} onAssumptions={openAssumptions} />
                      <BodyCard result={analysis.base.earth} horizon={horizon} onAssumptions={openAssumptions} />
                    </div>
                  </StorySection>

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

              <SitePicker manifest={manifest} selectedId={entry.id} onSelect={setSiteId} />

              {site && horizon && analysis?.base && startMs !== null && (
                <TerrainView
                  site={site}
                  horizon={horizon}
                  results={analysis.base}
                  demSha256={manifest.sources.find((s) => s.id === site.horizons.terrain?.dem.sourceId)?.sha256 ?? null}
                  windowStartMs={startMs}
                  sampleCount={sampleCount}
                  cursor={cursorInWindow}
                  onCursor={setCursor}
                />
              )}

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
          </main>
        </>
      )}

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
