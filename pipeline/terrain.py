"""Terrain horizon profiles by 3-D ray marching over the LOLA DEM on the 1 737 400 m sphere.

Geometry (exact on the sphere, no flat-earth or d^2/2R approximation):
  p0  = unit vector of the site (planetocentric lat/lon, ME frame)
  N,E = local north / east unit vectors at the site;  azimuth alpha clockwise from north (Horizons sense)
  ray direction t(alpha) = cos(alpha) N + sin(alpha) E
  terrain sample at ground distance d (arc length on the reference sphere): u = cos(d/R) p0 + sin(d/R) t,
       position T = (R + h(u)) u, h bilinear from the DEM
  observer O = (R + h_site + observer height) p0
  elevation angle of T seen from O = atan2((T-O).p0, |(T-O) - ((T-O).p0) p0|)   (from the local horizontal)
Search: uniform steps of `step_m` from `near_m` to `extent_m`. A ray stops at its first nodata/off-raster
sample. It is *proven complete* at the first distance where even terrain at the DEM's maximum height could
no longer rise above the running maximum; if the ray loses coverage before that point, the azimuth is
flagged coverageLimited.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from . import config
from .dem import Grid, unit_from_latlon, xy_from_unit

R = config.REFERENCE_RADIUS_M


@dataclass
class HorizonProfile:
    az_step_deg: float
    elevation_deg: np.ndarray
    distance_m: np.ndarray
    coverage_limited: np.ndarray
    proven: np.ndarray            # termination criterion reached within valid coverage / extent
    complete_distance_m: np.ndarray
    surface_m: float
    observer_radius_m: float
    near_m: float
    step_m: float
    extent_m: float
    hmax_m: float


def local_frame(lat_deg: float, lon_deg: float):
    lat = np.radians(lat_deg)
    lon = np.radians(lon_deg)
    p0 = np.array([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])
    north = np.array([-np.sin(lat) * np.cos(lon), -np.sin(lat) * np.sin(lon), np.cos(lat)])
    east = np.array([-np.sin(lon), np.cos(lon), 0.0])
    return p0, north, east


def elevation_angle_deg(obs_radius: float, terrain_radius, theta):
    """Elevation (deg) of a point at radius `terrain_radius`, central angle `theta` from an observer at
    radius `obs_radius`, measured from the observer's local horizontal."""
    up = terrain_radius * np.cos(theta) - obs_radius
    horiz = terrain_radius * np.sin(theta)
    return np.degrees(np.arctan2(up, horiz))


def site_surface(grid: Grid, lat_deg: float, lon_deg: float) -> float:
    x, y = xy_from_unit(unit_from_latlon(lat_deg, lon_deg))
    return float(grid.bilinear(x, y))


def compute_horizon(grid: Grid, lat_deg: float, lon_deg: float, *, observer_height_m: float = 2.0,
                    az_step_deg: float = 0.5, near_m: float = 80.0, step_m: float | None = None,
                    extent_m: float = 300_000.0, hmax_m: float | None = None,
                    surface_m: float | None = None, chunk: int = 24) -> HorizonProfile:
    step_m = step_m or grid.dx / 2.0
    if surface_m is None:
        surface_m = site_surface(grid, lat_deg, lon_deg)
    if not np.isfinite(surface_m):
        raise ValueError("site is outside valid DEM coverage")
    if hmax_m is None:
        hmax_m = float(np.nanmax(grid.data))
    p0, north, east = local_frame(lat_deg, lon_deg)
    r_obs = R + surface_m + observer_height_m
    d = np.arange(near_m, extent_m + 0.5 * step_m, step_m)
    theta = d / R
    bound = elevation_angle_deg(r_obs, R + hmax_m, theta)   # best case beyond each distance (decreasing)

    naz = int(round(360.0 / az_step_deg))
    az = np.arange(naz) * az_step_deg
    elev = np.full(naz, np.nan)
    dist = np.full(naz, np.nan)
    cov = np.zeros(naz, dtype=bool)
    proven = np.zeros(naz, dtype=bool)
    complete = np.full(naz, np.nan)
    cos_t, sin_t = np.cos(theta), np.sin(theta)
    for a0 in range(0, naz, chunk):
        al = np.radians(az[a0:a0 + chunk])
        tdir = np.cos(al)[:, None] * north[None, :] + np.sin(al)[:, None] * east[None, :]   # (k,3)
        u = cos_t[None, :, None] * p0[None, None, :] + sin_t[None, :, None] * tdir[:, None, :]  # (k,n,3)
        x, y = xy_from_unit(u)
        h = grid.bilinear(x, y)
        e = elevation_angle_deg(r_obs, R + h, theta[None, :])
        for k in range(e.shape[0]):
            i = a0 + k
            ek = e[k]
            bad = ~np.isfinite(ek)
            n_valid = int(np.argmax(bad)) if bad.any() else ek.size
            if n_valid == 0:
                raise ValueError(f"no valid DEM sample at {near_m} m for azimuth {az[i]} deg")
            pre = ek[:n_valid]
            cm = np.maximum.accumulate(pre)
            # Terrain at distance >= d[j+1] cannot exceed bound[j+1] (bound decreases with distance), so the
            # profile is complete at the first j with bound[j+1] <= running max up to j.
            m = min(n_valid, bound.size - 1)
            ok = bound[1:m + 1] <= cm[:m]
            if ok.any():
                proven[i] = True
                complete[i] = d[int(np.argmax(ok)) + 1]
            else:
                # Not proven: either coverage ended (flag) or the fixed extent was reached (counted in
                # the assumptions; extent is chosen so that this does not happen at the demo points).
                cov[i] = n_valid < ek.size
            jm = int(np.argmax(pre))
            elev[i] = pre[jm]
            dist[i] = d[jm]
    return HorizonProfile(az_step_deg, elev, dist, cov, proven, complete, surface_m, r_obs, near_m, step_m,
                          extent_m, hmax_m)
