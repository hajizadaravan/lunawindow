import { Warning } from "@phosphor-icons/react";
import type { Manifest } from "../contract/types";
import { mapPixel, projectSouthPolar } from "../analysis/projection";
import { dataUrl } from "../lib/data";
import { useState } from "react";

interface Props {
  manifest: Manifest;
  selectedId: string;
  onSelect: (id: string) => void;
}

function letter(i: number) {
  return String.fromCharCode(65 + i);
}

/** Keep in step with the max-height of `.map-frame svg` in styles.css. */
const MAP_MAX_HEIGHT_PX = 280;

function ImageMap({ manifest, selectedId, onSelect }: Props) {
  const map = manifest.map!;
  const [failed, setFailed] = useState(false);
  // The map is drawn at most MAP_MAX_HEIGHT_PX tall (see .map-frame svg), so size markers for that display width.
  const displayWidthPx = Math.min(340, (MAP_MAX_HEIGHT_PX * map.widthPx) / map.heightPx);
  const scale = map.widthPx / displayWidthPx;
  let href: string | null = null;
  try {
    href = dataUrl(map.image);
  } catch {
    href = null;
  }
  if (failed || href === null) return <SchematicMap manifest={manifest} selectedId={selectedId} onSelect={onSelect} imageFailed />;
  const outside = manifest.sites.filter((s) => !mapPixel(map, s.latDeg, s.lonEastDeg).inside);
  return (
    <>
      <div className="map-frame">
        <svg viewBox={`0 0 ${map.widthPx} ${map.heightPx}`} role="img" aria-label="South-pole overview map with demonstration points">
          <image href={href} width={map.widthPx} height={map.heightPx} onError={() => setFailed(true)} />
          {manifest.sites.map((s, i) => {
            const p = mapPixel(map, s.latDeg, s.lonEastDeg);
            if (!p.inside) return null;
            const others = manifest.sites
              .filter((o) => o.id !== s.id)
              .map((o) => mapPixel(map, o.latDeg, o.lonEastDeg))
              .map((o) => ({ x: o.col, y: o.row }));
            return (
              <Marker key={s.id} x={p.col} y={p.row} r={9 * scale} label={letter(i)} selected={s.id === selectedId}
                onClick={() => onSelect(s.id)} name={s.name} others={others} />
            );
          })}
        </svg>
      </div>
      <p className="hint">
        {map.rendering.replace(/\.\s*$/, "")}. Longitude 0° (the Earth-facing side) is toward the top; 90°E is to the right.
      </p>
      {outside.length > 0 && (
        <p className="hint">Outside the map extent: {outside.map((s) => s.name).join(", ")}.</p>
      )}
    </>
  );
}

/** Picks the diagonal label offset farthest from the other markers so letters never sit next to a neighbour. */
function labelOffset(x: number, y: number, r: number, others: { x: number; y: number }[]) {
  const dirs = [[1, -1], [-1, -1], [1, 1], [-1, 1]] as const;
  let best: readonly [number, number] = dirs[0];
  let bestD = -1;
  for (const d of dirs) {
    const lx = x + d[0] * 1.8 * r;
    const ly = y + d[1] * 1.6 * r;
    const dist = Math.min(Infinity, ...others.map((o) => Math.hypot(o.x - lx, o.y - ly)));
    if (dist > bestD + 1e-6) (bestD = dist), (best = d);
  }
  return best;
}

function Marker(props: { x: number; y: number; r: number; label: string; selected: boolean; onClick: () => void; name: string; others: { x: number; y: number }[] }) {
  const { x, y, r, label, selected, onClick, name, others } = props;
  const [dx, dy] = labelOffset(x, y, r, others);
  return (
    <g className={`marker${selected ? " selected" : ""}`} onClick={onClick} aria-hidden>
      <title>{name}</title>
      <circle cx={x} cy={y} r={r * 2.2} fill="transparent" />
      <circle className="ring" cx={x} cy={y} r={r * 0.55} strokeWidth={r * 0.3} />
      {selected && <circle cx={x} cy={y} r={r * 1.25} fill="none" stroke="var(--ink)" strokeWidth={r * 0.22} />}
      <text x={x + dx * r * 1.3} y={y + (dy < 0 ? -r * 0.9 : r * 2.1)} textAnchor={dx > 0 ? "start" : "end"} fontSize={r * 1.7} strokeWidth={r * 0.45}>
        {label}
      </text>
    </g>
  );
}

/** Schematic polar-stereographic grid: same projection, latitude rings and longitude spokes, no imagery. */
function SchematicMap({ manifest, selectedId, onSelect, imageFailed }: Props & { imageFailed?: boolean }) {
  const pts = manifest.sites.map((s) => projectSouthPolar(s.latDeg, s.lonEastDeg));
  // Rings every 0.5 deg (1 deg when the spread is wide) out to the first ring beyond the outermost site.
  const outerLat = Math.max(...manifest.sites.map((s) => s.latDeg));
  const ringStep = outerLat > -87 ? 1 : 0.5;
  const edgeLat = Math.max(-90 + ringStep, Math.ceil(outerLat / ringStep) * ringStep);
  const ringLats: number[] = [];
  for (let lat = -90 + ringStep; lat <= edgeLat + 1e-9; lat += ringStep) ringLats.push(Number(lat.toFixed(1)));
  const maxR = Math.max(...pts.map((p) => Math.hypot(p.x, p.y)), 1);
  const extent = Math.max(maxR * 1.08, projectSouthPolar(ringLats[ringLats.length - 1], 0).y);
  const size = 340;
  const half = size / 2;
  const k = (half - 42) / extent;
  const px = (p: { x: number; y: number }) => ({ cx: half + p.x * k, cy: half - p.y * k });
  return (
    <>
      <div className="map-frame">
        <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Schematic south-pole grid with demonstration points">
          {ringLats.map((lat) => {
            const r = projectSouthPolar(lat, 0).y * k;
            return (
              <g key={lat}>
                <circle cx={half} cy={half} r={r} fill="none" stroke="var(--line-strong)" strokeWidth={1} strokeDasharray={lat % 1 === 0 ? undefined : "3 3"} />
                <text x={half + r * 0.7071 + 3} y={half - r * 0.7071 - 3} className="chart-label">{lat}°</text>
              </g>
            );
          })}
          {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((lon) => {
            const p = px(projectSouthPolar(ringLats[ringLats.length - 1] ?? -89, lon));
            return (
              <g key={lon}>
                <line x1={half} y1={half} x2={p.cx} y2={p.cy} stroke="var(--line)" strokeWidth={1} />
                {lon % 90 === 0 && (
                  // 0 at top, 90 right, 180 bottom, 270 left (x = r sin lon, y = r cos lon)
                  <text
                    x={lon === 90 ? p.cx + 4 : lon === 270 ? p.cx - 4 : p.cx}
                    y={lon === 0 ? p.cy - 6 : lon === 180 ? p.cy + 14 : p.cy + 4}
                    textAnchor={lon === 90 ? "start" : lon === 270 ? "end" : "middle"}
                    className="chart-label"
                  >
                    {lon}°E
                  </text>
                )}
              </g>
            );
          })}
          <circle cx={half} cy={half} r={2.5} fill="var(--ink-3)" />
          {manifest.sites.map((s, i) => {
            const p = px(pts[i]);
            return (
              <Marker key={s.id} x={p.cx} y={p.cy} r={8} label={letter(i)} selected={s.id === selectedId} onClick={() => onSelect(s.id)} name={s.name}
                others={pts.filter((_, j) => j !== i).map((q) => { const c = px(q); return { x: c.cx, y: c.cy }; })} />
            );
          })}
        </svg>
      </div>
      <p className="hint" role="note">
        <Warning size={13} weight="bold" aria-hidden style={{ verticalAlign: "-2px", marginRight: 4 }} />
        {imageFailed ? "The map image could not be loaded." : "This dataset has no map image."} Schematic grid only:
        positions use the same south polar stereographic projection; no terrain is drawn.
      </p>
    </>
  );
}

export function SitePicker(props: Props) {
  const { manifest, selectedId, onSelect } = props;
  return (
    <section className="panel site-picker" aria-labelledby="site-h">
      <div className="panel-head">
        <h2 id="site-h">Demonstration points</h2>
      </div>
      <p className="panel-lead">
        Where the demonstration points sit near the south pole. Pick one here or in the scenario controls; everything above
        follows it.
      </p>
      <div className="site-body">
        <div className="site-map">{manifest.map ? <ImageMap {...props} /> : <SchematicMap {...props} />}</div>
        <ul className="site-list" role="radiogroup" aria-labelledby="site-h">
          {manifest.sites.map((s, i) => (
            <li key={s.id}>
              <label className="site-option">
                <input type="radio" name="site-map" value={s.id} checked={s.id === selectedId} onChange={() => onSelect(s.id)} />
                <span className="name">
                  {letter(i)}. {s.name}
                </span>
                <span className="meta">
                  <span className="num">
                    {s.latDeg.toFixed(3)}°, {s.lonEastDeg.toFixed(3)}°E
                  </span>{" "}
                  near {s.locationHint}. {s.hasTerrainHorizon ? "Terrain horizon available." : "No terrain horizon."}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
