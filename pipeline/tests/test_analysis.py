"""Reference analysis: golden fixture reproduction plus targeted semantics checks."""

import json

import pytest

from pipeline import config, golden
from pipeline.analysis import analyze

GOLDEN = config.FIXTURES_DIR / "analysis-golden.json"
GEO = golden.GEO
T = {"startUtc": "2027-01-01T00:00:00Z", "stepSeconds": 3600, "count": 7, "scale": "UTC"}
ANG = {"min": 0.1, "mean": 0.1, "max": 0.1}


def run(el, az=None, limit=None, window="2027-01-01T00:00:00Z", dur=6.0, horizon=GEO, time=T):
    az = az or [0.0] * len(el)
    return analyze(time, {"azDeg": az, "elDeg": el, "angularRadiusDeg": ANG}, horizon, "sun", window, dur, limit)


def _load_site(rel):
    return json.loads((config.REPO_ROOT / rel).read_text())


def _resolve(case):
    inp = case["input"]
    if inp["kind"] == "inline":
        return inp["time"], inp["track"], inp["horizon"]
    ds = _load_site(inp["siteFile"])
    hz = ds["horizons"]["geometric"] if inp["horizonId"] == "geometric-reference" else ds["horizons"]["terrain"]
    return ds["time"], ds["ephemeris"]["bodies"][case["body"]], hz


def _close(a, b, tol):
    if isinstance(a, dict):
        assert a.keys() == b.keys()
        for k in a:
            _close(a[k], b[k], tol)
    elif isinstance(a, list):
        assert len(a) == len(b)
        for x, y in zip(a, b):
            _close(x, y, tol)
    elif isinstance(a, float) or isinstance(b, float):
        assert abs(a - b) <= tol, (a, b)
    else:
        assert a == b


def test_golden_file_is_reproduced_exactly():
    g = json.loads(GOLDEN.read_text())
    assert g["contractVersion"] == "1.0.0" and g["toleranceHours"] == 1e-6
    names = [c["name"] for c in g["cases"]]
    assert len(names) == len(set(names))
    for case in g["cases"]:
        time, track, hz = _resolve(case)
        got = analyze(time, track, hz, case["body"], case["windowStartUtc"], case["durationHours"],
                      case["limitHours"])
        _close(got, case["expected"], 1e-9)


def test_required_inline_cases_present():
    g = json.loads(GOLDEN.read_text())
    names = " | ".join(c["name"] for c in g["cases"] if c["input"]["kind"] == "inline")
    for needle in ["always visible", "always blocked", "interior gap", "touching window start",
                   "touching window end", "missing sample splits", "wrap-around", "exact-zero",
                   "limit exactly equal", "shifted +24 h"]:
        assert needle in names, needle


def test_required_site_cases_present():
    g = json.loads(GOLDEN.read_text())
    have = {(c["body"], c["input"]["horizonId"]) for c in g["cases"] if c["input"]["kind"] == "site"}
    need = {("sun", "geometric-reference"), ("earth", "geometric-reference")}
    if any(json.loads((config.WEB_DATA_DIR / s["file"]).read_text())["horizons"]["terrain"]
           for s in json.loads((config.WEB_DATA_DIR / "manifest.json").read_text())["sites"]):
        need |= {("sun", "terrain-lola"), ("earth", "terrain-lola")}
    assert need <= have


def test_interval_coverage_is_exact_and_alternating():
    g = json.loads(GOLDEN.read_text())
    for case in g["cases"]:
        e = case["expected"]
        iv = e["intervals"]
        assert iv[0]["startUtc"] == e["windowStartUtc"] and iv[-1]["endUtc"] == e["windowEndUtc"]
        for a, b in zip(iv, iv[1:]):
            assert a["endUtc"] == b["startUtc"] and a["state"] != b["state"]
        tot = e["visibleHours"] + e["blockedHours"] + e["unknownHours"]
        assert tot == pytest.approx(case["durationHours"], abs=1e-9)


def test_strict_limit_semantics():
    el = [1.0, -1.0, -1.0, -1.0, 1.0, 1.0, 1.0]   # blocked 0.5 -> 3.5 h = 3 h
    assert run(el, limit=3.0)["limit"]["status"] == "within"
    r = run(el, limit=2.999999)
    assert r["limit"]["status"] == "exceeded" and len(r["limit"]["exceedingIntervals"]) == 1
    assert run(el)["limit"] is None


def test_truncated_gap_status_and_flag():
    r = run([-1.0, -1.0, 1.0, 1.0, 1.0, 1.0, 1.0], limit=5.0)
    assert r["limit"]["status"] == "not-exceeded-truncated"
    assert r["longestInterruption"]["boundaryTruncated"] is True
    assert r["longestInterruption"]["durationHours"] == pytest.approx(1.5)


def test_missing_data_status_and_adjacency():
    r = run([1.0, 1.0, None, 1.0, 1.0, -1.0, 1.0], limit=5.0)
    assert r["unknownHours"] == pytest.approx(2.0)
    assert r["limit"]["status"] == "indeterminate-missing-data"
    assert [i["state"] for i in r["intervals"]] == ["visible", "unknown", "visible", "blocked", "visible"]
    assert r["intervals"][0]["adjacentToUnknown"] and r["intervals"][2]["adjacentToUnknown"]
    assert not r["intervals"][3]["adjacentToUnknown"]


def test_exceeded_beats_truncated_and_missing():
    r = run([-1.0, 1.0, None, 1.0, -1.0, -1.0, -1.0], limit=1.0)
    assert r["limit"]["status"] == "exceeded"


def test_shift_24h_changes_window_only():
    time = dict(T, count=49)
    el = [1.0] * 30 + [-1.0] * 5 + [1.0] * 14
    a = run(el, time=time, dur=24.0)
    b = run(el, time=time, dur=24.0, window="2027-01-02T00:00:00Z")
    assert a["interruptionCount"] == 0 and b["interruptionCount"] == 1
    assert b["windowStartUtc"] == "2027-01-02T00:00:00.000Z" and b["windowEndUtc"] == "2027-01-03T00:00:00.000Z"
    assert b["longestInterruption"]["durationHours"] == pytest.approx(5.0)


def test_tie_earliest_wins():
    r = run([1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 1.0])
    assert r["interruptionCount"] == 2
    assert r["longestInterruption"]["startUtc"] == "2027-01-01T00:30:00.000Z"


def test_window_validation():
    with pytest.raises(ValueError):
        run([1.0] * 7, window="2027-01-01T00:30:00Z")      # not a grid time
    with pytest.raises(ValueError):
        run([1.0] * 7, dur=7.0)                            # beyond range
    with pytest.raises(ValueError):
        run([1.0] * 7, dur=0.5)                            # not whole steps


def test_near_horizon_band_uses_angular_radius_plus_uncertainty():
    hz = {"kind": "terrain", "id": "terrain-lola", "azimuthStepDeg": 180.0, "elevationDeg": [0.0, 0.0],
          "uncertaintyDeg": 0.2}
    r = run([1.0, 0.29, 0.31, -0.25, 1.0, 1.0, 1.0], horizon=hz)
    assert r["nearHorizonBandDeg"] == pytest.approx(0.3)
    assert r["nearHorizonSpans"] == [
        {"startUtc": "2027-01-01T01:00:00.000Z", "endUtc": "2027-01-01T01:00:00.000Z"},
        {"startUtc": "2027-01-01T03:00:00.000Z", "endUtc": "2027-01-01T03:00:00.000Z"}]
