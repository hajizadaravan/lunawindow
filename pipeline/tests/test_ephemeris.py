"""Parse fidelity of exported ephemeris vs the cached raw Horizons responses, grid integrity, cross-check."""

import json

import numpy as np
import pytest

from pipeline import config, crosscheck, horizons
from pipeline.timeutil import parse_utc

MANIFEST = json.loads((config.WEB_DATA_DIR / "manifest.json").read_text())


def _raw_rows(path):
    text = (config.REPO_ROOT / path).read_text()
    body = text.split("$$SOE", 1)[1].split("$$EOE", 1)[0]
    rows = [ln.split(",") for ln in body.splitlines() if ln.strip()]
    return [(r[0].strip(), r[3].strip(), r[4].strip(), r[5].strip()) for r in rows]


@pytest.mark.parametrize("entry", MANIFEST["sites"], ids=lambda e: e["id"])
def test_export_matches_raw_horizons(entry):
    ds = json.loads((config.WEB_DATA_DIR / entry["file"]).read_text())
    n = ds["time"]["count"]
    assert n == 12961 and ds["time"]["stepSeconds"] == 600 and ds["time"]["startUtc"] == "2027-01-01T00:00:00Z"
    for body, cmd in (("sun", "10"), ("earth", "399")):
        tr = ds["ephemeris"]["bodies"][body]
        assert tr["horizonsCommand"] == cmd
        raw = config.REPO_ROOT / tr["rawFile"]
        assert horizons.sha256_file(raw) == tr["rawSha256"]
        rows = _raw_rows(tr["rawFile"])
        assert len(rows) == n == len(tr["azDeg"]) == len(tr["elDeg"])
        for i, (date, az, el, diam) in enumerate(rows):
            assert tr["azDeg"][i] == round(float(az), 4)
            assert tr["elDeg"][i] == round(float(el), 4)
        diams = np.array([float(r[3]) for r in rows]) / 7200.0
        assert tr["angularRadiusDeg"]["max"] == pytest.approx(diams.max(), abs=1e-6)
        assert tr["angularRadiusDeg"]["min"] == pytest.approx(diams.min(), abs=1e-6)
        # Raw Horizons header confirms frame/settings and the site actually queried.
        s = horizons.parse_azel(raw.read_text())
        horizons.check_observer_header(s.header, ds["site"]["lonEastDeg"], ds["site"]["latDeg"],
                                       ds["site"]["observerAltitudeM"], {"sun": "Sun", "earth": "Earth"}[body])
        # UTC grid: no gaps, no duplicates, exact step.
        t = np.array(s.times)
        assert t[0] == parse_utc(config.RANGE_START_UTC) and t[-1] == parse_utc(config.RANGE_END_UTC)
        assert np.all(np.diff(t) == 600)
    site = ds["site"]
    assert site["observerAltitudeM"] == pytest.approx((site["surfaceElevationM"] or 0) + site["observerHeightM"],
                                                     abs=1e-9)
    q = ds["ephemeris"]["query"]
    assert "COMMAND" not in q
    lon, lat, alt_km = (float(v) for v in q["SITE_COORD"].strip("'").split(","))
    assert (lon, lat) == (site["lonEastDeg"], site["latDeg"])
    assert alt_km * 1000 == pytest.approx(site["observerAltitudeM"], abs=5e-4)


def test_no_nan_or_sentinels_in_exports():
    for entry in MANIFEST["sites"]:
        text = (config.WEB_DATA_DIR / entry["file"]).read_text()

        def reject(c):
            raise AssertionError(f"non-JSON number {c}")

        ds = json.loads(text, parse_constant=reject)
        for body in ("sun", "earth"):
            for v in ds["ephemeris"]["bodies"][body]["elDeg"]:
                assert v is None or -90 <= v <= 90


def test_independent_crosscheck_residuals():
    out = crosscheck.run(offline=True)
    for site_id, res in out["sites"].items():
        e, s = res["earth"], res["sun"]
        # Agreement to < 0.01 deg proves azimuth sense, longitude sign, frame and units ...
        assert e["maxSeparationDeg"] < 0.01, site_id
        assert s["maxSeparationDeg"] < 0.01, site_id
        # ... and the deliberate-mistake controls are far worse (parallax matters for Earth).
        assert e["controlNoParallaxMaxSeparationDeg"] > 0.2
        assert e["controlWestLongitudeMaxSeparationDeg"] > 1 and s["controlWestLongitudeMaxSeparationDeg"] > 1
        assert e["controlCounterClockwiseAzimuthMaxSeparationDeg"] > 1


def test_horizons_parser_handles_na_and_trailing_comma():
    text = ("Center pole/equ : MEAN_ME (high precision)        {East-longitude positive}\n"
            "*****\n Date__(UT)__HR:MN:SS, , ,Azi_(a-app), Elev_(a-app),  Ang-diam,  delta,  deldot,\n*****\n"
            "$$SOE\n 2027-Jan-01 00:00:00,*, ,  40.4, 1.4, n.a., 0.98, -0.9,\n"
            " 2027-Jan-01 00:10:00, ,r,  n.a., -0.1, 1952.2, 0.98, -0.9,\n$$EOE\n")
    s = horizons.parse_azel(text)
    assert s.az == [40.4, None] and s.el == [1.4, -0.1] and s.ang_diam_arcsec == [None, 1952.2]
    assert s.times[1] - s.times[0] == 600
