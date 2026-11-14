import { Pause, Play, SunHorizon, Sun as SunIcon, Question, WarningOctagon } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatDegAbs, formatHours, formatUtc, formatUtcShort } from "./format";
import { useIntersection, useMediaQuery, useReducedMotion, useWidth } from "./hooks";
import { buildReplayGeometry, fractionAt, pointAt, tickLabel, type ReplayBox } from "./replayGeometry";
import { STORY_FAILED_TEXT } from "./HeroPanel";
import type { DemoStory, SunReplay } from "./types";

const PLAY_MS = 9000; // one pass over the whole sample span
const STEPS = 1000; // scrubber resolution
const PROBE_BOX: ReplayBox = { width: 800, height: 400, pad: { top: 0, right: 0, bottom: 0, left: 0 } };


export function Replay({
  replay,
  story,
  storyFailed = false,
}: {
  replay: SunReplay | null;
  story: DemoStory | null;
  storyFailed?: boolean;
}) {
  // Decided here, not inside the figure: the figure's observers attach to elements that exist from its first render.
  // Whether a replay can be drawn does not depend on the box size.
  const drawable = useMemo(() => replay !== null && buildReplayGeometry(replay, PROBE_BOX) !== null, [replay]);
  return (
    <section id="why" className="lw-section lw-why" aria-labelledby="lw-why-title">
      <div className="lw-wrap">
        <h2 id="lw-why-title" className="lw-h2">
          One ridge can hide the Sun for hours
        </h2>
        <p className="lw-body lw-why-body">
          Near the pole the Sun circles low along the horizon instead of rising high. Terrain a few tenths of a
          degree tall then decides whether it is in view, and a small change in timing can move a long gap.
        </p>
        {replay && drawable ? (
          <ReplayFigure replay={replay} shiftHours={story?.shiftHours ?? null} />
        ) : story === null && storyFailed ? (
          // Same footprint as the skeleton; the data will not arrive.
          <div className="lw-replay lw-replay-skeleton" data-failed="true">
            <p className="lw-replay-failed" role="status">
              <WarningOctagon size={18} weight="bold" aria-hidden="true" />
              {STORY_FAILED_TEXT}
            </p>
          </div>
        ) : story === null ? (
          <div className="lw-replay lw-replay-skeleton" aria-busy="true">
            <p className="sr-only" role="status">
              Loading the Sun replay from the cached dataset.
            </p>
            <div className="lw-skel lw-skel-block" />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ReplayFigure({ replay, shiftHours }: { replay: SunReplay; shiftHours: number | null }) {
  const reduce = useReducedMotion();
  const [plotRef, width] = useWidth<HTMLDivElement>(1100);
  // Same breakpoint as the CSS, so the figure and its loading skeleton share one fixed footprint per layout.
  const narrow = useMediaQuery("(max-width: 767px)");
  const box: ReplayBox = useMemo(
    () => ({
      width,
      height: narrow ? 300 : 420,
      pad: { top: 24, right: narrow ? 8 : 16, bottom: 34, left: narrow ? 44 : 52 },
    }),
    [width, narrow],
  );
  const g = useMemo(() => buildReplayGeometry(replay, box), [replay, box]);
  const gapFrac = g ? fractionAt(g, Date.parse(replay.gapStartUtc)) : 0;

  const [frac, setFrac] = useState(() => (reduce ? gapFrac : 0));
  const [playing, setPlaying] = useState(false);
  const autoplayed = useRef(false);
  const userTouched = useRef(false);
  const fracRef = useRef(frac);
  fracRef.current = frac;

  // Reduced motion: stop any autoplay, and unless the user has moved it, rest on the moment the Sun goes behind
  // the terrain (static end state). Manual play stays available.
  useEffect(() => {
    if (!reduce) return;
    autoplayed.current = true;
    if (!userTouched.current) {
      setPlaying(false);
      setFrac(gapFrac);
    }
  }, [reduce, gapFrac]);

  const viewRef = useIntersection<HTMLDivElement>(
    (inView) => {
      if (inView && !reduce && !autoplayed.current) {
        autoplayed.current = true;
        setFrac(0);
        setPlaying(true);
      }
    },
    { threshold: 0.55 },
  );

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const next = Math.min(1, fracRef.current + (now - last) / PLAY_MS);
      last = now;
      setFrac(next);
      if (next >= 1) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  if (!g) return null;
  const p = pointAt(g, frac);
  const toggle = () => {
    autoplayed.current = true;
    userTouched.current = true;
    if (playing) setPlaying(false);
    else {
      if (frac >= 1) setFrac(0);
      setPlaying(true);
    }
  };

  const touchesEdge =
    Date.parse(replay.gapStartUtc) <= Date.parse(replay.windowStartUtc) ||
    Date.parse(replay.gapEndUtc) >= Date.parse(replay.windowEndUtc);
  const above = p.marginDeg !== null && p.marginDeg > 0;
  const onEdge = p.marginDeg !== null && Math.abs(p.marginDeg) < 0.005;
  const stateText =
    p.state === "unknown" || p.marginDeg === null
      ? "No data at this moment"
      : onEdge
        ? "Sun centre on the horizon"
        : above
          ? `Sun centre ${formatDegAbs(p.marginDeg)} above the horizon`
          : `Sun centre ${formatDegAbs(p.marginDeg)} below the horizon, out of view`;
  const blocked = g.runs.find((r) => r.state === "blocked" && g.gapStart && r.mid.x >= g.gapStart.x - 1);
  const bottom = box.height - box.pad.bottom;
  const exag = Math.max(1, Math.round(g.exaggeration));

  return (
    <figure className="lw-replay" data-testid="replay">
      <div className="lw-replay-meta">
        <span>{replay.siteName}</span>
        <span>{replay.horizonLabel}</span>
        <span>Body-centre direction only</span>
      </div>
      <div ref={viewRef}>
        <div ref={plotRef} className="lw-replay-plot">
          <svg
            width={box.width}
            height={box.height}
            viewBox={`0 0 ${box.width} ${box.height}`}
            role="img"
            aria-label={`Sun track against the terrain horizon at ${replay.siteName}. The dashed part is where the Sun centre is behind the terrain, for ${formatHours(replay.gapHours)}.`}
          >
            <defs>
              <linearGradient id="lw-sky" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#f08a5f" stopOpacity="0" />
                <stop offset="1" stopColor="#f08a5f" stopOpacity="0.09" />
              </linearGradient>
              <linearGradient id="lw-ground" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#2a2c31" />
                <stop offset="1" stopColor="#141518" />
              </linearGradient>
            </defs>
            <rect x={box.pad.left} y={box.pad.top} width={box.width - box.pad.left - box.pad.right} height={bottom - box.pad.top} fill="url(#lw-sky)" />
            {g.elTicks.map((t) => (
              <g key={`el${t}`} className="lw-replay-grid">
                <line x1={box.pad.left} x2={box.width - box.pad.right} y1={g.y(t)} y2={g.y(t)} />
                <text x={box.pad.left - 8} y={g.y(t)} dy="0.32em" textAnchor="end">
                  {tickLabel(t, g.elTicks)}
                </text>
              </g>
            ))}
            <path d={g.groundPath} fill="url(#lw-ground)" />
            <path d={g.ridgePath} className="lw-replay-ridge" />
            {g.azTicks.map((t) => (
              <text key={`az${t}`} className="lw-replay-axis" x={g.x(t)} y={bottom + 22} textAnchor="middle">
                {tickLabel(((t % 360) + 360) % 360, g.azTicks)}
              </text>
            ))}
            {g.runs.map((r, i) => (
              <path key={i} d={r.d} className={`lw-replay-track lw-replay-track-${r.state}`} />
            ))}
            {[g.gapStart, g.gapEnd].map((q, i) =>
              q ? (
                <g key={i} className="lw-replay-cross">
                  <line x1={q.x} x2={q.x} y1={q.y - 14} y2={q.y + 14} />
                  <circle cx={q.x} cy={q.y} r={3.5} />
                </g>
              ) : null,
            )}
            {blocked && g.gapStart && g.gapEnd && (
              <text
                className="lw-replay-label"
                x={(g.gapStart.x + g.gapEnd.x) / 2}
                y={Math.min(bottom - 10, Math.max(g.gapStart.y, g.gapEnd.y, blocked.mid.y) + 30)}
                textAnchor="middle"
              >
                Behind terrain, {formatHours(replay.gapHours)}
              </text>
            )}
            <g className="lw-replay-sun" data-state={p.state} transform={`translate(${p.pos.x.toFixed(2)} ${p.pos.y.toFixed(2)})`}>
              <circle className="lw-replay-halo" r={18} />
              <circle className="lw-replay-disc" r={7} />
            </g>
          </svg>
        </div>
      </div>

      <div className="lw-replay-controls">
        <button type="button" className="lw-btn lw-btn-ghost lw-btn-sm lw-replay-play" onClick={toggle}>
          {playing ? <Pause size={16} weight="fill" aria-hidden="true" /> : <Play size={16} weight="fill" aria-hidden="true" />}
          {playing ? "Pause replay" : "Play replay"}
        </button>
        <input
          type="range"
          className="lw-range"
          min={0}
          max={STEPS}
          step={1}
          value={Math.round(frac * STEPS)}
          aria-label="Replay time"
          aria-valuetext={`${formatUtc(new Date(p.ms).toISOString())}. ${stateText}.`}
          onChange={(e) => {
            autoplayed.current = true;
            userTouched.current = true;
            setPlaying(false);
            setFrac(Number(e.target.value) / STEPS);
          }}
        />
        <span className="lw-replay-time" data-testid="replay-time">
          {formatUtcShort(p.ms)}
        </span>
      </div>
      <p className="lw-replay-state" data-state={p.state} data-testid="replay-state">
        {p.state === "unknown" ? (
          <Question size={18} weight="regular" aria-hidden="true" />
        ) : above ? (
          <SunIcon size={18} weight="fill" aria-hidden="true" />
        ) : (
          <SunHorizon size={18} weight="regular" aria-hidden="true" />
        )}
        {stateText}
      </p>

      <p className="lw-replay-sentence" data-testid="replay-sentence">
        {shiftHours !== null ? `In the window delayed by ${formatHours(shiftHours)}, the` : "In the delayed window, the"} Sun centre goes behind the terrain at {formatUtc(replay.gapStartUtc)} and
        comes back at {formatUtc(replay.gapEndUtc)}: {formatHours(replay.gapHours)} out of view, inside the delayed
        window.{touchesEdge ? " This gap touches the window edge and may continue outside it." : ""}
      </p>
      <figcaption className="lw-caption">
        Computed from the cached JPL Horizons Sun directions. Horizon: {replay.horizonLabel}. Azimuth runs
        along the bottom, drawn so time moves left to right. Elevation is stretched about {exag} times relative to
        azimuth so tenths of a degree are visible.
      </figcaption>
    </figure>
  );
}
