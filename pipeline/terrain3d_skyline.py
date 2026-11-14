"""Compare the shipped 3D display mesh's skyline with the analysis terrain horizon.

Run: .venv/bin/python -m pipeline.terrain3d_skyline  (writes data/derived/terrain3d-skyline.json)

The visibility analysis uses the terrain horizon stored in web/public/data/sites/<id>.json. The 3D view
draws a different surface: the GLB display mesh, with coarser rings and stitched seams. This module
measures how far the two disagree, seen from the observer (mast top) at local (0, observerHeightM, 0),
at the analysis azimuths (bin i is sampled at i * azimuthStepDeg, as in pipeline.terrain.compute_horizon).

Method, exact for the shipped triangles (no distance sampling): for each azimuth, the vertical half-plane
through the observer cuts every triangle it touches in a straight segment. Within that plane the elevation
angle along a straight segment is monotonic, so the highest point of the mesh along the ray is at a
segment end, which lies on a triangle edge. The skyline is therefore the maximum elevation over all
edge/half-plane crossings. `sampled_skyline` is an independent check that samples points along the ray
and interpolates heights inside triangles; it converges to the exact value from below as spacing shrinks.

Only the committed GLB and site JSON are read: no DEM and no network, so the check always runs.
Local axes are x = east, y = up, z = south (pipeline.export_terrain3d); azimuth is clockwise from north.
"""
from __future__ import annotations

import hashlib
import json
import struct
from pathlib import Path

import numpy as np

from . import config

OUTPUT = config.REPO_ROOT / "data" / "derived" / "terrain3d-skyline.json"
DECIMALS = 3                       # degrees; 0.001 deg is far below every stated uncertainty
CHECK_SPACINGS_M = (20.0, 10.0, 5.0, 2.5)
CHECK_EVERY_NTH_BIN = 8

_FLOAT32, _UINT32, _TRIANGLES = 5126, 5125, 4


def read_glb_mesh(path: Path) -> tuple[np.ndarray, np.ndarray, str]:
    """All triangles of a GLB as (vertices float64 (n,3), faces int64 (m,3), sha256 of the file)."""
    data = Path(path).read_bytes()
    magic, version, size = struct.unpack("<4sII", data[:12])
    if (magic, version, size) != (b"glTF", 2, len(data)):
        raise ValueError(f"{path}: not a self-consistent glTF 2.0 binary")
    json_len, kind = struct.unpack("<I4s", data[12:20])
    if kind != b"JSON":
        raise ValueError(f"{path}: first chunk is not JSON")
    doc = json.loads(data[20:20 + json_len])
    bin_len, kind = struct.unpack("<I4s", data[20 + json_len:28 + json_len])
    if kind != b"BIN\0":
        raise ValueError(f"{path}: second chunk is not BIN")
    binary = data[28 + json_len:28 + json_len + bin_len]

    def array(accessor_id: int, component: int, dtype: str, dim: int) -> np.ndarray:
        acc = doc["accessors"][accessor_id]
        if acc["componentType"] != component:
            raise ValueError(f"{path}: accessor {accessor_id} has an unexpected component type")
        view = doc["bufferViews"][acc["bufferView"]]
        if view.get("byteStride", 0) not in (0, np.dtype(dtype).itemsize * dim):
            raise ValueError(f"{path}: interleaved buffer views are not supported")
        offset = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
        return np.frombuffer(binary, dtype=dtype, count=acc["count"] * dim, offset=offset).reshape(-1, dim)

    vertices, faces, base = [], [], 0
    for mesh in doc["meshes"]:
        for prim in mesh["primitives"]:
            if prim.get("mode", _TRIANGLES) != _TRIANGLES:
                raise ValueError(f"{path}: only triangle primitives are supported")
            v = array(prim["attributes"]["POSITION"], _FLOAT32, "<f4", 3).astype(np.float64)
            f = array(prim["indices"], _UINT32, "<u4", 1).reshape(-1, 3).astype(np.int64)
            vertices.append(v)
            faces.append(f + base)
            base += len(v)
    return np.vstack(vertices), np.vstack(faces), hashlib.sha256(data).hexdigest()


def unique_edges(faces: np.ndarray) -> np.ndarray:
    edges = np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
    return np.unique(np.sort(edges, axis=1), axis=0)


def _ray_axes(az_deg: float) -> tuple[np.ndarray, np.ndarray]:
    """Horizontal (x, z) unit vectors: along the ray, and perpendicular to its vertical plane."""
    a = np.radians(az_deg)
    return np.array([np.sin(a), -np.cos(a)]), np.array([np.cos(a), np.sin(a)])


def height_on_ray(vertices: np.ndarray, faces: np.ndarray, az_deg: float, r_m: np.ndarray) -> np.ndarray:
    """Mesh height y at horizontal distances `r_m` along an azimuth (barycentric in x/z); NaN off-mesh."""
    along, _ = _ray_axes(az_deg)
    tri = vertices[faces]                                      # (m, 3, 3)
    out = np.full(len(r_m), np.nan)
    for k, r in enumerate(r_m):
        q = r * along
        p0, e1, e2 = tri[:, 0, [0, 2]], tri[:, 1, [0, 2]] - tri[:, 0, [0, 2]], tri[:, 2, [0, 2]] - tri[:, 0, [0, 2]]
        w = q - p0
        det = e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0]
        u = (w[:, 0] * e2[:, 1] - w[:, 1] * e2[:, 0]) / det
        v = (e1[:, 0] * w[:, 1] - e1[:, 1] * w[:, 0]) / det
        inside = np.flatnonzero((u >= -1e-9) & (v >= -1e-9) & (u + v <= 1 + 1e-9))
        if inside.size:
            j = inside[0]                                      # shared edges/vertices give the same height
            out[k] = tri[j, 0, 1] * (1 - u[j] - v[j]) + tri[j, 1, 1] * u[j] + tri[j, 2, 1] * v[j]
    return out


def exact_skyline(vertices: np.ndarray, faces: np.ndarray, observer_height_m: float, az_deg: np.ndarray,
                  split_m: float, extent_m: float) -> tuple[np.ndarray, np.ndarray]:
    """Highest mesh elevation (deg) per azimuth, (near: 0 < r <= split, far: split <= r <= extent).

    Candidates are every edge crossing in the range plus the surface at the range limits, because a
    triangle's segment clipped at split_m or extent_m gains an end point that is not an edge crossing.
    NaN where the ray meets no mesh in that range."""
    edges = unique_edges(faces)
    xz = vertices[:, [0, 2]]
    a, b = edges[:, 0], edges[:, 1]
    near = np.full(len(az_deg), np.nan)
    far = np.full(len(az_deg), np.nan)
    limits = np.array([split_m, extent_m])
    for i, az in enumerate(az_deg):
        along, across = _ray_axes(az)
        side = xz @ across
        fa, fb = side[a], side[b]
        crossing = (fa * fb <= 0) & (fa != fb)
        t = fa[crossing] / (fa[crossing] - fb[crossing])
        va, vb = vertices[a[crossing]], vertices[b[crossing]]
        point = va + t[:, None] * (vb - va)
        r = np.concatenate([point[:, [0, 2]] @ along, limits])
        straddles = (side[faces].min(axis=1) <= 0) & (side[faces].max(axis=1) >= 0)
        y = np.concatenate([point[:, 1], height_on_ray(vertices, faces[straddles], az, limits)])
        elev = np.degrees(np.arctan2(y - observer_height_m, r))
        in_near = (r > 0) & (r <= split_m) & np.isfinite(elev)
        in_far = (r >= split_m) & (r <= extent_m) & np.isfinite(elev)
        if in_near.any():
            near[i] = elev[in_near].max()
        if in_far.any():
            far[i] = elev[in_far].max()
    return near, far


def sampled_skyline(vertices: np.ndarray, faces: np.ndarray, observer_height_m: float, az_deg: float,
                    start_m: float, extent_m: float, spacing_m: float) -> float:
    """Independent estimate: sample the ray every `spacing_m`, interpolate height inside the triangle
    containing each sample (barycentric in x/z), return the highest elevation (deg). Always <= exact."""
    along, across = _ray_axes(az_deg)
    xz = vertices[:, [0, 2]]
    tri = xz[faces]                                            # (m, 3, 2)
    side = tri @ across
    reach = tri @ along
    hit = (side.min(axis=1) <= 0) & (side.max(axis=1) >= 0) & (reach.max(axis=1) >= start_m) \
        & (reach.min(axis=1) <= extent_m)
    tri, ids, reach = tri[hit], faces[hit], reach[hit]
    r = np.arange(start_m, extent_m + 0.5 * spacing_m, spacing_m)
    lo = np.searchsorted(r, reach.min(axis=1), side="left")
    hi = np.searchsorted(r, reach.max(axis=1), side="right")
    count = hi - lo
    owner = np.repeat(np.arange(len(tri)), count)
    first = np.repeat(np.cumsum(count) - count, count)
    sample = np.repeat(lo, count) + (np.arange(count.sum()) - first)
    q = r[sample][:, None] * along                              # sample positions in x/z
    p0, p1, p2 = tri[owner, 0], tri[owner, 1], tri[owner, 2]
    e1, e2, w = p1 - p0, p2 - p0, q - p0
    det = e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0]
    u = (w[:, 0] * e2[:, 1] - w[:, 1] * e2[:, 0]) / det
    v = (e1[:, 0] * w[:, 1] - e1[:, 1] * w[:, 0]) / det
    inside = (u >= -1e-9) & (v >= -1e-9) & (u + v <= 1 + 1e-9)
    y = vertices[ids[owner, 0], 1] * (1 - u - v) + vertices[ids[owner, 1], 1] * u + vertices[ids[owner, 2], 1] * v
    elev = np.degrees(np.arctan2(y[inside] - observer_height_m, r[sample][inside]))
    return float(elev.max()) if elev.size else float("nan")


def _stats(diff: np.ndarray) -> dict:
    d = diff[np.isfinite(diff)]
    p5, p50, p95 = np.percentile(d, [5, 50, 95])
    rnd = lambda x: round(float(x), DECIMALS) + 0.0  # + 0.0 turns -0.0 into 0.0
    return {"medianDeg": rnd(p50), "p5Deg": rnd(p5), "p95Deg": rnd(p95), "minDeg": rnd(d.min()),
            "maxDeg": rnd(d.max()), "maxAbsDeg": rnd(np.abs(d).max()), "binsCompared": int(d.size)}


def measure_site(site_id: str, *, with_sampling_check: bool = True) -> dict:
    site_doc = json.loads((config.WEB_DATA_DIR / "sites" / f"{site_id}.json").read_text())
    horizon = site_doc["horizons"]["terrain"]
    obs = float(site_doc["site"]["observerHeightM"])
    folder = config.WEB_DATA_DIR / "terrain3d"
    meta = json.loads((folder / f"{site_id}.json").read_text())
    vertices, faces, sha = read_glb_mesh(folder / meta["file"])
    if sha != meta["sha256"]:
        raise ValueError(f"{site_id}: GLB sha256 does not match its metadata")
    if abs(meta["origin"]["surfaceElevationM"] - site_doc["site"]["surfaceElevationM"]) > 0.01:
        raise ValueError(f"{site_id}: mesh origin is not at the analysed site surface")

    step = float(horizon["azimuthStepDeg"])
    ref = np.asarray(horizon["elevationDeg"], dtype=float)
    az = np.arange(len(ref)) * step
    near_m, extent_m = float(horizon["nearFieldStartM"]), float(horizon["searchExtentM"])
    uncertainty = float(horizon["uncertaintyDeg"])
    near_sky, far_sky = exact_skyline(vertices, faces, obs, az, near_m, extent_m)

    far_diff = far_sky - ref
    near_diff = near_sky - ref
    analysis_range = _stats(far_diff)
    analysis_range["binsBeyondUncertainty"] = int(np.sum(np.abs(far_diff) > uncertainty))
    analysis_range["binsWithoutMesh"] = int(np.sum(~np.isfinite(far_sky)))
    near_field = _stats(near_diff)
    near_field["binsAboveAnalysisHorizon"] = int(np.sum(near_diff > 0))
    near_field["binsAboveByMoreThanUncertainty"] = int(np.sum(near_diff > uncertainty))

    result = {
        "siteId": site_id, "glb": meta["file"], "glbSha256": sha,
        "observerHeightM": obs, "azimuthStepDeg": step, "bins": len(ref),
        "nearFieldStartM": near_m, "searchExtentM": extent_m, "uncertaintyDeg": uncertainty,
        "coverageLimitedBins": int(np.sum(horizon["coverageLimited"])),
        "analysisRange": analysis_range, "nearField": near_field,
    }
    if with_sampling_check:
        result["samplingCheck"] = sampling_check(vertices, faces, obs, az, far_sky, near_m, extent_m)
    return result


def sampling_check(vertices, faces, obs, az, exact_far, near_m, extent_m) -> dict:
    """Ray sampling at decreasing spacing on every Nth bin: how far below the exact skyline it lands."""
    picked = np.arange(0, len(az), CHECK_EVERY_NTH_BIN)
    gaps = {}
    for spacing in CHECK_SPACINGS_M:
        sampled = np.array([sampled_skyline(vertices, faces, obs, az[i], near_m, extent_m, spacing)
                            for i in picked])
        gap = exact_far[picked] - sampled
        gaps[f"{spacing:g}m"] = {"maxExactMinusSampledDeg": round(float(np.nanmax(gap)), 4) + 0.0,
                                 "minExactMinusSampledDeg": round(float(np.nanmin(gap)), 4) + 0.0}
    return {"binsChecked": int(len(picked)), "everyNthBin": CHECK_EVERY_NTH_BIN, "bySpacing": gaps}


def main() -> None:
    sites = [measure_site(site.id) for site in config.SITES]
    report = {
        "description": "Skyline of the shipped 3D display mesh minus the analysis terrain horizon, seen from "
                       "the observer height above the site surface, at the analysis azimuths. Positive = the "
                       "display mesh rises above the horizon used for visibility. Display-only diagnostic; "
                       "visibility results use the terrain horizon, not the mesh.",
        "method": {
            "skyline": "exact maximum over triangle-edge crossings of each azimuth's vertical half-plane",
            "azimuths": "bin i at i * azimuthStepDeg, as sampled by pipeline.terrain.compute_horizon",
            "analysisRange": "nearFieldStartM <= horizontal distance <= searchExtentM",
            "nearField": "0 < horizontal distance <= nearFieldStartM (inside the analysis near-field start)",
            "samplingCheck": f"independent ray sampling at {', '.join(f'{s:g}' for s in CHECK_SPACINGS_M)} m "
                             f"on every {CHECK_EVERY_NTH_BIN}th bin; exact minus sampled must be >= 0 and shrink",
            "decimals": DECIMALS,
        },
        "sites": sites,
    }
    OUTPUT.write_text(json.dumps(report, indent=2) + "\n")
    for s in sites:
        a, n = s["analysisRange"], s["nearField"]
        print(f"{s['siteId']}: analysis range median {a['medianDeg']} [{a['minDeg']}, {a['maxDeg']}] deg, "
              f"{a['binsBeyondUncertainty']}/{s['bins']} bins beyond {s['uncertaintyDeg']} deg; "
              f"near field max {n['maxDeg']} deg; sampling check {s['samplingCheck']['bySpacing']}")


if __name__ == "__main__":
    main()
