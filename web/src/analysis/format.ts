// Display formatting: durations to 0.1 h, timestamps to the minute (UTC).

export function fmtHours(h: number): string {
  const r = Math.round(h * 10) / 10;
  return `${(Object.is(r, -0) ? 0 : r).toFixed(1)} h`;
}

export function fmtSignedHours(h: number): string {
  const r = Math.round(h * 10) / 10;
  if (r === 0) return "0.0 h";
  return `${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(1)} h`;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** "2027-01-03 14:05 UTC", rounded to the nearest minute. */
export function fmtUtc(isoOrMs: string | number): string {
  const ms = typeof isoOrMs === "number" ? isoOrMs : Date.parse(isoOrMs);
  const d = new Date(Math.round(ms / 60_000) * 60_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(
    d.getUTCMinutes(),
  )} UTC`;
}

export function fmtDeg(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined) return "no data";
  const r = v.toFixed(digits);
  return `${r.startsWith("-") ? "−" + r.slice(1) : r}°`;
}

export function fmtSignedDeg(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined) return "no data";
  const r = Math.abs(v).toFixed(digits);
  if (Number(r) === 0) return `${r}°`;
  return `${v > 0 ? "+" : "−"}${r}°`;
}

/** Date part for <input type="date"> (UTC). */
export function isoDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
