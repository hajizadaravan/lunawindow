"""Export browser GLBs from the pinned LOLA raster; no network or changes to visibility data.

Run: .venv/bin/python -m pipeline.export_terrain3d
All positions are metres in local east/up/south coordinates, with the surface at the
site as origin. Four nested grids retain lunar curvature. Edge vertices of a finer
grid are interpolated onto the coarser edge to close cracks, for display only.
"""
from __future__ import annotations

import hashlib
import json
import struct
from pathlib import Path

import numpy as np

from . import config, dem
from .terrain import local_frame

STEPS = (40, 160, 640, 2560)
SIDE = 193


def local_positions(grid, lat, lon, surface, x, y):
    """Map true spherical DEM positions to a right-handed, Y-up local frame."""
    lats, lons = dem.xy_to_latlon(x, y)
    heights = grid.bilinear(x, y)
    up, north, east = local_frame(lat, lon)
    world = dem.unit_from_latlon(lats, lons) * (config.REFERENCE_RADIUS_M + heights)[..., None]
    delta = world - up * (config.REFERENCE_RADIUS_M + surface)
    return np.stack((delta @ east, delta @ up, -(delta @ north)), axis=-1)


def make_patch(grid, lat, lon, surface, step, *, side=SIDE, stitch=True):
    x0, y0 = dem.latlon_to_xy(lat, lon)
    offsets = (np.arange(side) - (side - 1) / 2) * step
    xx, yy = np.meshgrid(x0 + offsets, y0 - offsets)
    pos = local_positions(grid, lat, lon, surface, xx, yy)
    before = pos.copy()
    if stitch:
        # The next ring has four times the spacing and shared boundary knots.
        for row, col in ((0, slice(None)), (-1, slice(None)), (slice(None), 0), (slice(None), -1)):
            edge = pos[row, col].copy()
            for k in range(side):
                a = (k // 4) * 4
                b = min(a + 4, side - 1)
                if np.isfinite(edge[[a, b]]).all():
                    edge[k] = edge[a] if a == b else edge[a] * (1 - (k - a) / 4) + edge[b] * ((k - a) / 4)
            pos[row, col] = edge
    stitch_error = np.linalg.norm(pos - before, axis=-1)
    valid = np.isfinite(pos).all(axis=-1)
    rr, cc = np.meshgrid(np.arange(side - 1), np.arange(side - 1), indexing="ij")
    keep = valid[:-1, :-1] & valid[1:, :-1] & valid[:-1, 1:] & valid[1:, 1:]
    if step != STEPS[0]:
        lo = (side - 1) * 3 // 8
        hi = (side - 1) * 5 // 8
        keep &= ~((rr >= lo) & (rr < hi) & (cc >= lo) & (cc < hi))
    a = (rr[keep] * side + cc[keep]).astype(np.uint32)
    # North-up raster rows increase southward: these triangles face outward.
    indices = np.stack((a, a + side, a + 1, a + 1, a + side, a + side + 1), axis=1).reshape(-1, 3)
    flat = np.nan_to_num(pos).reshape(-1, 3)
    used, inv = np.unique(indices.reshape(-1), return_inverse=True)
    vertices = flat[used].astype("<f4")
    faces = inv.reshape(-1, 3).astype("<u4")
    normals = np.zeros_like(vertices, dtype=np.float64)
    v = vertices[faces].astype(np.float64)
    face_normals = np.cross(v[:, 1] - v[:, 0], v[:, 2] - v[:, 0])
    for k in range(3):
        np.add.at(normals, faces[:, k], face_normals)
    length = np.linalg.norm(normals, axis=1)
    normals /= np.maximum(length[:, None], 1e-15)
    return vertices, normals.astype("<f4"), faces, float(np.nanmax(stitch_error))


def glb_bytes(patches, extras):
    binary = bytearray()
    views, accessors, meshes = [], [], []

    def add(arr, kind, component, target):
        start = len(binary)
        binary.extend(arr.tobytes())
        views.append({"buffer": 0, "byteOffset": start, "byteLength": arr.nbytes, "target": target})
        accessor = {"bufferView": len(views) - 1, "componentType": component, "count": len(arr), "type": kind}
        if kind == "VEC3":
            accessor.update(min=arr.min(axis=0).tolist(), max=arr.max(axis=0).tolist())
        accessors.append(accessor)
        return len(accessors) - 1

    for step, (vertices, normals, faces, _) in zip(STEPS, patches):
        p = add(vertices, "VEC3", 5126, 34962)
        n = add(normals, "VEC3", 5126, 34962)
        i = add(faces.reshape(-1), "SCALAR", 5125, 34963)
        meshes.append({"name": f"LOLA-display-{step}m", "primitives": [{"attributes": {"POSITION": p, "NORMAL": n}, "indices": i, "material": 0}]})
    doc = {
        "asset": {"version": "2.0", "generator": "LunaWindow pinned-LOLA terrain exporter", "copyright": "NASA/GSFC/LOLA; Barker et al. 2023"},
        "scene": 0, "scenes": [{"nodes": list(range(len(meshes)))}],
        "nodes": [{"mesh": i} for i in range(len(meshes))], "meshes": meshes,
        "materials": [{"name": "Neutral lunar relief", "pbrMetallicRoughness": {"baseColorFactor": [0.48, 0.49, 0.51, 1], "metallicFactor": 0, "roughnessFactor": 1}}],
        "buffers": [{"byteLength": len(binary)}], "bufferViews": views, "accessors": accessors, "extras": extras,
    }
    js = json.dumps(doc, separators=(",", ":"), allow_nan=False).encode()
    js += b" " * ((-len(js)) % 4)
    binary.extend(b"\0" * ((-len(binary)) % 4))
    size = 12 + 8 + len(js) + 8 + len(binary)
    return struct.pack("<4sII", b"glTF", 2, size) + struct.pack("<I4s", len(js), b"JSON") + js + struct.pack("<I4s", len(binary), b"BIN\0") + binary


def main():
    grid = dem.load_grid()  # verifies SHA-256 and georeferencing before reading heights
    out = config.WEB_DATA_DIR / "terrain3d"
    out.mkdir(parents=True, exist_ok=True)
    reports = []
    for site in config.SITES:
        x, y = dem.latlon_to_xy(site.lat_deg, site.lon_east_deg)
        surface = float(grid.bilinear(x, y))
        existing = json.loads((config.WEB_DATA_DIR / "sites" / f"{site.id}.json").read_text())
        delta = abs(surface - existing["site"]["surfaceElevationM"])
        if delta > 0.01:
            raise ValueError(f"{site.id}: surface mismatch with visibility dataset: {delta} m")
        patches = [make_patch(grid, site.lat_deg, site.lon_east_deg, surface, step, stitch=i < len(STEPS) - 1) for i, step in enumerate(STEPS)]
        meta = {
            "schemaVersion": 1, "siteId": site.id, "sourceUrl": config.DEM_URL,
            "sourceProduct": config.DEM_PRODUCT, "sourceSha256": config.RASTER_SHA256[config.DEM_PRODUCT],
            "frame": "MOON_ME / DE421", "localAxes": "east,up,south", "units": "metres",
            "referenceRadiusM": config.REFERENCE_RADIUS_M, "verticalExaggeration": 1,
            "origin": {"latDeg": site.lat_deg, "lonEastDeg": site.lon_east_deg, "surfaceElevationM": surface},
            "sourceResolutionM": 40, "displayStepsM": list(STEPS), "displayWidthM": (SIDE - 1) * STEPS[-1],
            "surfaceAgreementM": delta, "maxEdgeAdjustmentM": [p[3] for p in patches],
            "vertexCount": sum(len(p[0]) for p in patches), "triangleCount": sum(len(p[2]) for p in patches),
            "limitations": ["Coarser distant terrain and stitched edges are for display only.", "No cast-shadow simulation; shading follows the Sun direction or an explicitly labelled relief light.", "Visibility comes from the original full-resolution horizon, not the display mesh.", "Invalid raster cells are omitted; this is a finite patch, not a complete lunar surface."],
        }
        data = glb_bytes(patches, meta)
        file = out / f"{site.id}.glb"
        file.write_bytes(data)
        meta.update(file=file.name, bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
        (out / f"{site.id}.json").write_text(json.dumps(meta, indent=2) + "\n")
        reports.append(meta)
        print(f"{site.id}: {len(data)/1e6:.2f} MB, {meta['triangleCount']} triangles, site match {delta:.6f} m", flush=True)
    (config.REPO_ROOT / "data" / "derived" / "terrain3d-verification.json").write_text(json.dumps(reports, indent=2) + "\n")


if __name__ == "__main__":
    main()
