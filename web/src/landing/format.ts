// Formatting helpers for the landing. Pure functions; every number they format comes from the DemoStory props.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "0 h", "8.9 h", "12 h". Values below 0.05 h read as 0 h. */
export function formatHours(h: number): string {
  if (!Number.isFinite(h) || h < 0.05) return "0 h";
  const s = h.toFixed(1);
  return `${s.endsWith(".0") ? s.slice(0, -2) : s} h`;
}

/** "12 Jan 2027, 00:00 UTC" from an ISO string (rounded to the minute), optionally shifted by hours. */
export function formatUtc(iso: string, shiftHours = 0): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const d = new Date(Math.round((t + shiftHours * 3_600_000) / 60_000) * 60_000); // nearest minute
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

/** Axis maximum and tick step for the comparison scale: room for the limit and both values. */
export function scaleFor(values: number[], limit: number): { max: number; step: number } {
  const peak = Math.max(limit * 1.5, ...values.filter(Number.isFinite), 1) * 1.12;
  const step = peak <= 15 ? 3 : peak <= 30 ? 6 : peak <= 72 ? 12 : 24;
  return { max: Math.ceil(peak / step) * step, step };
}

/** "11 Feb 06:40 UTC" (no year), for compact readouts. */
export function formatUtcShort(iso: string | number): string {
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  if (Number.isNaN(t)) return String(iso);
  const d = new Date(Math.round(t / 60_000) * 60_000);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${hh}:${mm} UTC`;
}

/** "10 Feb" from an ISO string. */
export function formatDay(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Absolute degrees with a fixed number of decimals and the degree sign: "0.42°". */
export function formatDegAbs(v: number, digits = 2): string {
  return `${Math.abs(v).toFixed(digits)}°`;
}

/** "89.45° S, 222.70° E" from signed latitude and east longitude. */
export function formatLatLon(latDeg: number, lonEastDeg: number): string {
  const lat = `${Math.abs(latDeg).toFixed(2)}° ${latDeg < 0 ? "S" : "N"}`;
  const lon = `${(((lonEastDeg % 360) + 360) % 360).toFixed(2)}° E`;
  return `${lat}, ${lon}`;
}
