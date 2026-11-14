"""Independent geometric checks for the display exporter (not visibility analysis)."""
import hashlib
import json
import struct

import numpy as np
import pytest

from pipeline import config, dem
from pipeline.export_terrain3d import local_positions, make_patch


def sphere_grid():
    return dem.Grid(np.zeros((501, 501), dtype=np.float32), -25050, 25050, 100, 100, "test sphere")


def test_local_frame_origin_and_curvature():
    grid = sphere_grid()
    origin = local_positions(grid, -90, 0, 0, np.array([0.]), np.array([0.]))[0]
    assert np.linalg.norm(origin) < 1e-8
    p = local_positions(grid, -90, 0, 0, np.array([1000.]), np.array([0.]))[0]
    assert p[0] > 999.9  # east, not mirrored
    assert abs(p[2]) < 1e-8
    # An independent sphere equation: ground falls below the local tangent plane.
    assert p[1] == pytest.approx(np.sqrt(config.REFERENCE_RADIUS_M**2 - p[0]**2) - config.REFERENCE_RADIUS_M, abs=1e-8)
    north = local_positions(grid, -90, 0, 0, np.array([0.]), np.array([1000.]))[0]
    assert north[2] < -999.9


def test_faces_point_outward_and_units_are_metres():
    vertices, normals, faces, _ = make_patch(sphere_grid(), -90, 0, 0, 40, side=17, stitch=False)
    assert np.all(normals[:, 1] > .999)
    assert vertices[:, 0].max() == pytest.approx(320, abs=.01)
    assert vertices[:, 2].max() == pytest.approx(320, abs=.01)
    v = vertices[faces]
    assert np.all(np.cross(v[:, 1] - v[:, 0], v[:, 2] - v[:, 0])[:, 1] > 0)


def test_nan_terrain_is_omitted_not_filled_as_mountains():
    grid = sphere_grid()
    grid.data[:, 250:] = np.nan
    vertices, normals, faces, _ = make_patch(grid, -90, 0, 0, 40, side=17, stitch=False)
    assert len(faces) < 17 * 17 * 2
    assert np.isfinite(vertices).all() and np.isfinite(normals).all()
    assert (vertices[:, 0] < 0).all()


def test_fine_outer_edge_lies_on_coarse_inner_edge():
    grid = sphere_grid()
    # Add resolved relief so a missing seam adjustment would be detectable.
    yy, xx = np.indices(grid.data.shape)
    grid.data[:] = 30 * np.sin(xx / 3) + 10 * np.cos(yy / 4)
    surface = float(grid.bilinear(0, 0))
    vertices, _, _, adjustment = make_patch(grid, -90, 0, surface, 40, side=17)
    assert adjustment > 0
    offsets = np.arange(-320, 321, 160)
    coarse = local_positions(grid, -90, 0, surface, offsets, np.full(5, 320.))
    for k in range(17):
        segment = min(k // 4, 3)
        fraction = (k - segment * 4) / 4
        expected = coarse[segment] * (1 - fraction) + coarse[segment + 1] * fraction
        assert np.min(np.linalg.norm(vertices - expected, axis=1)) < .001


@pytest.mark.parametrize("site_id", ["demo-a", "demo-b", "demo-c"])
def test_shipped_glb_integrity_and_source(site_id):
    folder = config.WEB_DATA_DIR / "terrain3d"
    if not (folder / f"{site_id}.glb").exists():
        pytest.skip("3D assets not generated")
    data = (folder / f"{site_id}.glb").read_bytes()
    meta = json.loads((folder / f"{site_id}.json").read_text())
    magic, version, size = struct.unpack("<4sII", data[:12])
    assert (magic, version, size) == (b"glTF", 2, len(data))
    assert len(data) == meta["bytes"]
    assert hashlib.sha256(data).hexdigest() == meta["sha256"]
    json_len, kind = struct.unpack("<I4s", data[12:20])
    assert kind == b"JSON"
    doc = json.loads(data[20:20+json_len])
    assert doc["extras"]["sourceSha256"] == config.RASTER_SHA256[config.DEM_PRODUCT]
    assert doc["extras"]["surfaceAgreementM"] < .01
    assert doc["extras"]["verticalExaggeration"] == 1
    binary = data[28+json_len:]
    for mesh in doc["meshes"]:
        p = mesh["primitives"][0]
        def array(accessor_id, dtype, dim):
            a = doc["accessors"][accessor_id]
            view = doc["bufferViews"][a["bufferView"]]
            assert view["byteOffset"] + view["byteLength"] <= len(binary)
            return np.frombuffer(binary, dtype=dtype, count=a["count"]*dim, offset=view["byteOffset"]).reshape(-1, dim)
        vertices = array(p["attributes"]["POSITION"], "<f4", 3)
        normals = array(p["attributes"]["NORMAL"], "<f4", 3)
        indices = array(p["indices"], "<u4", 1)
        assert np.isfinite(vertices).all()
        assert np.allclose(np.linalg.norm(normals, axis=1), 1, atol=1e-5)
        assert indices.max() < len(vertices)
