"""Checks against the real LOLA DEM. Skipped when the (git-ignored) rasters are not downloaded."""

import json

import numpy as np
import pytest

from pipeline import config, dem

DEM_PATH = config.DEM_DIR / config.DEM_PRODUCT
PDS_IMG = config.DEM_DIR / "LDEM_75S_240M.IMG"
PDS_LBL = config.REPO_ROOT / "data" / "raw" / "lola_pds" / "LDEM_75S_240M.LBL"

needs_dem = pytest.mark.skipif(not DEM_PATH.exists(), reason="LOLA DEM not downloaded")


@pytest.fixture(scope="module")
def grid():
    return dem.load_grid(level=1)      # 80 m overview is enough for these checks and loads fast


@needs_dem
def test_geotiff_metadata_matches_assumed_projection():
    info = dem.read_geotiff_info(DEM_PATH)     # raises on any mismatch
    assert info["shape"] == [15200, 15200] and info["pixelScale"][:2] == [40.0, 40.0]
    assert info["tiepoint"][3:5] == [-304000.0, 304000.0]
    assert all(info["checks"].values())
    recorded = json.loads((config.REPO_ROOT / "data" / "derived" / "dem_info.json").read_text())
    assert recorded["sha256"] and recorded["size"] == DEM_PATH.stat().st_size


@needs_dem
def test_shackleton_crater_is_where_the_projection_says(grid):
    """Known feature: Shackleton crater, centre ~89.67 S 129.8 E, ~21 km diameter, floor ~4 km below rim."""
    x, y = dem.latlon_to_xy(-89.67, 129.8)
    centre = float(grid.bilinear(x, y))
    p0 = dem.unit_from_latlon(-89.67, 129.8)
    # Ring of points at 10.5 km ground distance (approximately the rim).
    from pipeline.terrain import local_frame
    _, n, e = local_frame(-89.67, 129.8)
    th = 10_500 / config.REFERENCE_RADIUS_M
    ring = []
    for a in np.radians(np.arange(0, 360, 15)):
        u = np.cos(th) * p0 + np.sin(th) * (np.cos(a) * n + np.sin(a) * e)
        ring.append(float(grid.bilinear(*dem.xy_from_unit(u))))
    assert np.median(ring) - centre > 3000          # deep bowl centred on the expected coordinates
    # Mirror-image control: the same test at the longitude mirrored about the 0/180 axis fails.
    xm, ym = dem.latlon_to_xy(-89.67, 360 - 129.8)
    assert abs(float(grid.bilinear(xm, ym)) - centre) > 1000


@needs_dem
@pytest.mark.skipif(not PDS_IMG.exists(), reason="PDS GDR not downloaded")
def test_heights_and_registration_agree_with_independent_pds_gdr(grid):
    """PDS LDEM_75S_240M (label: heights relative to 1737.4 km, MEAN EARTH/POLAR AXIS of DE421)."""
    pds = dem.load_pds_img(PDS_IMG, PDS_LBL)
    rng = np.random.default_rng(1)
    lat = rng.uniform(-89.9, -80.5, 4000)
    lon = rng.uniform(0, 360, 4000)
    x, y = dem.latlon_to_xy(lat, lon)
    a = grid.bilinear(x, y)
    b = pds.bilinear(x, y)
    ok = np.isfinite(a) & np.isfinite(b)
    d = (a - b)[ok]
    assert ok.sum() > 3500
    assert abs(np.median(d)) < 5.0           # same height reference (a 1 km reference offset would show)
    assert np.percentile(np.abs(d), 90) < 150  # same registration (half-pixel or axis errors blow this up)
    # Control: a one-pixel (240 m) shift of the PDS grid is clearly worse.
    b_shift = pds.bilinear(x + 240.0, y)
    d_shift = (a - b_shift)[ok & np.isfinite(b_shift)]
    assert np.percentile(np.abs(d_shift), 90) > np.percentile(np.abs(d), 90)


@needs_dem
def test_site_points_inside_valid_coverage(grid):
    for s in config.SITES:
        x, y = dem.latlon_to_xy(s.lat_deg, s.lon_east_deg)
        assert np.isfinite(grid.bilinear(x, y)), s.id


@needs_dem
def test_off_coverage_is_nan(grid):
    # The product is gap-filled over the whole +-304 km square (no NaN pixels, checked in
    # docs/verification-data.md), so "valid coverage" ends at the raster edge, which reads as NaN.
    assert np.isnan(grid.bilinear(400_000.0, 0.0))
    assert np.isnan(grid.bilinear(0.0, -304_000.0 + 10.0))   # inside the last half pixel: no 4 neighbours
    assert np.isfinite(grid.bilinear(0.0, -304_000.0 + 100.0))
