"""LOLA polar-stereographic DEM access and projection maths.

Projection (verified from the GeoTIFF's own GeoKeys, see read_geotiff_info()):
  south polar stereographic on the 1 737 400 m sphere, natural origin latitude -90, scale 1 at the pole,
  straight vertical longitude 0, false easting/northing 0, metres.
  r = 2 R tan((90 + lat)/2),  x = r sin(lon),  y = r cos(lon)      (lon east-positive)
  Raster: PixelIsArea, upper-left corner at (x0, y0) from ModelTiepoint, pixel size from ModelPixelScale;
  column increases with x, row increases with -y. Pixel (row, col) centre = (x0 + (col+0.5) dx, y0 - (row+0.5) dy).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from . import config

R = config.REFERENCE_RADIUS_M


# ---------------------------------------------------------------- projection

def latlon_to_xy(lat_deg, lon_deg):
    lat = np.asarray(lat_deg, dtype=float)
    lon = np.radians(np.asarray(lon_deg, dtype=float))
    r = 2.0 * R * np.tan(np.radians(90.0 + lat) / 2.0)
    return r * np.sin(lon), r * np.cos(lon)


def xy_to_latlon(x, y):
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    r = np.hypot(x, y)
    lat = 2.0 * np.degrees(np.arctan(r / (2.0 * R))) - 90.0
    lon = np.degrees(np.arctan2(x, y)) % 360.0
    return lat, lon


def unit_from_latlon(lat_deg, lon_deg):
    lat = np.radians(np.asarray(lat_deg, dtype=float))
    lon = np.radians(np.asarray(lon_deg, dtype=float))
    return np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], axis=-1)


def latlon_from_unit(u):
    u = np.asarray(u, dtype=float)
    lat = np.degrees(np.arcsin(np.clip(u[..., 2], -1.0, 1.0)))
    lon = np.degrees(np.arctan2(u[..., 1], u[..., 0])) % 360.0
    return lat, lon


def xy_from_unit(u):
    """Stereographic x/y straight from a unit vector (stable near the pole)."""
    # tan(pi/4 + lat/2) = (1 + sin lat)/cos lat = cos lat/(1 - sin lat), so r = 2R cos(lat)/(1 - sin(lat)).
    # With u = (cos lat cos lon, cos lat sin lon, sin lat): x = r sin lon = s*u_y, y = r cos lon = s*u_x,
    # s = 2R/(1 - u_z). Well conditioned everywhere except the north pole.
    u = np.asarray(u, dtype=float)
    s = 2.0 * R / (1.0 - u[..., 2])
    return s * u[..., 1], s * u[..., 0]


# ---------------------------------------------------------------- raster

@dataclass
class Grid:
    data: np.ndarray        # float32 heights (m above the 1 737 400 m sphere), NaN = nodata
    x0: float               # x of the left edge of column 0
    y0: float               # y of the top edge of row 0
    dx: float
    dy: float
    name: str

    @property
    def shape(self):
        return self.data.shape

    def xy_to_pixel(self, x, y):
        """Continuous pixel coordinates (col, row) where integer + 0.5 is a pixel centre... returned as
        centre-based indices: col_c = (x - x0)/dx - 0.5 so that col_c == j at the centre of column j."""
        col = (np.asarray(x) - self.x0) / self.dx - 0.5
        row = (self.y0 - np.asarray(y)) / self.dy - 0.5
        return col, row

    def pixel_to_xy(self, col, row):
        return self.x0 + (np.asarray(col) + 0.5) * self.dx, self.y0 - (np.asarray(row) + 0.5) * self.dy

    def bilinear(self, x, y):
        """Bilinear height at projected x/y. NaN if any of the four neighbours is nodata or off-raster."""
        col, row = self.xy_to_pixel(x, y)
        col = np.asarray(col, dtype=float)
        row = np.asarray(row, dtype=float)
        h, w = self.data.shape
        j0 = np.floor(col).astype(np.int64)
        i0 = np.floor(row).astype(np.int64)
        fx = col - j0
        fy = row - i0
        inside = (j0 >= 0) & (i0 >= 0) & (j0 + 1 < w) & (i0 + 1 < h)
        j0c = np.clip(j0, 0, w - 2)
        i0c = np.clip(i0, 0, h - 2)
        d = self.data
        v00 = d[i0c, j0c]
        v01 = d[i0c, j0c + 1]
        v10 = d[i0c + 1, j0c]
        v11 = d[i0c + 1, j0c + 1]
        out = (v00 * (1 - fx) * (1 - fy) + v01 * fx * (1 - fy) + v10 * (1 - fx) * fy + v11 * fx * fy)
        return np.where(inside, out, np.nan)

    def block_mean(self, k: int) -> "Grid":
        """k x k block average (NaN if any input is NaN) — used for the resolution-sensitivity test."""
        h, w = self.data.shape
        hh, ww = h // k, w // k
        a = self.data[: hh * k, : ww * k].reshape(hh, k, ww, k).astype(np.float64).mean(axis=(1, 3))
        return Grid(a.astype(np.float32), self.x0, self.y0, self.dx * k, self.dy * k, f"{self.name} ({k}x{k} mean)")


def _enum_name(v) -> str:
    return getattr(v, "name", str(v))


def read_geotiff_info(path: Path) -> dict:
    """Extract and validate the projection/georeferencing metadata from the GeoTIFF itself."""
    import tifffile

    with tifffile.TiffFile(path) as t:
        p = t.pages[0]
        geo = t.geotiff_metadata
        gdal_md = p.tags["GDAL_METADATA"].value if "GDAL_METADATA" in p.tags else ""
        nodata = p.tags["GDAL_NODATA"].value if "GDAL_NODATA" in p.tags else None
        info = {
            "file": path.name,
            "shape": list(p.shape),
            "dtype": str(p.dtype),
            "compression": int(p.compression),
            "modelType": _enum_name(geo["GTModelTypeGeoKey"]),
            "rasterType": _enum_name(geo["GTRasterTypeGeoKey"]),
            "citation": geo.get("GTCitationGeoKey"),
            "geogCitation": geo.get("GeogCitationGeoKey"),
            "semiMajorM": float(geo["GeogSemiMajorAxisGeoKey"]),
            "semiMinorM": float(geo["GeogSemiMinorAxisGeoKey"]),
            "primeMeridian": float(geo.get("GeogPrimeMeridianLongGeoKey", 0.0)),
            "coordTrans": _enum_name(geo["ProjCoordTransGeoKey"]),
            "natOriginLat": float(geo["ProjNatOriginLatGeoKey"]),
            "scaleAtOrigin": float(geo["ProjScaleAtNatOriginGeoKey"]),
            "straightVertPoleLon": float(geo["ProjStraightVertPoleLongGeoKey"]),
            "falseEasting": float(geo["ProjFalseEastingGeoKey"]),
            "falseNorthing": float(geo["ProjFalseNorthingGeoKey"]),
            "linearUnits": _enum_name(geo["ProjLinearUnitsGeoKey"]),
            "pixelScale": [float(v) for v in geo["ModelPixelScale"]],
            "tiepoint": [float(v) for v in geo["ModelTiepoint"]],
            "gdalNodata": nodata,
            "gdalMetadataHasScaleOffset": ("scale" in gdal_md.lower() and "offset" in gdal_md.lower()),
            "gdalMetadata": gdal_md,
        }
    checks = {
        "projected": "Projected" in info["modelType"],
        "pixelIsArea": "IsArea" in info["rasterType"],
        "sphere1737400": info["semiMajorM"] == R and info["semiMinorM"] == R,
        "polarStereographic": "PolarStereographic" in info["coordTrans"],
        "southPoleOrigin": info["natOriginLat"] == -90.0,
        "unitScaleAtPole": info["scaleAtOrigin"] == 1.0,
        "centralMeridian0": info["straightVertPoleLon"] == 0.0,
        "noFalseOrigin": info["falseEasting"] == 0.0 and info["falseNorthing"] == 0.0,
        "metres": "Meter" in info["linearUnits"],
        "squarePixels": info["pixelScale"][0] == info["pixelScale"][1],
        "tiepointAtPixel00": info["tiepoint"][:3] == [0.0, 0.0, 0.0],
        "nodataNaN": str(nodata).strip().lower() == "nan",
        "noScaleOffset": not info["gdalMetadataHasScaleOffset"],
    }
    info["checks"] = checks
    bad = [k for k, v in checks.items() if not v]
    if bad:
        raise ValueError(f"DEM metadata does not match the assumed projection: {bad}")
    return info


_VERIFIED: dict[tuple[str, int, int], str] = {}


def verify_raster(path: Path) -> str:
    """Return the sha256 of a source file after checking it against config.RASTER_SHA256.

    Fails closed: a file with no pinned hash is refused, so renaming a product in config without pinning
    it cannot silently switch the check off. Every loader below calls this, so no module (terrain build,
    map render, site survey, tests) can use an unverified or partly downloaded raster.
    """
    path = Path(path)
    pinned = config.RASTER_SHA256.get(path.name)
    if pinned is None:
        raise ValueError(f"{path.name}: no pinned sha256 in config.RASTER_SHA256; refusing to use it")
    st = path.stat()
    key = (str(path.resolve()), st.st_size, st.st_mtime_ns)
    digest = _VERIFIED.get(key)
    if digest is None:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        digest = h.hexdigest()
        _VERIFIED[key] = digest
    if digest != pinned:
        raise ValueError(f"{path.name}: sha256 {digest} does not match pinned {pinned}")
    return digest


def load_grid(path: Path | None = None, level: int = 0) -> Grid:
    import tifffile

    path = path or (config.DEM_DIR / config.DEM_PRODUCT)
    verify_raster(path)
    info = read_geotiff_info(path)
    with tifffile.TiffFile(path) as t:
        page = t.pages[level]
        arr = page.asarray().astype(np.float32, copy=False)
        full_h, full_w = t.pages[0].shape[:2]
    dx = info["pixelScale"][0] * full_w / arr.shape[1]
    dy = info["pixelScale"][1] * full_h / arr.shape[0]
    return Grid(arr, info["tiepoint"][3], info["tiepoint"][4], dx, dy, f"{path.name}[level {level}]")


def load_pds_img(img: Path, lbl: Path) -> Grid:
    """Read a PDS3 LOLA polar GDR (LSB int16, SCALING_FACTOR, pixel registration) using its label."""
    verify_raster(img)
    verify_raster(lbl)
    text = lbl.read_text()

    def val(key: str) -> str:
        for line in text.splitlines():
            s = line.strip()
            if s.startswith(key) and "=" in s and s.split("=")[0].strip() == key:
                return s.split("=", 1)[1].strip()
        raise KeyError(key)

    lines = int(val("LINES"))
    samples = int(val("LINE_SAMPLES"))
    if val("SAMPLE_TYPE") != "LSB_INTEGER" or int(val("SAMPLE_BITS")) != 16:
        raise ValueError("unexpected PDS sample type")
    if img.stat().st_size != lines * samples * 2:
        raise ValueError("PDS image size does not match its label")
    scaling = float(val("SCALING_FACTOR"))
    offset_m = float(val("OFFSET").rstrip("."))
    if offset_m != R:
        raise ValueError(f"PDS reference radius {offset_m} != {R}")
    scale_m = float(val("MAP_SCALE").split()[0])
    loff = float(val("LINE_PROJECTION_OFFSET").split()[0])
    soff = float(val("SAMPLE_PROJECTION_OFFSET").split()[0])
    if float(val("CENTER_LATITUDE").split()[0]) != -90 or float(val("CENTER_LONGITUDE").split()[0]) != 0:
        raise ValueError("PDS product is not south polar stereographic about lon 0")
    dn = np.fromfile(img, dtype="<i2").reshape(lines, samples)
    h = dn.astype(np.float32) * scaling
    # LOLA PDS polar convention: x = (SAMPLE - SAMPLE_PROJECTION_OFFSET - 1) * MAP_SCALE,
    # y = (1 - LINE + LINE_PROJECTION_OFFSET) * MAP_SCALE, SAMPLE/LINE 1-based at pixel centres. With 0-based
    # j = SAMPLE-1, i = LINE-1: centre x = (j - soff)*scale, centre y = (loff - i)*scale, hence the left edge of
    # column 0 is -(soff + 0.5)*scale and the top edge of row 0 is (loff + 0.5)*scale. Checked empirically
    # against the PGDA GeoTIFF in pipeline/tests/test_dem_real.py.
    return Grid(h, -(soff + 0.5) * scale_m, (loff + 0.5) * scale_m, scale_m, scale_m, img.name)


def write_dem_info(info: dict, sha256: str, retrieved: str) -> Path:
    out = config.REPO_ROOT / "data" / "derived" / "dem_info.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    d = dict(info)
    d["sha256"] = sha256
    d["retrievedAtUtc"] = retrieved
    d["url"] = config.DEM_URL
    out.write_text(json.dumps(d, indent=2) + "\n")
    return out
