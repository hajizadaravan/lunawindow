// South polar stereographic projection, docs/data-contract.md MapInfo comment.
import type { MapInfo } from "../contract/types";

export const MOON_RADIUS_M = 1_737_400;
const DEG = Math.PI / 180;

export function projectSouthPolar(latDeg: number, lonEastDeg: number, radiusM = MOON_RADIUS_M) {
  const r = 2 * radiusM * Math.tan(((90 + latDeg) / 2) * DEG);
  return { x: r * Math.sin(lonEastDeg * DEG), y: r * Math.cos(lonEastDeg * DEG) };
}

/** Pixel position (col, row) in the map image; may fall outside the image. */
export function mapPixel(map: MapInfo, latDeg: number, lonEastDeg: number) {
  const { x, y } = projectSouthPolar(latDeg, lonEastDeg, map.referenceRadiusM);
  const col = ((x - map.xMinM) / (map.xMaxM - map.xMinM)) * map.widthPx;
  const row = ((map.yMaxM - y) / (map.yMaxM - map.yMinM)) * map.heightPx;
  return { col, row, inside: col >= 0 && col <= map.widthPx && row >= 0 && row <= map.heightPx };
}
