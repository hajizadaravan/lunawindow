// Formatting helpers for the landing. Pure functions; every number they format comes from the DemoStory props.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "0 h", "8.9 h", "12 h". Values below 0.05 h read as 0 h. */
export function formatHours(h: number): string {
  if (!Number.isFinite(h) || h < 0.05) return "0 h";
  const s = h.toFixed(1);
  return `${s.endsWith(".0") ? s.slice(0, -2) : s} h`;
}

/** "12 Jan 2027, 00:00 UTC" from an ISO string, optionally shifted by whole or fractional hours. */
export function formatUtc(iso: string, shiftHours = 0): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const d = new Date(t + shiftHours * 3_600_000);
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
