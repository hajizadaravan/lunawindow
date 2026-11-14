import { useMemo } from "react";
import type { BodyId, HorizonInput, SiteDataset, TerrainHorizon } from "../contract/types";
import { horizonElevationAt, marginAt, sampleState } from "../analysis/visibility";
import { fmtDeg, fmtSignedDeg, fmtUtc } from "../analysis/format";
import { BODY_NAME } from "../analysis/wording";
import { useWidth } from "../lib/useWidth";
import { ModeTag } from "./ModeTag";

interface Props {
  site: SiteDataset;
  horizon: HorizonInput;
  windowStartMs: number;
  sampleCount: number;
  cursor: number;
  bands: Record<BodyId, number>;
  onAssumptions: () => void;
}

const PAD_L = 46;
const PAD_R = 12;
const PAD_T = 14;
const PAD_B = 34;

export function HorizonView(p: Props) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const { site, horizon } = p;
  const height = width < 560 ? 240 : 300;
  const plotW = Math.max(100, width - PAD_L - PAD_R);
  const plotH = height - PAD_T - PAD_B;
  const i0 = Math.round((p.windowStartMs - Date.parse(site.time.startUtc)) / (site.time.stepSeconds * 1000));
  const terrain = horizon.kind === "terrain" ? (site.horizons.terrain as TerrainHorizon) : null;

  const [yMin, yMax] = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const b of ["sun", "earth"] as const) {
      const el = site.ephemeris.bodies[b].elDeg;
      for (let k = 0; k < p.sampleCount; k++) {
        const v = el[i0 + k];
        if (v === null || v === undefined) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    const prof = horizon.kind === "terrain" ? horizon.elevationDeg : [0];
    for (const v of prof) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (!Number.isFinite(lo)) (lo = -1), (hi = 1);
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
    const pad = Math.max(0.3, (hi - lo) * 0.08);
    return [Math.floor((lo - pad) * 2) / 2, Math.ceil((hi + pad) * 2) / 2];
  }, [site, horizon, i0, p.sampleCount]);

  const x = (az: number) => PAD_L + (az / 360) * plotW;
  const y = (el: number) => PAD_T + ((yMax - el) / (yMax - yMin)) * plotH;

  const profilePath = useMemo(() => {
    if (horizon.kind !== "terrain") return null;
    const n = horizon.elevationDeg.length;
    const pts: string[] = [];
    for (let k = 0; k <= n; k++) {
      const az = k * horizon.azimuthStepDeg;
      pts.push(`${x(az).toFixed(1)},${y(horizon.elevationDeg[k % n]).toFixed(1)}`);
    }
    return pts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horizon, width, yMin, yMax, height]);

  const trackPaths = useMemo(() => {
    const out: Record<BodyId, string> = { sun: "", earth: "" };
    for (const b of ["sun", "earth"] as const) {
      const { azDeg, elDeg } = site.ephemeris.bodies[b];
      let d = "";
      let prevAz: number | null = null;
      for (let k = 0; k < p.sampleCount; k++) {
        const az = azDeg[i0 + k];
        const el = elDeg[i0 + k];
        if (az === null || el === null) {
          prevAz = null;
          continue;
        }
        const cmd = prevAz === null || Math.abs(az - prevAz) > 180 ? "M" : "L";
        d += `${cmd}${x(az).toFixed(1)} ${y(el).toFixed(1)}`;
        prevAz = az;
      }
      out[b] = d;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site, i0, p.sampleCount, width, yMin, yMax, height]);

  const yTicks: number[] = [];
  const span = yMax - yMin;
  const yStep = span > 12 ? 4 : span > 6 ? 2 : span > 3 ? 1 : 0.5;
  for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax + 1e-9; v += yStep) yTicks.push(Number(v.toFixed(2)));
  const xTicks = plotW < 480 ? [0, 90, 180, 270, 360] : [0, 45, 90, 135, 180, 225, 270, 315, 360];
  const compass: Record<number, string> = { 0: "N", 90: "E", 180: "S", 270: "W", 360: "N" };

  const cursorIdx = i0 + p.cursor;
  const cursorMs = p.windowStartMs + p.cursor * site.time.stepSeconds * 1000;
  const bodyAt = (b: BodyId) => {
    const t = site.ephemeris.bodies[b];
    const az = t.azDeg[cursorIdx] ?? null;
    const el = t.elDeg[cursorIdx] ?? null;
    const h = az === null ? null : horizonElevationAt(horizon, az);
    const m = marginAt(horizon, az, el);
    return { az, el, h, m, state: sampleState(m), near: m !== null && Math.abs(m) < p.bands[b] };
  };
  const now = { sun: bodyAt("sun"), earth: bodyAt("earth") };

  const coverage = terrain
    ? terrain.coverageLimited
        .map((lim, k) => (lim ? k : -1))
        .filter((k) => k >= 0)
    : [];

  return (
    <section className="panel" aria-labelledby="hv-h" data-testid="horizon-view">
      <div className="panel-head">
        <h2 id="hv-h">Horizon view at {site.site.name}</h2>
        <ModeTag horizon={horizon} />
      </div>
      <div ref={wrapRef}>
        <svg
          className="horizon-svg"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Panorama of azimuth 0 to 360 degrees against elevation, with the ${
            horizon.kind === "terrain" ? "terrain" : "geometric"
          } horizon and the Sun and Earth tracks over the selected interval. Cursor values are listed below.`}
        >
          <defs>
            <pattern id="hv-cov" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--warn)" strokeWidth="2" />
            </pattern>
          </defs>
          {yTicks.map((v) => (
            <g key={v}>
              <line className={v === 0 ? "zero-line" : "gridline"} x1={PAD_L} x2={PAD_L + plotW} y1={y(v)} y2={y(v)} />
              <text x={PAD_L - 6} y={y(v) + 4} textAnchor="end" className="chart-label">
                {fmtDeg(v, yStep < 1 ? 1 : 0)}
              </text>
            </g>
          ))}
          {xTicks.map((az) => (
            <g key={az}>
              <line className="gridline" x1={x(az)} x2={x(az)} y1={PAD_T} y2={PAD_T + plotH} />
              <text x={x(az)} y={height - 16} textAnchor="middle" className="chart-label">
                {az}°
              </text>
              {compass[az] && (
                <text x={x(az)} y={height - 3} textAnchor="middle" className="chart-label" style={{ fontWeight: 700 }}>
                  {compass[az]}
                </text>
              )}
            </g>
          ))}
          {profilePath ? (
            <>
              <polygon
                className="horizon-fill"
                points={`${x(0)},${PAD_T + plotH} ${profilePath.join(" ")} ${x(360)},${PAD_T + plotH}`}
              />
              <polyline className="horizon-line" points={profilePath.join(" ")} />
            </>
          ) : (
            <>
              <rect className="horizon-fill" x={PAD_L} y={y(0)} width={plotW} height={PAD_T + plotH - y(0)} />
              <line className="horizon-line geometric" x1={PAD_L} x2={PAD_L + plotW} y1={y(0)} y2={y(0)} />
            </>
          )}
          {terrain &&
            coverage.map((k) => (
              <rect
                key={k}
                x={x(k * terrain.azimuthStepDeg)}
                y={PAD_T + plotH - 8}
                width={Math.max(1, (terrain.azimuthStepDeg / 360) * plotW)}
                height={8}
                fill="url(#hv-cov)"
              />
            ))}
          <path className="track sun" d={trackPaths.sun} />
          <path className="track earth" d={trackPaths.earth} strokeDasharray="5 3" />
          {now.sun.az !== null && now.sun.el !== null && (
            <g>
              <circle cx={x(now.sun.az)} cy={y(now.sun.el)} r={7} fill="var(--sun)" stroke="var(--surface)" strokeWidth={2} />
              <text x={x(now.sun.az) + 10} y={y(now.sun.el) - 8} className="row-label">
                Sun
              </text>
            </g>
          )}
          {now.earth.az !== null && now.earth.el !== null && (
            <g>
              <rect
                x={x(now.earth.az) - 6}
                y={y(now.earth.el) - 6}
                width={12}
                height={12}
                transform={`rotate(45 ${x(now.earth.az)} ${y(now.earth.el)})`}
                fill="var(--earth)"
                stroke="var(--surface)"
                strokeWidth={2}
              />
              <text x={x(now.earth.az) + 10} y={y(now.earth.el) + 16} className="row-label">
                Earth
              </text>
            </g>
          )}
          <rect x={PAD_L} y={PAD_T} width={plotW} height={plotH} fill="none" stroke="var(--line-strong)" />
        </svg>
      </div>
      <ul className="legend" aria-label="Horizon view legend">
        <li>
          <svg width="26" height="12" aria-hidden>
            <line x1="0" x2="26" y1="6" y2="6" stroke="var(--ink)" strokeWidth="1.5" strokeDasharray={horizon.kind === "geometric" ? "6 4" : undefined} />
          </svg>
          {horizon.kind === "terrain" ? "Terrain horizon (LOLA), ground shaded below" : "Geometric horizon at 0° (no terrain)"}
        </li>
        <li>
          <svg width="26" height="12" aria-hidden>
            <line x1="0" x2="26" y1="6" y2="6" stroke="var(--sun)" strokeWidth="2" />
          </svg>
          Sun track (solid), marker ●
        </li>
        <li>
          <svg width="26" height="12" aria-hidden>
            <line x1="0" x2="26" y1="6" y2="6" stroke="var(--earth)" strokeWidth="2" strokeDasharray="5 3" />
          </svg>
          Earth track (dashed), marker ◆
        </li>
        {coverage.length > 0 && (
          <li>
            <svg width="26" height="12" aria-hidden>
              <rect width="26" height="8" y="2" fill="url(#hv-cov)" />
            </svg>
            Terrain search left DEM coverage ({coverage.length} of {terrain!.coverageLimited.length} azimuth bins)
          </li>
        )}
      </ul>
      <p className="hint">
        Elevation is stretched relative to azimuth so small angles stay readable. Tracks cover{" "}
        <span className="num">{fmtUtc(p.windowStartMs)}</span> onward for the selected interval.
      </p>
      <div className="readout-grid" data-testid="horizon-readout">
        {(["sun", "earth"] as const).map((b) => {
          const v = now[b];
          return (
            <div className="readout" key={b}>
              <h3>
                <span className={`swatch ${b}`} aria-hidden />
                {BODY_NAME[b]} at <span className="num">{fmtUtc(cursorMs)}</span>
              </h3>
              <dl className="kv">
                <dt>Azimuth</dt>
                <dd className="num">{fmtDeg(v.az)}</dd>
                <dt>Elevation</dt>
                <dd className="num">{fmtDeg(v.el)}</dd>
                <dt>Horizon here</dt>
                <dd className="num">{fmtDeg(v.h)}</dd>
                <dt>Margin</dt>
                <dd>
                  <span className="num">{fmtSignedDeg(v.m)}</span>{" "}
                  {v.m === null
                    ? "(missing sample)"
                    : v.m > 0
                      ? "above the horizon: visible"
                      : v.m < 0
                        ? "below the horizon: blocked"
                        : "exactly on the modelled horizon"}
                </dd>
              </dl>
              {v.near && (
                <p className="hint" style={{ marginTop: 6 }}>
                  Within <span className="num">{p.bands[b].toFixed(2)}°</span> of the horizon, so this label is
                  uncertain.
                </p>
              )}
            </div>
          );
        })}
      </div>
      <p className="hint">
        Body centre direction only.{" "}
        <button type="button" className="btn link" onClick={p.onAssumptions}>
          Assumptions &amp; sources
        </button>
      </p>
    </section>
  );
}
