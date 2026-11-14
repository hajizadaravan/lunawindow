"""Shape and wording checks of the generated web data against docs/data-contract.md section 3."""

import json
import re

import numpy as np
from PIL import Image

from pipeline import config, dem, timestep

D = config.WEB_DATA_DIR
MANIFEST = json.loads((D / "manifest.json").read_text())


def test_manifest_shape():
    m = MANIFEST
    assert set(m) == {"contractVersion", "synthetic", "generatedAtUtc", "generator", "supportedRange", "defaults",
                      "sites", "map", "sources", "disclaimers"}
    assert m["contractVersion"] == "1.0.0" and m["synthetic"] is False
    assert m["supportedRange"] == {"startUtc": "2027-01-01T00:00:00Z", "endUtc": "2027-04-01T00:00:00Z",
                                   "stepSeconds": 600}
    assert m["defaults"]["durationHours"] == 168 and m["defaults"]["shiftHours"] == 24
    assert m["defaults"]["siteId"] in {s["id"] for s in m["sites"]}
    assert len(m["sites"]) == 3
    ids = {s["id"] for s in m["sources"]}
    for s in m["sites"]:
        assert set(s) == {"id", "name", "locationHint", "latDeg", "lonEastDeg", "file", "hasTerrainHorizon"}
        assert re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", s["id"])
        assert 0 <= s["lonEastDeg"] < 360 and -90 <= s["latDeg"] < -80
        assert (D / s["file"]).exists()
    for src in m["sources"]:
        assert set(src) == {"id", "title", "url", "usedFor", "retrievedAtUtc", "citation", "sha256"}
    if m["map"]:
        assert m["map"]["sourceId"] in ids


def test_site_shape_and_terrain_arrays():
    for s in MANIFEST["sites"]:
        ds = json.loads((D / s["file"]).read_text())
        assert set(ds) == {"contractVersion", "synthetic", "site", "time", "ephemeris", "horizons"}
        site = ds["site"]
        assert site["id"] == s["id"] and site["referenceRadiusM"] == 1737400
        assert site["latDeg"] == s["latDeg"] and site["lonEastDeg"] == s["lonEastDeg"]
        g = ds["horizons"]["geometric"]
        assert g["kind"] == "geometric" and g["id"] == "geometric-reference" and g["elevationDeg"] == 0
        assert g["uncertaintyDeg"] == 0
        t = ds["horizons"]["terrain"]
        assert (t is not None) == s["hasTerrainHorizon"]
        if t:
            n = len(t["elevationDeg"])
            assert n * t["azimuthStepDeg"] == 360
            assert len(t["distanceM"]) == len(t["coverageLimited"]) == n
            assert all(isinstance(v, bool) for v in t["coverageLimited"])
            assert all(-90 < v < 90 for v in t["elevationDeg"])
            assert t["uncertaintyDeg"] > 0 and t["dem"]["heightReference"] == "metres above 1737400 m sphere"
            assert site["surfaceElevationM"] is not None
            assert abs(site["observerAltitudeM"] - site["surfaceElevationM"] - 2.0) < 1e-9
            assert t["dem"]["sourceId"] in {src["id"] for src in MANIFEST["sources"]}


def test_wording_never_claims_selection():
    bad = re.compile(r"\b(best|optimal|recommended|approved|selected)\b", re.I)
    for s in MANIFEST["sites"]:
        ds = json.loads((D / s["file"]).read_text())
        for text in (s["name"], s["locationHint"], ds["site"]["description"]):
            # Allowed only in explicit negations ("not selected, approved or recommended").
            stripped = re.sub(r"not (a NASA landing site; not )?(selected|approved|recommended)"
                              r"(, (approved|selected))?( or (recommended|selected|approved))?", "", text, flags=re.I)
            assert not bad.search(stripped), text
        assert "Not a NASA landing site" in ds["site"]["description"]


def test_map_extents_are_exact_and_place_shackleton_correctly():
    m = MANIFEST["map"]
    if m is None:
        return
    img = Image.open(D / m["image"])
    assert img.size == (m["widthPx"], m["heightPx"])
    assert (D / m["image"]).stat().st_size < 1_500_000
    cell_x = (m["xMaxM"] - m["xMinM"]) / m["widthPx"]
    cell_y = (m["yMaxM"] - m["yMinM"]) / m["heightPx"]
    assert cell_x == cell_y and cell_x % 40 == 0
    for s in MANIFEST["sites"]:
        x, y = dem.latlon_to_xy(s["latDeg"], s["lonEastDeg"])
        col = (x - m["xMinM"]) / (m["xMaxM"] - m["xMinM"]) * m["widthPx"]
        row = (m["yMaxM"] - y) / (m["yMaxM"] - m["yMinM"]) * m["heightPx"]
        assert 0 < col < m["widthPx"] and 0 < row < m["heightPx"]
    # Shackleton's dark-shaded bowl interior sits where the contract formula puts the crater centre:
    # the hillshade is darker on the upper-left inner wall (facing away from the light) than on the lower-right.
    a = np.asarray(img, float)
    x, y = dem.latlon_to_xy(-89.67, 129.8)
    col = int((x - m["xMinM"]) / cell_x)
    row = int((m["yMaxM"] - y) / cell_y)
    k = int(6000 / cell_x)
    ul = a[row - k:row - k // 2, col - k:col - k // 2].mean()
    lr = a[row + k // 2:row + k, col + k // 2:col + k].mean()
    assert ul + 20 < lr


def test_timestep_sensitivity_cached_result():
    out = timestep.run(config.SITES[0].id, offline=True)
    assert out["maxTransitionDiffSeconds"] < 60
    for b in out["bodies"].values():
        for h in b["horizons"].values():
            assert h["countMismatch"] == 0
