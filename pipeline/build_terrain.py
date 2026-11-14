"""Build terrain horizon profiles + site checks for every demonstration point from the LOLA DEM.

Usage:  .venv/bin/python -m pipeline.build_terrain
Needs data/dem/LDEM_80S_40MPP_ADJ.TIF (see docs/data-pipeline.md). Writes data/derived/dem_info.json and
data/derived/terrain/<siteId>.json (committed, so export and the web app never need the DEM).
Optional: data/dem/LDEM_80S_80MPP_ADJ_ERR.TIF (height-error map) and data/dem/LDEM_75S_240M.IMG (+ the
cached PDS label) for the independent height/registration check.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

import numpy as np

from . import config, dem
from .ephemeris import derived_terrain_path
from .terrain import compute_horizon, local_frame

AZ_STEP = 0.5
NEAR_M = 80.0
EXTENT_M = 300_000.0
UNC_FLOOR = 0.05


def _rms(x):
    x = np.asarray(x, float)
    x = x[np.isfinite(x)]
    return float(np.sqrt(np.mean(x ** 2))) if x.size else float("nan")


def local_slope_deg(grid: dem.Grid, lat: float, lon: float) -> float:
    """Slope from central differences of the bilinear DEM over +-1 pixel along local north/east."""
    p0, north, east = local_frame(lat, lon)
    d = grid.dx
    th = d / config.REFERENCE_RADIUS_M

    def h_at(direction):
        u = np.cos(th) * p0 + np.sin(th) * direction
        return float(grid.bilinear(*dem.xy_from_unit(u)))

    dzdn = (h_at(north) - h_at(-north)) / (2 * d)
    dzde = (h_at(east) - h_at(-east)) / (2 * d)
    return float(np.degrees(np.arctan(np.hypot(dzdn, dzde))))


SHACKLETON = (-89.67, 129.8)


def _neighbourhood_check(grid: dem.Grid, x: float, y: float, h0: float, half_px: int = 25) -> str:
    c, r = (int(round(float(v))) for v in grid.xy_to_pixel(x, y))
    h, wd = grid.shape
    if r - half_px < 0 or c - half_px < 0 or r + half_px >= h or c + half_px >= wd:
        raise ValueError("neighbourhood check window leaves the raster")
    w = grid.data[r - half_px:r + half_px + 1, c - half_px:c + half_px + 1]
    i = np.unravel_index(int(np.nanargmax(w)), w.shape)
    xm, ym = grid.pixel_to_xy(c - half_px + i[1], r - half_px + i[0])
    km = half_px * grid.dx / 1000
    hi, lo = float(np.nanmax(w)), float(np.nanmin(w))
    return (f"Neighbourhood (+-{km:.0f} km square of 40 m pixels): highest pixel {hi:.1f} m at "
            f"{np.hypot(xm - x, ym - y):.0f} m from the point, lowest {lo:.1f} m; the point is "
            f"{hi - h0:.1f} m below the local high; {int(np.isnan(w).sum())} nodata pixels.")


def _dem_info() -> dict:
    path = config.DEM_DIR / config.DEM_PRODUCT
    info_path = config.REPO_ROOT / "data" / "derived" / "dem_info.json"
    info = dem.read_geotiff_info(path)
    info["sha256"] = dem.verify_raster(path)
    info["size"] = path.stat().st_size
    old = json.loads(info_path.read_text()) if info_path.exists() else {}
    # retrievedAtUtc = first time this exact file was processed (download completion time on that run).
    if old.get("sha256") == info["sha256"] and old.get("retrievedAtUtc"):
        info["retrievedAtUtc"] = old["retrievedAtUtc"]
    else:
        info["retrievedAtUtc"] = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ")
    info["url"] = config.DEM_URL
    info_path.parent.mkdir(parents=True, exist_ok=True)
    info_path.write_text(json.dumps(info, indent=2) + "\n")
    return info


def build(sites=None) -> dict:
    info = _dem_info()
    grid = dem.load_grid()
    coarse = grid.block_mean(2)
    hmax = float(np.nanmax(grid.data))
    err_path = config.DEM_DIR / config.DEM_ERR_PRODUCT
    err = None
    if err_path.exists():
        dem.verify_raster(err_path)
        err = dem.load_grid(err_path)
    pds_img = config.DEM_DIR / "LDEM_75S_240M.IMG"
    pds_lbl = config.REPO_ROOT / "data" / "raw" / "lola_pds" / "LDEM_75S_240M.LBL"
    pds = None
    if pds_img.exists() and pds_lbl.exists():
        dem.verify_raster(pds_img)
        pds = dem.load_pds_img(pds_img, pds_lbl)

    results = {}
    for site in (sites or config.SITES):
        lat, lon = site.lat_deg, site.lon_east_deg
        x, y = dem.xy_from_unit(dem.unit_from_latlon(lat, lon))
        h0 = float(grid.bilinear(x, y))
        if not np.isfinite(h0):
            raise ValueError(f"{site.id} is outside valid DEM coverage")
        prof = compute_horizon(grid, lat, lon, observer_height_m=config.OBSERVER_HEIGHT_M, az_step_deg=AZ_STEP,
                               near_m=NEAR_M, step_m=grid.dx / 2, extent_m=EXTENT_M, hmax_m=hmax, surface_m=h0)
        prof_c = compute_horizon(coarse, lat, lon, observer_height_m=config.OBSERVER_HEIGHT_M,
                                 az_step_deg=AZ_STEP, near_m=NEAR_M, step_m=coarse.dx / 2, extent_m=EXTENT_M,
                                 hmax_m=hmax)
        d_res = prof.elevation_deg - prof_c.elevation_deg
        u_res = _rms(d_res)
        # Vertical DEM error (1 sigma, from the producer's error map) converted to angle at the horizon point.
        u_err = None
        sig_site = None
        if err is not None:
            sig_site = float(err.bilinear(x, y))
            p0, north, east = local_frame(lat, lon)
            az = np.radians(np.arange(prof.elevation_deg.size) * AZ_STEP)
            tdir = np.cos(az)[:, None] * north + np.sin(az)[:, None] * east
            th = prof.distance_m / config.REFERENCE_RADIUS_M
            u = np.cos(th)[:, None] * p0 + np.sin(th)[:, None] * tdir
            sig_h = err.bilinear(*dem.xy_from_unit(u))
            ang = np.degrees(np.arctan(np.sqrt(sig_site ** 2 + sig_h ** 2) / prof.distance_m))
            u_err = _rms(ang)
        u_tot = float(np.sqrt(u_res ** 2 + (u_err or 0.0) ** 2))
        unc = max(UNC_FLOOR, float(np.ceil(u_tot * 100) / 100))
        slope = local_slope_deg(grid, lat, lon)
        n_cov = int(prof.coverage_limited.sum())
        n_unproven = int((~prof.proven).sum())
        e = prof.elevation_deg

        checks = [
            f"Inside valid LOLA coverage of {config.DEM_PRODUCT}: bilinear surface height {h0:.1f} m above the "
            f"1737.4 km sphere (all four neighbouring 40 m pixels valid).",
            f"Local slope from the DEM (central differences over +-{grid.dx:.0f} m): {slope:.1f} deg.",
            f"Terrain horizon over {e.size} azimuths: min {np.nanmin(e):.2f} deg, max {np.nanmax(e):.2f} deg, "
            f"median {np.nanmedian(e):.2f} deg; horizon-defining terrain between {np.nanmin(prof.distance_m)/1000:.2f} "
            f"and {np.nanmax(prof.distance_m)/1000:.1f} km.",
            f"Search completeness: {e.size - n_unproven} of {e.size} azimuths proven complete (no terrain up to "
            f"the DEM maximum {hmax:.0f} m could rise above the found horizon beyond the stopping distance); "
            f"{n_cov} azimuths flagged coverageLimited.",
            f"Resolution sensitivity: same algorithm on a 2x2-averaged 80 m grid differs by RMS {u_res:.3f} deg, "
            f"max {np.nanmax(np.abs(d_res)):.3f} deg.",
        ]
        checks.append(_neighbourhood_check(grid, x, y, h0))
        sh = dem.unit_from_latlon(SHACKLETON[0], SHACKLETON[1]) @ dem.unit_from_latlon(lat, lon)
        checks.append(f"Ground distance from the centre of Shackleton crater ({SHACKLETON[0]}, {SHACKLETON[1]} E; "
                      f"bowl location verified in the DEM by pipeline/tests/test_dem_real.py): "
                      f"{config.REFERENCE_RADIUS_M * np.arccos(min(1.0, sh)) / 1000:.1f} km.")
        if u_err is not None:
            checks.append(f"LOLA height-error map ({config.DEM_ERR_PRODUCT}): {sig_site:.1f} m at the point; "
                          f"propagated to the horizon points gives RMS {u_err:.3f} deg.")
        if pds is not None:
            hp = float(pds.bilinear(x, y))
            checks.append(f"Independent PDS LOLA GDR LDEM_75S_240M (heights relative to 1737.4 km per its label): "
                          f"{hp:.1f} m at the point vs {h0:.1f} m from the 40 m DEM (240 m smoothing).")

        horizon = {
            "kind": "terrain",
            "id": "terrain-lola",
            "label": "Terrain horizon from LOLA elevation data",
            "azimuthStepDeg": AZ_STEP,
            "elevationDeg": [round(float(v), 4) for v in e],
            "distanceM": [int(round(float(v))) for v in prof.distance_m],
            "coverageLimited": [bool(v) for v in prof.coverage_limited],
            "searchExtentM": EXTENT_M,
            "nearFieldStartM": NEAR_M,
            "curvatureModel": (
                "Exact spherical geometry: samples placed along the great circle at ground (arc) distance d on "
                "the 1737.4 km sphere, terrain point radius 1737400 m + DEM height, observer radius 1737400 m + "
                "surface height + 2 m, elevation angle measured from the observer's local horizontal plane "
                "(perpendicular to the radial zenith). No d^2/2R approximation."),
            "uncertaintyDeg": unc,
            "dem": {
                "sourceId": "lola-ldem-80s-40mpp",
                "product": config.DEM_PRODUCT,
                "resolutionM": grid.dx,
                "projection": "South polar stereographic on a 1737400 m sphere, natural origin latitude -90, "
                              "scale factor 1 at the pole, central meridian 0 (x = r sin lon, y = r cos lon), "
                              "PixelIsArea, upper-left corner (-304000, 304000) m, 40 m pixels (GeoTIFF GeoKeys)",
                "heightReference": "metres above 1737400 m sphere",
                "scaling": "float32 metres used as stored: no scale/offset in the GeoTIFF metadata; GDAL_NODATA = "
                           "NaN treated as missing; bilinear interpolation is NaN if any of the 4 neighbours is "
                           "NaN or off-raster",
            },
            "assumptions": [
                f"Azimuth bins every {AZ_STEP} deg starting at 0 deg, clockwise from local north (same sense as "
                "Horizons); horizon elevation is the maximum elevation angle of DEM terrain along each azimuth.",
                f"Ray samples every {grid.dx/2:.0f} m (half a pixel) from {NEAR_M:.0f} m to at most "
                f"{EXTENT_M/1000:.0f} km; a ray stops at the first nodata/off-raster sample and is flagged "
                "coverageLimited if that happens before the search is proven complete.",
                "Proven-complete criterion: the ray stops once terrain at the DEM's global maximum height "
                f"({hmax:.0f} m) could no longer reach the running maximum elevation angle at any farther "
                "distance.",
                f"Terrain closer than {NEAR_M:.0f} m (2 pixels) is not sampled: the 40 m DEM cannot resolve "
                "metre-scale relief around a 2 m mast; boulders, small craters and local slope breaks inside a "
                "pixel are not represented.",
                "The 80 m comparison horizon re-derives the surface height from the 80 m grid as well, so the "
                "resolution term includes the DEM's uncertainty in the observer's own height (deliberate).",
                f"uncertaintyDeg = max({UNC_FLOOR}, RMS of the 40 m vs 80 m horizon difference combined in "
                "quadrature with the producer's height error propagated to the horizon points), rounded up to "
                "0.01 deg. It is an estimate, not a validated error bound.",
                "Frame: LOLA MOON_ME (DE421) treated as identical to Horizons MEAN_ME; residual not quantified.",
            ],
        }
        rec = {
            "siteId": site.id,
            "latDeg": lat,
            "lonEastDeg": lon,
            "surfaceElevationM": round(h0, 3),
            "localSlopeDeg": round(slope, 2),
            "siteChecks": checks,
            "horizon": horizon,
            "diagnostics": {
                "uncertaintyResolutionDeg": u_res,
                "uncertaintyHeightErrorDeg": u_err,
                "heightErrorAtSiteM": sig_site,
                "unprovenAzimuths": n_unproven,
                "coarseElevationDeg": [round(float(v), 4) for v in prof_c.elevation_deg],
                "completeDistanceMaxM": float(np.nanmax(prof.complete_distance_m)),
                "demMaxHeightM": hmax,
                "demSha256": info["sha256"],
            },
        }
        p = derived_terrain_path(site.id)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(rec, indent=1) + "\n")
        results[site.id] = rec
        print(f"{site.id}: h0={h0:.1f} m slope={slope:.1f} deg horizon [{np.nanmin(e):.2f},{np.nanmax(e):.2f}] "
              f"unc={unc} (res {u_res:.3f}, err {u_err}) coverageLimited={n_cov} unproven={n_unproven}")
    return results


def main() -> None:
    build()


if __name__ == "__main__":
    main()
