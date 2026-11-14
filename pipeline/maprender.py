"""Render the overview hillshade PNG and write data/derived/map_info.json (manifest.map).

Usage:  .venv/bin/python -m pipeline.maprender
The image is cut from the DEM on whole-pixel boundaries and block-averaged by an integer factor, so its
projected extents are exact multiples of the DEM grid (no resampling shift).
"""

from __future__ import annotations

import json

import numpy as np
from PIL import Image

from . import config, dem

MARGIN_M = 12_000.0
MAX_SIDE_PX = 1400
SUN_AZ_GRID = 315.0     # illumination from the image's upper left (map-grid azimuth, not lunar azimuth)
SUN_ALT = 35.0
IMAGE = "map/south-pole-hillshade.png"


def hillshade(h: np.ndarray, pix: float, az_deg: float, alt_deg: float) -> np.ndarray:
    gy, gx = np.gradient(h, pix)          # rows increase southward in map y -> d/dy_map = -gy
    dzdx = gx
    dzdy = -gy
    slope = np.arctan(np.hypot(dzdx, dzdy))
    aspect = np.arctan2(-dzdx, -dzdy)     # direction of steepest descent, clockwise from +y (grid north)
    az = np.radians(az_deg)
    alt = np.radians(alt_deg)
    shade = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    return np.clip(shade, 0, 1)


def render(grid: dem.Grid | None = None) -> dict:
    grid = grid or dem.load_grid()
    xs, ys = dem.latlon_to_xy([s.lat_deg for s in config.SITES], [s.lon_east_deg for s in config.SITES])
    xmin, xmax = float(np.min(xs)) - MARGIN_M, float(np.max(xs)) + MARGIN_M
    ymin, ymax = float(np.min(ys)) - MARGIN_M, float(np.max(ys)) + MARGIN_M
    span = max(xmax - xmin, ymax - ymin)
    k = int(np.ceil(span / grid.dx / MAX_SIDE_PX))
    cell = grid.dx * k
    # Snap to the DEM grid in multiples of k pixels.
    c0 = int(np.floor((xmin - grid.x0) / cell)) * k
    c1 = int(np.ceil((xmax - grid.x0) / cell)) * k
    r0 = int(np.floor((grid.y0 - ymax) / cell)) * k
    r1 = int(np.ceil((grid.y0 - ymin) / cell)) * k
    h, w = grid.shape
    if c0 < 0 or r0 < 0 or c1 > w or r1 > h:
        raise ValueError("map extent leaves the DEM")
    sub = grid.data[r0:r1, c0:c1].astype(np.float64)
    hh, ww = sub.shape[0] // k, sub.shape[1] // k
    blk = sub.reshape(hh, k, ww, k).mean(axis=(1, 3))
    valid = np.isfinite(blk)
    filled = np.where(valid, blk, np.nanmean(blk))
    shade = hillshade(filled, cell, SUN_AZ_GRID, SUN_ALT)
    img = (40 + 200 * shade).astype(np.uint8)
    img[~valid] = 0
    out = config.WEB_DATA_DIR / IMAGE
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(img, mode="L").save(out, optimize=True)
    info = {
        "image": IMAGE,
        "widthPx": int(ww),
        "heightPx": int(hh),
        "projection": "south-polar-stereographic",
        "referenceRadiusM": 1737400,
        "xMinM": grid.x0 + c0 * grid.dx,
        "xMaxM": grid.x0 + (c0 + ww * k) * grid.dx,
        "yMinM": grid.y0 - (r0 + hh * k) * grid.dy,
        "yMaxM": grid.y0 - r0 * grid.dy,
        "rendering": (f"Hillshade of {config.DEM_PRODUCT} ({k}x{k} block mean, {cell:.0f} m per image pixel), "
                      f"illuminated from map-grid azimuth {SUN_AZ_GRID:.0f} deg (image upper left) at "
                      f"{SUN_ALT:.0f} deg altitude; illustrative only, not a real illumination state."),
        "sourceId": "lola-ldem-80s-40mpp",
    }
    p = config.REPO_ROOT / "data" / "derived" / "map_info.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(info, indent=2) + "\n")
    print(json.dumps(info, indent=1), out.stat().st_size, "bytes")
    return info


def main() -> None:
    render()


if __name__ == "__main__":
    main()
