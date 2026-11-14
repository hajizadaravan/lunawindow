import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle, MinusCircle, MagnifyingGlass, Warning, XCircle } from "@phosphor-icons/react";
import type { HorizonInput, Manifest, SiteDataset } from "../contract/types";
import {
  classify,
  evaluateStarts,
  findNextFit,
  longestGapHours,
  type CalendarCell,
  type CellStatus,
  type Evaluation,
  type Exceedance,
  type Limits,
  type NextFit,
} from "../analysis/calendar";
import { fmtHours, fmtUtc } from "../analysis/format";
import { BODY_NAME } from "../analysis/wording";
import { ModeTag } from "./ModeTag";
import type { HorizonMode } from "./HorizonSwitch";

export type SiteState = { status: "loading" } | { status: "ok"; data: SiteDataset } | { status: "error"; message: string };

interface Props {
  manifest: Manifest;
  sites: Record<string, SiteState>;
  mode: HorizonMode;
  durationHours: number;
  shiftHours: number;
  checkShift: boolean;
  onCheckShift: (v: boolean) => void;
  limits: Limits;
  timeOfDayMs: number;
  selectedSiteId: string;
  selectedStartMs: number | null;
  onSelect: (siteId: string, startMs: number) => void;
  onEditLimits: () => void;
  onAssumptions: () => void;
}

type Row =
  | { id: string; name: string; letter: string; kind: "loading" }
  | { id: string; name: string; letter: string; kind: "error"; message: string }
  | { id: string; name: string; letter: string; kind: "no-terrain" }
  | { id: string; name: string; letter: string; kind: "no-fit-range" }
  | { id: string; name: string; letter: string; kind: "ok"; horizon: HorizonInput; evaluation: Evaluation };

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const CELL_LABEL: Record<CellStatus, string> = {
  meets: "Meets your limits",
  exceeds: "Exceeds a limit",
  uncertain: "Not exceeded, but a gap touches the window edge or data is missing",
  "no-limits": "No limit set",
};

function CellIcon({ status }: { status: CellStatus }) {
  const p = { size: 14, weight: "bold" as const, "aria-hidden": true };
  if (status === "meets") return <CheckCircle {...p} />;
  if (status === "exceeds") return <XCircle {...p} />;
  if (status === "uncertain") return <Warning {...p} />;
  return <MinusCircle {...p} />;
}

function scenarioText(e: Exceedance, shiftHours: number) {
  return e.scenario === "base" ? "the baseline window" : `the window starting ${shiftHours} h later`;
}

function exceedText(e: Exceedance, shiftHours: number) {
  return `${BODY_NAME[e.body]} gap of ${fmtHours(e.gapHours)} in ${scenarioText(e, shiftHours)} is ${fmtHours(
    e.overByHours,
  )} over your ${fmtHours(e.limitHours)} limit`;
}

function cellDescription(c: CalendarCell, siteName: string, shiftHours: number) {
  const head = `${siteName}, start ${fmtUtc(c.startMs)}: ${CELL_LABEL[c.status]}.`;
  if (c.status === "exceeds") return `${head} ${exceedText(c.exceedances[0], shiftHours)}.`;
  const gaps = (["sun", "earth"] as const)
    .map((b) => {
      const g = Math.max(longestGapHours(c.base[b]), c.shifted ? longestGapHours(c.shifted[b]) : 0);
      return `longest ${BODY_NAME[b]} gap ${fmtHours(g)}`;
    })
    .join(", ");
  return `${head} ${c.shifted ? `Across both windows: ${gaps}.` : `${gaps[0].toUpperCase()}${gaps.slice(1)}.`}`;
}

export function StartCalendar(p: Props) {
  // Deferred so the calendar never delays the first paint of the main result.
  // Memoised so the deferred value (and the analyses below) only change when one of these inputs does.
  const live = useMemo(
    () => ({ sites: p.sites, mode: p.mode, durationHours: p.durationHours, shiftHours: p.shiftHours, checkShift: p.checkShift, tod: p.timeOfDayMs }),
    [p.sites, p.mode, p.durationHours, p.shiftHours, p.checkShift, p.timeOfDayMs],
  );
  const inputs = useDeferredValue(live, null);

  const rows: Row[] | null = useMemo(() => {
    if (!inputs) return null;
    return p.manifest.sites.map((entry, i): Row => {
      const base = { id: entry.id, name: entry.name, letter: String.fromCharCode(65 + i) };
      const st = inputs.sites[entry.id];
      if (!st || st.status === "loading") return { ...base, kind: "loading" };
      if (st.status === "error") return { ...base, kind: "error", message: st.message };
      const site = st.data;
      if (inputs.mode === "terrain" && !site.horizons.terrain) return { ...base, kind: "no-terrain" };
      const horizon = (inputs.mode === "terrain" ? site.horizons.terrain! : site.horizons.geometric) as HorizonInput;
      const evaluation = evaluateStarts({
        time: site.time,
        tracks: site.ephemeris.bodies,
        horizon,
        range: p.manifest.supportedRange,
        durationHours: inputs.durationHours,
        shiftHours: inputs.shiftHours,
        checkShift: inputs.checkShift,
        timeOfDayMs: inputs.tod,
      });
      if (!evaluation) return { ...base, kind: "no-fit-range" };
      return { ...base, kind: "ok", horizon, evaluation };
    });
  }, [inputs, p.manifest]);

  const cells = useMemo(() => {
    const out: Record<string, Map<number, CalendarCell>> = {};
    for (const r of rows ?? []) {
      if (r.kind !== "ok") continue;
      out[r.id] = new Map(classify(r.evaluation, p.limits).map((c) => [c.startMs, c]));
    }
    return out;
  }, [rows, p.limits]);

  const columns = useMemo(() => {
    const set = new Set<number>();
    for (const m of Object.values(cells)) for (const k of m.keys()) set.add(k);
    return [...set].sort((a, b) => a - b);
  }, [cells]);

  const okRow = rows?.find((r): r is Extract<Row, { kind: "ok" }> => r.kind === "ok");
  const horizonForTag = okRow?.horizon ?? null;
  const stale = inputs !== null && (inputs.checkShift !== p.checkShift || inputs.mode !== p.mode || inputs.durationHours !== p.durationHours || inputs.tod !== p.timeOfDayMs);

  // Roving tab stop over the grid.
  const [focus, setFocus] = useState<{ r: number; c: number } | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const selRow = p.manifest.sites.findIndex((s) => s.id === p.selectedSiteId);
  const selCol = p.selectedStartMs !== null ? columns.indexOf(p.selectedStartMs) : -1;
  const active = focus ?? { r: Math.max(0, selRow), c: Math.max(0, selCol) };
  // Keep the selected start in view inside the horizontal scroller (never scrolls the page).
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const box = scrollRef.current;
    const btn = box?.querySelector<HTMLElement>(".cal-cell.selected");
    if (!box || !btn) return;
    const headW = box.querySelector<HTMLElement>("th.cal-rowhead")?.offsetWidth ?? 0;
    const b = btn.getBoundingClientRect();
    const c = box.getBoundingClientRect();
    const visibleLeft = c.left + headW;
    if (b.left >= visibleLeft && b.right <= c.right) return;
    box.scrollLeft += b.left - visibleLeft - (c.width - headW - b.width) / 2;
  }, [selRow, selCol, rows]);
  const moveFocus = (r: number, c: number) => {
    const nr = Math.max(0, Math.min(p.manifest.sites.length - 1, r));
    const nc = Math.max(0, Math.min(columns.length - 1, c));
    setFocus({ r: nr, c: nc });
    const btn = tableRef.current?.querySelector<HTMLButtonElement>(`button[data-r="${nr}"][data-c="${nc}"]`);
    btn?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.dataset.r === undefined) return;
    const r = Number(t.dataset.r);
    const c = Number(t.dataset.c);
    const moves: Record<string, [number, number]> = {
      ArrowRight: [r, c + 1],
      ArrowLeft: [r, c - 1],
      ArrowDown: [r + 1, c],
      ArrowUp: [r - 1, c],
      Home: [r, 0],
      End: [r, columns.length - 1],
    };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    moveFocus(m[0], m[1]);
  };

  // Find nearest start for the selected point.
  const [found, setFound] = useState<{ key: string; result: NextFit; siteName: string; fromMs: number } | null>(null);
  const findKey = `${p.selectedSiteId}|${p.selectedStartMs}|${p.limits.sun}|${p.limits.earth}|${p.mode}|${p.durationHours}|${p.checkShift}`;
  const selectedCells = cells[p.selectedSiteId];
  const selectedEntry = p.manifest.sites[selRow];
  const canFind = Boolean(selectedCells) && p.selectedStartMs !== null && !stale;
  const runFind = () => {
    if (!selectedCells || p.selectedStartMs === null) return;
    const result = findNextFit([...selectedCells.values()], p.selectedStartMs, p.limits);
    setFound({ key: findKey, result, siteName: selectedEntry.name, fromMs: p.selectedStartMs });
  };
  const shownFind = found && found.key === findKey ? found : null;

  const limitText = (["sun", "earth"] as const)
    .map((b) => (p.limits[b] === null ? `${BODY_NAME[b]}: no limit` : `${BODY_NAME[b]} ≤ ${fmtHours(p.limits[b]!)}`))
    .join(" · ");
  const windowsText = p.checkShift ? `the ${p.durationHours / 24}-day window and the same window starting ${p.shiftHours} h later` : `the ${p.durationHours / 24}-day window`;

  return (
    <section className="panel calendar" id="calendar" aria-labelledby="cal-h" data-testid="calendar">
      <div className="panel-head">
        <h2 id="cal-h" tabIndex={-1}>
          Which start dates fit your limits?
        </h2>
        {horizonForTag && <ModeTag horizon={horizonForTag} />}
      </div>
      <p className="cal-intro">
        Each cell is a {p.durationHours / 24}-day mission starting that day at{" "}
        <span className="num">{fmtUtc(p.timeOfDayMs).slice(11)}</span>, checked against your limits in {windowsText}.
      </p>
      <div className="cal-controls">
        <span className="cal-limits">
          Limits: <span className="num">{limitText}</span>{" "}
          <button type="button" className="btn link" onClick={p.onEditLimits}>
            Edit limits
          </button>
        </span>
        <label className="toggle">
          <input type="checkbox" checked={p.checkShift} onChange={(e) => p.onCheckShift(e.target.checked)} />+{p.shiftHours} h
          also checked
        </label>
      </div>
      {p.limits.sun === null && p.limits.earth === null && (
        <p className="notice info" role="note">
          <MinusCircle size={16} weight="bold" aria-hidden />
          <span>No limit is set, so no start can be checked. Enter a Max Sun loss or Max Earth loss above.</span>
        </p>
      )}

      {rows === null ? (
        <div className="skeleton" style={{ height: 150 }} aria-busy="true">
          <span className="sr-only">Computing start dates</span>
        </div>
      ) : (
        <div className="cal-scroll" aria-busy={stale} ref={scrollRef}>
          <table className="cal-table" ref={tableRef} onKeyDown={onKeyDown}>
            <caption className="sr-only">
              Demonstration points by start date. Use the arrow keys to move between cells and Enter to open one.
            </caption>
            <thead>
              <tr>
                <th scope="col" className="cal-rowhead">
                  Point
                </th>
                {columns.map((ms, k) => {
                  const d = new Date(ms);
                  const showMonth = k === 0 || d.getUTCDate() === 1;
                  return (
                    <th scope="col" key={ms} className={showMonth ? "month-start" : undefined}>
                      <span className="cal-mon">{showMonth ? MON[d.getUTCMonth()] : ""}</span>
                      <span className="num">{d.getUTCDate()}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((r, ri) => (
                <tr key={r.id}>
                  <th scope="row" className="cal-rowhead">
                    <span className="cal-letter">{r.letter}</span>
                    <span className="cal-name">{r.name}</span>
                  </th>
                  {r.kind === "ok" ? (
                    columns.map((ms, ci) => {
                      const c = cells[r.id]?.get(ms);
                      if (!c) return <td key={ms} className="cal-empty" />;
                      const selected = r.id === p.selectedSiteId && ms === p.selectedStartMs;
                      const desc = cellDescription(c, r.name, p.shiftHours);
                      return (
                        <td key={ms}>
                          <button
                            type="button"
                            className={`cal-cell ${c.status}${selected ? " selected" : ""}`}
                            data-r={ri}
                            data-c={ci}
                            data-testid={`cal-${r.id}-${new Date(ms).toISOString().slice(0, 10)}`}
                            tabIndex={active.r === ri && active.c === ci ? 0 : -1}
                            aria-label={desc}
                            aria-pressed={selected}
                            title={desc}
                            onFocus={() => setFocus({ r: ri, c: ci })}
                            onClick={() => p.onSelect(r.id, ms)}
                          >
                            <CellIcon status={c.status} />
                          </button>
                        </td>
                      );
                    })
                  ) : (
                    <td colSpan={Math.max(1, columns.length)} className="cal-rowmsg">
                      {r.kind === "loading" && <span className="skeleton cal-skel">Loading {r.name}…</span>}
                      {r.kind === "error" && <span>Could not load {r.name}: {r.message}</span>}
                      {r.kind === "no-terrain" && (
                        <span className="cal-noterrain">
                          No terrain horizon exists for {r.name}; not shown in terrain mode (switch to the geometric
                          reference horizon to see it).
                        </span>
                      )}
                      {r.kind === "no-fit-range" && <span>The data range is too short for this duration.</span>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ul className="legend cal-legend" aria-label="Calendar legend">
        {(["meets", "exceeds", "uncertain", "no-limits"] as const).map((s) => (
          <li key={s}>
            <span className={`cal-cell legend-cell ${s}`} aria-hidden>
              <CellIcon status={s} />
            </span>
            {CELL_LABEL[s]}
          </li>
        ))}
      </ul>
      <p className="hint">
        "Meets your limits" means only that every set limit is within the longest continuous gap in the evaluated
        window{p.checkShift ? "s" : ""} in the current model (body-centre visibility,{" "}
        {horizonForTag ? (horizonForTag.kind === "terrain" ? "terrain horizon" : "geometric reference horizon") : "selected horizon"}
        ). It is not a power, communication or landing-safety assessment, and other delays are not checked.{" "}
        <button type="button" className="btn link" onClick={p.onAssumptions}>
          Assumptions &amp; sources
        </button>
      </p>

      <div className="cal-find">
        <button type="button" className="btn primary" onClick={runFind} disabled={!canFind} data-testid="find-next">
          <MagnifyingGlass size={16} weight="bold" aria-hidden />
          Find the nearest start that meets my limits from this date
        </button>
        <div aria-live="polite" data-testid="find-result">
          {shownFind && (
            <FindResult
              f={shownFind}
              shiftHours={p.shiftHours}
              checkShift={p.checkShift}
              durationHours={p.durationHours}
              limits={p.limits}
              onSelect={(ms) => p.onSelect(p.selectedSiteId, ms)}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function FindResult(props: {
  f: { result: NextFit; siteName: string; fromMs: number };
  shiftHours: number;
  checkShift: boolean;
  durationHours: number;
  limits: Limits;
  onSelect: (ms: number) => void;
}) {
  const { f, shiftHours, checkShift } = props;
  const r = f.result;
  const from = fmtUtc(f.fromMs);
  if (r.kind === "no-limits") return <p className="find-text">Set a Max Sun loss or Max Earth loss first; with no limit there is nothing to check.</p>;
  if (r.kind === "no-starts") return <p className="find-text">There is no daily start on or after {from} inside the allowed range.</p>;
  if (r.kind === "fit") {
    const c = r.cell;
    const parts = (["sun", "earth"] as const)
      .filter((b) => props.limits[b] !== null)
      .map((b) => {
        const baseG = fmtHours(longestGapHours(c.base[b]));
        const shG = c.shifted ? fmtHours(longestGapHours(c.shifted[b])) : null;
        return `the longest ${BODY_NAME[b]} gap is ${baseG}${shG !== null ? ` (${shG} if it starts ${shiftHours} h later)` : ""}, not longer than your ${fmtHours(props.limits[b]!)} limit`;
      });
    const skipped = r.skipped.exceeds + r.skipped.uncertain;
    return (
      <div className="find-text">
        <p>
          <strong>
            {f.siteName}, start {fmtUtc(c.startMs)}
          </strong>{" "}
          is the first daily start from {from} that meets your limits: {parts.join("; ")}.
          {skipped > 0 &&
            ` ${skipped} earlier start${skipped === 1 ? "" : "s"} did not (${r.skipped.exceeds} exceed a limit${
              r.skipped.uncertain ? `, ${r.skipped.uncertain} have a gap at the window edge or missing data` : ""
            }).`}{" "}
          This holds for {checkShift ? `this start and a ${shiftHours} h later start` : "this start only"} in the current
          model; other delays are not checked.
        </p>
        <button type="button" className="btn" onClick={() => props.onSelect(c.startMs)} data-testid="apply-found">
          Show this start
        </button>
      </div>
    );
  }
  return (
    <div className="find-text">
      <p>
        No daily start from {from} to the end of the allowed range meets your limits ({r.considered} checked).
        {r.closest && r.worst ? (
          <>
            {" "}
            Closest miss: <strong>start {fmtUtc(r.closest.startMs)}</strong>, where the {exceedText(r.worst, shiftHours)}.
          </>
        ) : (
          ` None exceeds a limit, but ${r.uncertain} have a gap at the window edge or missing data, so they cannot be confirmed.`
        )}
      </p>
      {r.closest && (
        <button type="button" className="btn" onClick={() => props.onSelect(r.closest!.startMs)} data-testid="apply-found">
          Show the closest miss
        </button>
      )}
    </div>
  );
}

