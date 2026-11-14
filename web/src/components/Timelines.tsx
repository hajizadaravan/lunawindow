import { useMemo, useRef } from "react";
import type { AnalysisResult, BodyId, HorizonInput, SiteDataset, VisState } from "../contract/types";
import { fmtHours, fmtUtc } from "../analysis/format";
import { BODY_NAME } from "../analysis/wording";
import { useWidth } from "../lib/useWidth";
import { ModeTag } from "./ModeTag";

interface Props {
  sun: AnalysisResult;
  earth: AnalysisResult;
  site: SiteDataset;
  horizon: HorizonInput;
  cursor: number;
  onCursor: (i: number) => void;
  sampleCount: number;
  onAssumptions: () => void;
}

const LABEL_W = 62;
const PAD_R = 22;
const ROW_H = 26;
const BRACKET_H = 26;
const NEAR_H = 6;
const ROW_BLOCK = BRACKET_H + ROW_H + NEAR_H + 12;
const AXIS_H = 30;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const STATE_TEXT: Record<VisState, string> = { visible: "visible", blocked: "blocked", unknown: "no data" };

export function stateAt(r: AnalysisResult, tMs: number): { state: VisState; near: boolean } {
  let state: VisState = "unknown";
  for (let k = 0; k < r.intervals.length; k++) {
    const iv = r.intervals[k];
    const s = Date.parse(iv.startUtc);
    const e = Date.parse(iv.endUtc);
    if ((tMs >= s && tMs < e) || (k === r.intervals.length - 1 && tMs === e)) {
      state = iv.state;
      break;
    }
  }
  const near = r.nearHorizonSpans.some((sp) => tMs >= Date.parse(sp.startUtc) && tMs <= Date.parse(sp.endUtc));
  return { state, near };
}

/** Pattern definitions shared by the chart and its legend, so states differ by texture as well as tone. */
export function StatePatterns({ prefix }: { prefix: string }) {
  return (
    <defs>
      <pattern id={`${prefix}-blocked`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" fill="var(--blocked-fill)" />
        <line x1="0" y1="0" x2="0" y2="6" stroke="var(--surface)" strokeWidth="1.4" opacity="0.45" />
      </pattern>
      <pattern id={`${prefix}-unknown`} width="7" height="7" patternUnits="userSpaceOnUse">
        <rect width="7" height="7" fill="var(--surface)" />
        <path d="M0 0 L7 7 M7 0 L0 7" stroke="var(--unknown-fill)" strokeWidth="1.3" />
      </pattern>
      <pattern id={`${prefix}-near`} width="4" height="6" patternUnits="userSpaceOnUse">
        <rect x="0" y="0" width="2" height="6" fill="var(--ink-2)" />
      </pattern>
    </defs>
  );
}

function fill(prefix: string, body: BodyId, s: VisState) {
  if (s === "visible") return `var(--${body})`;
  return `url(#${prefix}-${s})`;
}

export function Timelines(p: Props) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragging = useRef(false);
  const { sun, earth, cursor, sampleCount } = p;
  const stepMs = sun.stepSeconds * 1000;
  const t0 = Date.parse(sun.windowStartUtc);
  const t1 = Date.parse(sun.windowEndUtc);
  const plotW = Math.max(120, width - LABEL_W - PAD_R);
  const x = (t: number) => LABEL_W + ((t - t0) / (t1 - t0)) * plotW;
  const height = ROW_BLOCK * 2 + AXIS_H;
  const cursorMs = t0 + cursor * stepMs;
  const prefix = "tl";

  const ticks = useMemo(() => {
    const days = (t1 - t0) / 86_400_000;
    const every = plotW / days < 46 ? (plotW / days < 24 ? 4 : 2) : 1;
    const out: { t: number; label: string }[] = [];
    const first = Math.ceil(t0 / 86_400_000) * 86_400_000;
    for (let t = first, k = 0; t <= t1; t += 86_400_000, k++) {
      if (k % every !== 0) continue;
      const d = new Date(t);
      out.push({ t, label: `${MON[d.getUTCMonth()]} ${d.getUTCDate()}` });
    }
    return out;
  }, [t0, t1, plotW]);

  const indexFromClientX = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return cursor;
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * width;
    const frac = (px - LABEL_W) / plotW;
    return Math.min(sampleCount - 1, Math.max(0, Math.round(frac * (sampleCount - 1))));
  };

  const stepsPerHour = 3_600_000 / stepMs;
  const jump = Math.max(1, Math.round(6 * stepsPerHour));
  const page = Math.max(1, Math.round(24 * stepsPerHour));
  const onKeyDown = (e: React.KeyboardEvent) => {
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = cursor + (e.shiftKey ? jump : 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = cursor - (e.shiftKey ? jump : 1);
    else if (e.key === "PageUp") next = cursor + page;
    else if (e.key === "PageDown") next = cursor - page;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = sampleCount - 1;
    if (next === null) return;
    e.preventDefault();
    p.onCursor(Math.min(sampleCount - 1, Math.max(0, next)));
  };

  const sunAt = stateAt(sun, cursorMs);
  const earthAt = stateAt(earth, cursorMs);
  const describe = (b: BodyId, s: { state: VisState; near: boolean }) =>
    `${BODY_NAME[b]} ${STATE_TEXT[s.state]}${s.near ? ", near the horizon (uncertain)" : ""}`;
  const valueText = `${fmtUtc(cursorMs)}. ${describe("sun", sunAt)}. ${describe("earth", earthAt)}.`;

  const row = (r: AnalysisResult, top: number) => {
    const yRow = top + BRACKET_H;
    const lg = r.longestInterruption;
    return (
      <g key={r.body}>
        <text x={0} y={yRow + ROW_H / 2 + 4} className="row-label">
          {BODY_NAME[r.body]}
        </text>
        <rect x={LABEL_W} y={yRow} width={plotW} height={ROW_H} fill="var(--surface-2)" />
        {r.intervals.map((iv, k) => {
          const a = x(Date.parse(iv.startUtc));
          const b = x(Date.parse(iv.endUtc));
          return (
            <rect
              key={k}
              x={a}
              y={yRow}
              width={Math.max(0.75, b - a)}
              height={ROW_H}
              fill={fill(prefix, r.body, iv.state)}
              stroke={iv.state === "unknown" ? "var(--unknown-fill)" : "none"}
            />
          );
        })}
        {r.nearHorizonSpans.map((sp, k) => {
          const a = x(Date.parse(sp.startUtc));
          const b = x(Date.parse(sp.endUtc));
          return <rect key={k} x={a - 1} y={yRow + ROW_H + 3} width={Math.max(2, b - a + 2)} height={NEAR_H} fill={`url(#${prefix}-near)`} />;
        })}
        {lg && (() => {
          const a = x(Date.parse(lg.startUtc));
          const b = x(Date.parse(lg.endUtc));
          const mid = (a + b) / 2;
          const label = `Longest ${fmtHours(lg.durationHours)}${lg.boundaryTruncated ? ", may continue" : ""}`;
          const estW = label.length * 6.2;
          const lx = Math.min(LABEL_W + plotW - estW / 2, Math.max(LABEL_W + estW / 2, mid));
          return (
            <g>
              <rect x={a} y={yRow - 1.5} width={Math.max(2, b - a)} height={ROW_H + 3} fill="none" stroke="var(--ink)" strokeWidth={2} />
              <path
                d={`M${a} ${yRow - 3} V${yRow - 7} H${b} V${yRow - 3}`}
                fill="none"
                stroke="var(--ink)"
                strokeWidth={1.5}
                strokeDasharray={lg.boundaryTruncated ? "4 3" : undefined}
              />
              <text x={lx} y={yRow - 11} textAnchor="middle" className="longest-label">
                {label}
              </text>
            </g>
          );
        })()}
      </g>
    );
  };

  const cx = x(cursorMs);
  return (
    <section className="panel" aria-labelledby="tl-h" data-testid="timelines">
      <div className="panel-head">
        <h2 id="tl-h">Visibility over the selected analysis interval</h2>
        <ModeTag horizon={p.horizon} />
      </div>
      <p className="panel-lead">
        When the Sun and Earth centres are above or below the modelled horizon, across the whole window. Move the cursor
        to read any moment; the horizon view below follows it.
      </p>
      <div ref={wrapRef} className="chart-wrap">
        <svg
          ref={svgRef}
          className="timeline-svg"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="slider"
          tabIndex={0}
          aria-label="Time cursor for both timelines and the horizon view"
          aria-valuemin={0}
          aria-valuemax={sampleCount - 1}
          aria-valuenow={cursor}
          aria-valuetext={valueText}
          aria-describedby="tl-keys"
          data-testid="time-cursor"
          onKeyDown={onKeyDown}
          onPointerDown={(e) => {
            dragging.current = true;
            (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
            (e.currentTarget as SVGSVGElement).focus({ preventScroll: true });
            p.onCursor(indexFromClientX(e.clientX));
          }}
          onPointerMove={(e) => {
            if (dragging.current) p.onCursor(indexFromClientX(e.clientX));
          }}
          onPointerUp={() => (dragging.current = false)}
          onPointerCancel={() => (dragging.current = false)}
        >
          <StatePatterns prefix={prefix} />
          <rect className="focus-frame" x={1} y={1} width={width - 2} height={height - 2} rx={6} fill="none" stroke="transparent" />
          {row(sun, 0)}
          {row(earth, ROW_BLOCK)}
          <g className="axis">
            <line x1={LABEL_W} x2={LABEL_W + plotW} y1={ROW_BLOCK * 2} y2={ROW_BLOCK * 2} stroke="var(--line-strong)" />
            {ticks.map((tk) => (
              <g key={tk.t}>
                <line x1={x(tk.t)} x2={x(tk.t)} y1={ROW_BLOCK * 2} y2={ROW_BLOCK * 2 + 5} stroke="var(--line-strong)" />
                <text x={x(tk.t)} y={ROW_BLOCK * 2 + 18} textAnchor="middle">
                  {tk.label}
                </text>
              </g>
            ))}
          </g>
          <line className="cursor-line" x1={cx} x2={cx} y1={6} y2={ROW_BLOCK * 2} />
          <path className="cursor-head" d={`M${cx - 6} 0 H${cx + 6} L${cx} 8 Z`} />
        </svg>
      </div>
      <div className="cursor-readout" aria-live="polite" data-testid="cursor-readout">
        <span>
          Cursor <strong>{fmtUtc(cursorMs)}</strong>
        </span>
        <span>{describe("sun", sunAt)}</span>
        <span>{describe("earth", earthAt)}</span>
      </div>
      <Legend />
      <details className="more">
        <summary>Keyboard and pointer controls</summary>
        <p id="tl-keys" className="hint">
          Drag across the timelines, or focus them and use <span className="kbd">←</span> <span className="kbd">→</span> to
          step {p.site.time.stepSeconds / 60} min, <span className="kbd">Shift</span>+arrows for 6 h,{" "}
          <span className="kbd">Page Up</span>/<span className="kbd">Page Down</span> for 24 h,{" "}
          <span className="kbd">Home</span>/<span className="kbd">End</span> for the interval edges.
        </p>
      </details>
      <details className="table-view more">
        <summary>Show intervals as a table</summary>
        {[sun, earth].map((r) => (
          <IntervalTable key={r.body} r={r} />
        ))}
      </details>
      <p className="hint">
        Near-horizon marks: the body centre is within{" "}
        <span className="num">{sun.nearHorizonBandDeg.toFixed(2)}°</span> (Sun) or{" "}
        <span className="num">{earth.nearHorizonBandDeg.toFixed(2)}°</span> (Earth) of the modelled horizon, so the
        visible/blocked label is not reliable there.{" "}
        <button type="button" className="btn link" onClick={p.onAssumptions}>
          Assumptions &amp; sources
        </button>
      </p>
    </section>
  );
}

function Legend() {
  const sw = (content: React.ReactNode) => (
    <svg width="26" height="14" aria-hidden>
      {content}
    </svg>
  );
  return (
    <>
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
      <StatePatterns prefix="lg" />
    </svg>
    <ul className="legend" aria-label="Legend">
      <li>
        {sw(<><rect width="13" height="14" fill="var(--sun)" /><rect x="13" width="13" height="14" fill="var(--earth)" /></>)}
        Visible (solid, Sun orange / Earth blue)
      </li>
      <li>{sw(<rect width="26" height="14" fill="url(#lg-blocked)" />)}Blocked (striped)</li>
      <li>{sw(<rect width="26" height="14" fill="url(#lg-unknown)" stroke="var(--unknown-fill)" />)}No data (cross-hatched)</li>
      <li>{sw(<rect y="4" width="26" height="6" fill="url(#lg-near)" />)}Near horizon, uncertain (tick strip below row)</li>
      <li>{sw(<rect x="1" y="1" width="24" height="12" fill="none" stroke="var(--ink)" strokeWidth="2" />)}Longest interruption (outlined; dashed bracket if it may continue)</li>
    </ul>
    </>
  );
}

function IntervalTable({ r }: { r: AnalysisResult }) {
  return (
    <div className="table-scroll">
      <table className="data">
        <caption style={{ textAlign: "left", fontWeight: 650, paddingTop: 8 }}>{BODY_NAME[r.body]}</caption>
        <thead>
          <tr>
            <th scope="col">State</th>
            <th scope="col">Start</th>
            <th scope="col">End</th>
            <th scope="col">Duration</th>
            <th scope="col">Note</th>
          </tr>
        </thead>
        <tbody>
          {r.intervals.map((iv, k) => (
            <tr key={k}>
              <td>{STATE_TEXT[iv.state]}</td>
              <td className="num">{fmtUtc(iv.startUtc)}</td>
              <td className="num">{fmtUtc(iv.endUtc)}</td>
              <td className="num">{fmtHours(iv.durationHours)}</td>
              <td>
                {[
                  iv.touchesWindowStart && "touches window start",
                  iv.touchesWindowEnd && "touches window end",
                  iv.adjacentToUnknown && "borders missing data",
                ]
                  .filter(Boolean)
                  .join(", ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
