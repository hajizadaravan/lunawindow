import type { Manifest } from "../contract/types";
import type { StartBounds } from "../analysis/window";
import { durationOnGrid } from "../analysis/window";
import { isoDate } from "../analysis/format";

export interface LimitsInput {
  sun: string;
  earth: string;
}

interface Props {
  manifest: Manifest;
  bounds: StartBounds | null;
  startMs: number | null;
  durationHours: number;
  shiftHours: number;
  stepSeconds: number;
  onStart: (ms: number) => void;
  onDuration: (h: number) => void;
  limits: LimitsInput;
  limitErrors: { sun: string | null; earth: string | null };
  onLimits: (l: LimitsInput) => void;
  /** Which group of fields to render: the start and duration, or the user's own limits. */
  part: "when" | "limits";
}

const DURATION_DAYS = [1, 2, 3, 5, 7, 10, 14];
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * Start and duration fields (part "when") or limit fields (part "limits"). Rendered as bare `.field` elements so the
 * caller places them in its own groups.
 */
export function MissionForm(p: Props) {
  const { manifest, bounds, startMs } = p;
  const rangeStart = Date.parse(manifest.supportedRange.startUtc);
  const rangeEnd = Date.parse(manifest.supportedRange.endUtc);
  const dayStart = startMs !== null ? Math.floor(startMs / DAY_MS) * DAY_MS : null;
  const hour = startMs !== null ? new Date(startMs).getUTCHours() : 0;

  const setDate = (value: string) => {
    if (!value || dayStart === null || startMs === null) return;
    const d = Date.parse(`${value}T00:00:00Z`);
    if (Number.isNaN(d)) return;
    p.onStart(d + (startMs - dayStart));
  };
  const setHour = (h: number) => {
    if (dayStart === null) return;
    p.onStart(dayStart + h * HOUR_MS);
  };
  const hourDisabled = (h: number) =>
    !bounds || dayStart === null || dayStart + (h + 1) * HOUR_MS <= bounds.earliestMs || dayStart + h * HOUR_MS > bounds.latestMs;
  const durationFits = (days: number) =>
    durationOnGrid(days * 24, p.stepSeconds) && rangeEnd - rangeStart >= (days * 24 + p.shiftHours) * HOUR_MS;

  const limitField = (key: "sun" | "earth", label: string) => {
    const id = `limit-${key}`;
    const err = p.limitErrors[key];
    return (
      <div className={`field f-${key}`}>
        <label htmlFor={id}>{label} (h)</label>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={0.1}
          step={0.1}
          placeholder="no limit"
          value={p.limits[key]}
          aria-describedby={`limits-help${err ? ` ${id}-err` : ""}`}
          aria-invalid={Boolean(err)}
          onChange={(e) => p.onLimits({ ...p.limits, [key]: e.target.value })}
        />
        {err && (
          <span id={`${id}-err`} role="alert" className="field-error">
            {err}
          </span>
        )}
      </div>
    );
  };

  if (p.part === "limits") {
    return (
      <>
        {limitField("sun", "Max Sun loss")}
        {limitField("earth", "Max Earth loss")}
      </>
    );
  }

  return (
    <>
      <div className="field f-date">
        <label htmlFor="start-date">Start date (UTC)</label>
        <input
          id="start-date"
          type="date"
          value={startMs !== null ? isoDate(startMs) : ""}
          min={bounds ? isoDate(bounds.earliestMs) : undefined}
          max={bounds ? isoDate(bounds.latestMs) : undefined}
          disabled={!bounds}
          onChange={(e) => setDate(e.target.value)}
          aria-describedby="start-help"
        />
      </div>
      <div className="field f-hour">
        <label htmlFor="start-hour">Start hour (UTC)</label>
        <select id="start-hour" value={hour} disabled={!bounds} onChange={(e) => setHour(Number(e.target.value))}>
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h} disabled={hourDisabled(h)}>
              {String(h).padStart(2, "0")}:00
            </option>
          ))}
        </select>
      </div>
      <div className="field f-duration">
        <label htmlFor="duration">Duration</label>
        <select id="duration" value={p.durationHours} onChange={(e) => p.onDuration(Number(e.target.value))}>
          {DURATION_DAYS.map((d) => (
            <option key={d} value={d * 24} disabled={!durationFits(d)}>
              {d} {d === 1 ? "day" : "days"} ({d * 24} h)
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
