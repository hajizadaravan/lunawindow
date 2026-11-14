import { describe, expect, it } from "vitest";
import { formatDay, formatDegAbs, formatHours, formatLatLon, formatUtc, formatUtcShort } from "../../src/landing/format";
import { FEATURES, PLANNED } from "../../src/landing/featureList";

describe("landing format helpers", () => {
  it("formats hours, dates and coordinates", () => {
    expect(formatHours(8.94)).toBe("8.9 h");
    expect(formatHours(0.01)).toBe("0 h");
    expect(formatUtc("2027-02-10T00:00:00Z", 24)).toBe("11 Feb 2027, 00:00 UTC");
    expect(formatUtcShort("2027-02-17T09:30:29Z")).toBe("17 Feb 09:30 UTC");
    expect(formatUtcShort(Date.parse("2027-02-17T09:30:31Z"))).toBe("17 Feb 09:31 UTC");
    expect(formatDay("2027-03-24T00:00:00Z")).toBe("24 Mar");
    expect(formatDegAbs(-0.0349)).toBe("0.03°");
    expect(formatLatLon(-89.45, 222.7)).toBe("89.45° S, 222.70° E");
    expect(formatLatLon(-85.9883, -2)).toBe("85.99° S, 358.00° E");
  });
});

describe("feature list", () => {
  it("keeps bodies within 25 words and every desktop row at 12 columns", () => {
    for (const f of FEATURES) expect(f.body.split(/\s+/).length).toBeLessThanOrEqual(25);
    let row = 0;
    for (const f of FEATURES) {
      row += f.span;
      expect(row).toBeLessThanOrEqual(12);
      if (row === 12) row = 0;
    }
    expect(row).toBe(0);
    expect(new Set(FEATURES.map((f) => f.id)).size).toBe(FEATURES.length);
    expect(FEATURES.filter((f) => f.visual.kind === "shot").length).toBeGreaterThanOrEqual(3);
  });

  it("lists the 3D terrain view as shipped and only its cast shadows as planned", () => {
    expect(FEATURES.map((f) => f.id)).toEqual(["calendar", "delay", "horizon", "timeline", "terrain", "modes", "limits"]);
    expect(PLANNED).toEqual([
      "A date heatmap for the whole south-pole region",
      "Cast shadows in the 3D terrain view",
      "An energy and battery model",
    ]);
    // The 3D view shows directions over a display mesh; it neither simulates shadows nor computes visibility.
    const terrain = FEATURES.find((f) => f.id === "terrain")!;
    expect(`${terrain.title} ${terrain.body}`).not.toMatch(/shadow|illuminat|power|line of sight|\bbest\b/i);
  });

  it("uses no dash characters or banned wording in landing copy", () => {
    const text = [...FEATURES.flatMap((f) => [f.title, f.body]), ...PLANNED].join(" ");
    expect(text).not.toMatch(/[–—]/);
    expect(text).not.toMatch(/best site|NASA-approved|\bsafe\b/i);
  });
});

describe("landing source copy", () => {
  it("contains no en or em dash anywhere in the landing folder", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = join(__dirname, "../../src/landing");
    const files: string[] = [];
    const walk = (d: string) =>
      readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : files.push(join(d, f))));
    walk(root);
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) expect([f, /[–—]/.test(readFileSync(f, "utf8"))]).toEqual([f, false]);
  });
});
