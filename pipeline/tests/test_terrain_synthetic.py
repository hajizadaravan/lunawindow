"""Terrain horizon maths against analytic answers on synthetic DEMs built on the curved Moon."""

import numpy as np
import pytest

from pipeline import dem
from pipeline.analysis import horizon_lookup
from pipeline.dem import Grid, latlon_to_xy, xy_to_latlon
from pipeline.terrain import compute_horizon, elevation_angle_deg, local_frame

R = 1737400.0
LAT, LON = -89.0, 45.0
PIX = 50.0
HALF = 110_000.0


def _grid_and_distance():
    n = int(2 * HALF / PIX)
    g = Grid(np.zeros((n, n), np.float32), -HALF, HALF, PIX, PIX, "synthetic")
    cols, rows = np.meshgrid(np.arange(n), np.arange(n))
    x, y = g.pixel_to_xy(cols, rows)
    lat, lon = xy_to_latlon(x, y)
    u = dem.unit_from_latlon(lat, lon)
    p0, north, east = local_frame(LAT, LON)
    cosang = np.clip(u @ p0, -1, 1)
    ground = R * np.arccos(cosang)
    az = np.degrees(np.arctan2(u @ east, u @ north)) % 360.0
    return g, ground, az


@pytest.fixture(scope="module")
def synth():
    return _grid_and_distance()


def test_flat_sphere_gives_analytic_dip(synth):
    g, _, _ = synth
    prof = compute_horizon(g, LAT, LON, observer_height_m=2.0, az_step_deg=5.0, near_m=40.0, step_m=10.0,
                           extent_m=60_000.0, hmax_m=0.0, surface_m=0.0)
    dip = -np.degrees(np.arccos(R / (R + 2.0)))            # -0.0870 deg
    tangent = R * np.arccos(R / (R + 2.0))                 # 2636 m
    assert np.all(np.abs(prof.elevation_deg - dip) < 2e-4)
    assert np.all(np.abs(prof.distance_m - tangent) < 60)
    assert prof.proven.all() and not prof.coverage_limited.any()


def test_plateau_of_known_height_and_distance(synth):
    g, ground, _ = synth
    H, D = 1500.0, 20_000.0
    g2 = Grid(np.where(ground >= D, H, 0.0).astype(np.float32), g.x0, g.y0, g.dx, g.dy, "plateau")
    prof = compute_horizon(g2, LAT, LON, az_step_deg=10.0, near_m=40.0, step_m=10.0, extent_m=100_000.0,
                           hmax_m=H, surface_m=0.0)
    expected = float(elevation_angle_deg(R + 2.0, R + H, D / R))   # exact curved-Moon answer (~4.23 deg)
    flat_earth = np.degrees(np.arctan((H - 2.0) / D))
    assert abs(expected - flat_earth) > 0.15       # curvature matters at this distance...
    # ...and the march reproduces the exact value (edge smeared by one 50 m pixel -> < 0.02 deg)
    assert np.all(np.abs(prof.elevation_deg - expected) < 0.02), prof.elevation_deg
    assert np.all(np.abs(prof.distance_m - D) < 2 * PIX)


def test_ridge_across_north_wraps(synth):
    g, ground, az = synth
    wall = (ground >= 10_000) & (ground <= 10_400) & ((az >= 357.0) | (az <= 3.0))
    g3 = Grid(np.where(wall, 800.0, 0.0).astype(np.float32), g.x0, g.y0, g.dx, g.dy, "wrap")
    prof = compute_horizon(g3, LAT, LON, az_step_deg=1.0, near_m=40.0, step_m=10.0, extent_m=60_000.0,
                           hmax_m=800.0, surface_m=0.0)
    e = prof.elevation_deg
    high = float(elevation_angle_deg(R + 2.0, R + 800.0, 10_000 / R))
    for i in (0, 1, 2, 358, 359):
        assert abs(e[i] - high) < 0.1, (i, e[i])
    for i in (5, 90, 180, 270, 355):
        assert e[i] < 0.0
    hz = {"kind": "terrain", "id": "terrain-lola", "azimuthStepDeg": 1.0, "elevationDeg": e.tolist(),
          "uncertaintyDeg": 0}
    H = horizon_lookup(hz)
    assert abs(H(359.5) - 0.5 * (e[359] + e[0])) < 1e-12
    assert abs(H(360.0) - e[0]) < 1e-12


def test_nodata_sector_flags_coverage(synth):
    g, ground, az = synth
    H = 1500.0
    data = np.where(ground >= 20_000, H, 0.0).astype(np.float32)
    data[(az > 80) & (az < 100) & (ground > 5_000)] = np.nan   # coverage lost before the plateau
    g4 = Grid(data, g.x0, g.y0, g.dx, g.dy, "nodata")
    prof = compute_horizon(g4, LAT, LON, az_step_deg=10.0, near_m=40.0, step_m=10.0, extent_m=100_000.0,
                           hmax_m=H, surface_m=0.0)
    assert prof.coverage_limited[9] and not prof.proven[9]          # az 90
    assert not prof.coverage_limited[0] and prof.proven[0]
    assert prof.distance_m[9] < 5_000


def test_off_raster_flags_coverage(synth):
    g, _, _ = synth
    prof = compute_horizon(g, LAT, LON, az_step_deg=45.0, near_m=40.0, step_m=10.0, extent_m=300_000.0,
                           hmax_m=7000.0, surface_m=0.0)
    # With a 7 km maximum height the bound only closes ~160 km out. Rays heading away from the pole (az 0)
    # hit the 110 km raster edge first and must be flagged; the ray over the pole into the far corner (az 180)
    # stays on the raster long enough to be proven. Every ray is exactly one of the two.
    assert prof.coverage_limited[0] and not prof.proven[0]
    assert prof.proven[4] and not prof.coverage_limited[4]
    assert np.array_equal(prof.coverage_limited, ~prof.proven)


def test_site_outside_coverage_raises(synth):
    g, _, _ = synth
    g5 = Grid(np.full(g.shape, np.nan, np.float32), g.x0, g.y0, g.dx, g.dy, "empty")
    with pytest.raises(ValueError):
        compute_horizon(g5, LAT, LON, az_step_deg=45.0)


def test_projection_round_trip():
    lat = np.array([-89.999, -89.45, -88.0, -86.0, -80.0])
    lon = np.array([0.0, 222.7, 359.99, 90.0, 180.0])
    x, y = latlon_to_xy(lat, lon)
    lat2, lon2 = xy_to_latlon(x, y)
    assert np.allclose(lat, lat2, atol=1e-10)
    assert np.allclose(np.mod(lon - lon2 + 180, 360) - 180, 0, atol=1e-8)
    xu, yu = dem.xy_from_unit(dem.unit_from_latlon(lat, lon))
    assert np.allclose(x, xu, atol=1e-6) and np.allclose(y, yu, atol=1e-6)
    # Axis orientation: lon 0 -> +y, lon 90E -> +x (contract formula).
    x0, y0 = latlon_to_xy(-85.0, 0.0)
    x9, y9 = latlon_to_xy(-85.0, 90.0)
    assert abs(x0) < 1e-6 and y0 > 0 and x9 > 0 and abs(y9) < 1e-6
    g = Grid(np.zeros((10, 10), np.float32), -200.0, 200.0, 40.0, 40.0, "t")
    col, row = g.xy_to_pixel(*g.pixel_to_xy(3.0, 7.0))
    assert abs(col - 3) < 1e-12 and abs(row - 7) < 1e-12
    assert g.xy_to_pixel(-200.0 + 20.0, 200.0 - 20.0) == (0.0, 0.0)  # centre of pixel (0, 0)


def test_bilinear_nodata_and_edges():
    data = np.arange(16, dtype=np.float32).reshape(4, 4)
    data[0, 3] = np.nan
    g = Grid(data, 0.0, 4.0, 1.0, 1.0, "t")
    x, y = g.pixel_to_xy(1.5, 1.5)
    assert float(g.bilinear(x, y)) == pytest.approx((5 + 6 + 9 + 10) / 4)
    x, y = g.pixel_to_xy(2.5, 0.5)
    assert np.isnan(g.bilinear(x, y))           # touches the NaN neighbour
    x, y = g.pixel_to_xy(-0.5, 1.0)
    assert np.isnan(g.bilinear(x, y))           # off-raster
