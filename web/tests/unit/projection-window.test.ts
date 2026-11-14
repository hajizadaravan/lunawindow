import { describe, expect, it } from "vitest";
import { mapPixel, projectSouthPolar, MOON_RADIUS_M } from "../../src/analysis/projection";
import { clampStart, durationOnGrid, startBounds } from "../../src/analysis/window";
import type { MapInfo, TimeGrid } from "../../src/contract/types";

describe("south polar stereographic projection", () => {
  it("puts the pole at the origin", () => {
    const p = projectSouthPolar(-90, 0);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(0, 9);
  });
  it("follows x = r sin(lon), y = r cos(lon)", () => {
    const r = 2 * MOON_RADIUS_M * Math.tan((0.5 / 2) * (Math.PI / 180)); // lat -89.5
    const p0 = projectSouthPolar(-89.5, 0);
    expect(p0.x).toBeCloseTo(0, 6);
    expect(p0.y).toBeCloseTo(r, 6);
    const p90 = projectSouthPolar(-89.5, 90);
    expect(p90.x).toBeCloseTo(r, 6);
    expect(p90.y).toBeCloseTo(0, 6);
    expect(r).toBeCloseTo(15161.3, 0);
  });
  it("maps metres to pixels with row increasing downward", () => {
    const map: MapInfo = {
      image: "map/x.png", widthPx: 1000, heightPx: 500, projection: "south-polar-stereographic",
      referenceRadiusM: 1737400, xMinM: -50000, xMaxM: 50000, yMinM: -25000, yMaxM: 25000, rendering: "", sourceId: "s",
    };
    const c = mapPixel(map, -90, 0);
    expect(c.col).toBeCloseTo(500, 6);
    expect(c.row).toBeCloseTo(250, 6);
    const n = mapPixel(map, -89.5, 0); // +y -> up (smaller row)
    expect(n.row).toBeLessThan(250);
    expect(n.row).toBeCloseTo(250 - (15161.3 / 50000) * 500, 0);
    const e = mapPixel(map, -89.5, 90); // +x -> right
    expect(e.col).toBeGreaterThan(500);
    expect(mapPixel(map, -85, 0).inside).toBe(false);
  });
});

describe("start-date clamping", () => {
  const grid: TimeGrid = { startUtc: "2027-01-01T00:00:00Z", stepSeconds: 900, count: 4 * 24 * 30 + 1, scale: "UTC" };
  const range = { startUtc: "2027-01-01T00:00:00Z", endUtc: "2027-01-31T00:00:00Z" };
  const H = 3_600_000;
  const t0 = Date.parse(range.startUtc);

  it("keeps start + duration + shift inside the range", () => {
    const b = startBounds(range, grid, 168, 24)!;
    expect(b.earliestMs).toBe(t0);
    expect(b.latestMs).toBe(Date.parse(range.endUtc) - 192 * H);
  });
  it("clamps early and late requests", () => {
    const b = startBounds(range, grid, 168, 24)!;
    expect(clampStart(t0 - 10 * H, b)).toBe(b.earliestMs);
    expect(clampStart(Date.parse("2027-03-01T00:00:00Z"), b)).toBe(b.latestMs);
    expect(clampStart(Number.NaN, b)).toBe(b.earliestMs);
  });
  it("snaps to the grid", () => {
    const b = startBounds(range, grid, 24, 24)!;
    expect(clampStart(t0 + 5 * H + 7 * 60_000, b)).toBe(t0 + 5 * H);
  });
  it("uses the intersection of supported range and site grid", () => {
    const later = { startUtc: "2027-01-02T00:07:00Z", endUtc: "2027-02-15T00:00:00Z" };
    const b = startBounds(later, grid, 24, 24)!;
    expect(b.earliestMs).toBe(Date.parse("2027-01-02T00:15:00Z"));
    expect(b.latestMs).toBe(Date.parse("2027-01-31T00:00:00Z") - 48 * H);
  });
  it("returns null when nothing fits", () => {
    expect(startBounds(range, grid, 14 * 24 * 3, 24)).toBeNull();
  });
  it("checks duration against the step", () => {
    expect(durationOnGrid(168, 900)).toBe(true);
    expect(durationOnGrid(0.1, 900)).toBe(false);
  });
});
