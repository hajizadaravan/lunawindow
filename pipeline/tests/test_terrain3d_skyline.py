"""Display-mesh skyline vs analysis terrain horizon (pipeline.terrain3d_skyline). Needs no DEM."""
import json

import numpy as np
import pytest

from pipeline import config
from pipeline import terrain3d_skyline as sky

# Measured on the committed GLBs (data/derived/terrain3d-skyline.json): max |mesh - horizon| beyond the
# near field is 0.298 deg (A), 0.140 (B), 0.225 (C). The ceiling catches a mesh change that makes the
# displayed skyline clearly worse, not rounding noise.
ANALYSIS_RANGE_CEILING_DEG = 0.35


def ridge_mesh():
    """Two triangles meeting in a crest edge from (-10, 5, -100) to (10, 5, -100), i.e. 100 m north.

    Only the crest edge reaches 5 m; the ray at azimuth 0 crosses it at its midpoint, between vertices."""
    v = np.array([[-10, 0, -90], [10, 0, -90], [-10, 5, -100], [10, 5, -100], [-10, 0, -110], [10, 0, -110]],
                 dtype=float)
    f = np.array([[0, 1, 2], [1, 3, 2], [2, 3, 4], [3, 5, 4]])
    return v, f


def test_exact_skyline_finds_a_crest_between_vertices():
    v, f = ridge_mesh()
    near, far = sky.exact_skyline(v, f, 2.0, np.array([0.0, 180.0]), 80.0, 300_000.0)
    assert far[0] == pytest.approx(np.degrees(np.arctan2(3.0, 100.0)), abs=1e-9)
    assert np.isnan(far[1]) and np.all(np.isnan(near))      # nothing south, nothing inside 80 m
    sampled = sky.sampled_skyline(v, f, 2.0, 0.0, 80.0, 300_000.0, 7.0)   # samples miss the crest
    assert sampled < far[0]


def test_exact_skyline_includes_surface_at_the_near_field_limit():
    # A slope falling away from the observer: its highest analysed point is at exactly r = 80 m,
    # which is inside a triangle, not on an edge crossing.
    v = np.array([[-10, 10, -70], [10, 10, -70], [-10, 0, -120], [10, 0, -120]], dtype=float)
    f = np.array([[0, 1, 2], [1, 3, 2]])
    near, far = sky.exact_skyline(v, f, 2.0, np.array([0.0]), 80.0, 300_000.0)
    assert far[0] == pytest.approx(np.degrees(np.arctan2(8.0 - 2.0, 80.0)), abs=1e-9)
    assert near[0] == pytest.approx(np.degrees(np.arctan2(10.0 - 2.0, 70.0)), abs=1e-9)


def test_shipped_mesh_skyline_stays_close_to_the_analysis_horizon():
    result, web = sky._measure("demo-b", with_sampling_check=False)
    # The committed web file is exactly what this module writes for the shipped GLB.
    assert json.loads(sky.web_skyline_path("demo-b").read_text()) == web
    meta = json.loads((config.WEB_DATA_DIR / "terrain3d" / "demo-b.json").read_text())
    assert result["glbSha256"] == meta["sha256"]
    assert result["bins"] == 720 and result["azimuthStepDeg"] == 0.5
    far = result["analysisRange"]
    assert far["binsCompared"] == 720 and far["binsWithoutMesh"] == 0
    assert far["minDeg"] <= far["p5Deg"] <= far["medianDeg"] <= far["p95Deg"] <= far["maxDeg"]
    assert far["maxAbsDeg"] < ANALYSIS_RANGE_CEILING_DEG


def test_recorded_report_matches_shipped_glbs():
    report = json.loads(sky.OUTPUT.read_text())
    assert [s["siteId"] for s in report["sites"]] == [s.id for s in config.SITES]
    for s in report["sites"]:
        meta = json.loads((config.WEB_DATA_DIR / "terrain3d" / f"{s['siteId']}.json").read_text())
        assert s["glbSha256"] == meta["sha256"], "GLB changed: rerun python -m pipeline.terrain3d_skyline"
        assert s["analysisRange"]["maxAbsDeg"] < ANALYSIS_RANGE_CEILING_DEG
        gaps = s["samplingCheck"]["bySpacing"]
        assert all(g["minExactMinusSampledDeg"] >= 0 for g in gaps.values())   # exact is an upper bound
        finest = gaps[f"{sky.CHECK_SPACINGS_M[-1]:g}m"]["maxExactMinusSampledDeg"]
        assert finest < gaps[f"{sky.CHECK_SPACINGS_M[0]:g}m"]["maxExactMinusSampledDeg"] and finest < 0.02


def test_display_skyline_takes_the_higher_range_and_keeps_missing_bins_missing():
    near = np.array([1.0, np.nan, 0.5, np.nan])
    far = np.array([0.5, 2.0, 0.7, np.nan])
    assert sky.display_skyline(near, far) == [1.0, 2.0, 0.7, None]


def test_web_skyline_files_match_shipped_glbs_and_analysis_bins():
    for site in config.SITES:
        web = json.loads(sky.web_skyline_path(site.id).read_text())
        meta = json.loads((config.WEB_DATA_DIR / "terrain3d" / f"{site.id}.json").read_text())
        site_doc = json.loads((config.WEB_DATA_DIR / "sites" / f"{site.id}.json").read_text())
        horizon = site_doc["horizons"]["terrain"]
        assert web["schemaVersion"] == sky.WEB_SKYLINE_SCHEMA and web["siteId"] == site.id
        assert web["glbSha256"] == meta["sha256"], "GLB changed: rerun python -m pipeline.terrain3d_skyline"
        assert web["horizonId"] == horizon["id"] and web["azimuthStepDeg"] == horizon["azimuthStepDeg"]
        assert web["observerHeightM"] == site_doc["site"]["observerHeightM"]
        assert len(web["elevationDeg"]) == len(horizon["elevationDeg"])
        assert all(v is None or -90 <= v <= 90 for v in web["elevationDeg"])
