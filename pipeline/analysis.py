"""Reference implementation of docs/data-contract.md section 4 (visibility analysis).

Conventions that the contract leaves implicit and that this implementation fixes (mirrored in the
golden fixture, so the TypeScript port must match them):

* Times are handled as float seconds; output timestamps are ISO-8601 rounded to the nearest millisecond
  ('...T00:00:00.000Z'), including windowStartUtc / windowEndUtc. durationHours is computed from the
  unrounded float times.
* Zero-length pieces are dropped before merging. They only arise from an exact-zero margin next to a
  state change (e.g. margins +1, 0, +1 yield no blocked interval, because the blocked piece has zero
  duration); a run of two or more zero-margin samples does produce a blocked interval.
* Near-horizon flags use only samples inside the window [T0, T1] (inclusive); a null margin is never
  flagged and breaks a run. A single flagged sample gives a zero-length span.
* Ties for the longest interruption: strict '>' when scanning in time order, so the earliest wins.
"""

from __future__ import annotations

import math
from typing import Any

from .timeutil import iso_millis, parse_utc

GENERATED_BY = "pipeline.analysis"

# Contract section 4: "longer than the limit" means duration > limit + 1e-9 h, so floating-point noise
# cannot flip a verdict when a gap equals the limit. Mirrors web/src/analysis/visibility.ts.
LIMIT_EPSILON_HOURS = 1e-9


def horizon_lookup(horizon: dict[str, Any]):
    """Return H(az) for a geometric or terrain horizon dict (contract shapes)."""
    if horizon["kind"] == "geometric":
        h = float(horizon["elevationDeg"])
        return lambda az: h
    if horizon["kind"] == "terrain":
        elev = [float(x) for x in horizon["elevationDeg"]]
        step = float(horizon["azimuthStepDeg"])
        n = len(elev)
        if abs(n * step - 360.0) > 1e-9:
            raise ValueError("terrain horizon: length * azimuthStepDeg must equal 360")

        def lookup(az: float) -> float:
            x = (az % 360.0) / step
            k = int(math.floor(x))
            f = x - k
            k %= n
            return elev[k] * (1.0 - f) + elev[(k + 1) % n] * f

        return lookup
    raise ValueError(f"unknown horizon kind {horizon['kind']!r}")


def _state(m: float | None) -> str:
    if m is None:
        return "unknown"
    return "visible" if m > 0 else "blocked"


def analyze(time: dict[str, Any], track: dict[str, Any], horizon: dict[str, Any], body: str,
            window_start_utc: str, duration_hours: float, limit_hours: float | None = None) -> dict[str, Any]:
    start = parse_utc(time["startUtc"])
    step = float(time["stepSeconds"])
    count = int(time["count"])
    az = track["azDeg"]
    el = track["elDeg"]
    if len(az) != count or len(el) != count:
        raise ValueError("track length does not match time.count")

    t0 = parse_utc(window_start_utc)
    off = (t0 - start) / step
    i0 = int(round(off))
    if abs(off - i0) > 1e-9 or i0 < 0:
        raise ValueError("window start must be a grid time inside the range")
    nsteps_f = duration_hours * 3600.0 / step
    nsteps = int(round(nsteps_f))
    if nsteps <= 0 or abs(nsteps_f - nsteps) > 1e-9:
        raise ValueError("duration must be a positive whole number of steps")
    i1 = i0 + nsteps
    if i1 > count - 1:
        raise ValueError("window end outside the supported range")
    t1 = start + i1 * step

    H = horizon_lookup(horizon)

    def margin(i: int) -> float | None:
        a, e = az[i], el[i]
        if a is None or e is None:
            return None
        return float(e) - H(float(a))

    ms = [margin(i) for i in range(i0, i1 + 1)]
    ts = [start + i * step for i in range(i0, i1 + 1)]

    # Steps 3-4: per-segment pieces.
    pieces: list[tuple[str, float, float]] = []
    for k in range(nsteps):
        ma, mb = ms[k], ms[k + 1]
        sa, sb = _state(ma), _state(mb)
        ta, tb = ts[k], ts[k + 1]
        if sa == "unknown" or sb == "unknown":
            pieces.append(("unknown", ta, tb))
        elif sa == sb:
            pieces.append((sa, ta, tb))
        else:
            tx = ta + step * ma / (ma - mb)
            pieces.append((sa, ta, tx))
            pieces.append((sb, tx, tb))

    # Step 5: drop zero-length pieces, merge equal neighbours.
    # Pieces are contiguous in time, so after dropping zero-length ones neighbours always abut.
    compact: list[list[Any]] = []
    for st, a, b in pieces:
        if b - a <= 0:
            continue
        if compact and compact[-1][0] == st:
            compact[-1][2] = b
        else:
            compact.append([st, a, b])
    if not (compact and compact[0][1] == t0 and compact[-1][2] == t1):
        raise RuntimeError("internal error: intervals do not cover the window")

    intervals: list[dict[str, Any]] = []
    for idx, (st, a, b) in enumerate(compact):
        adj = (idx > 0 and compact[idx - 1][0] == "unknown") or (
            idx + 1 < len(compact) and compact[idx + 1][0] == "unknown")
        intervals.append({
            "state": st,
            "startUtc": iso_millis(a),
            "endUtc": iso_millis(b),
            "durationHours": (b - a) / 3600.0,
            "touchesWindowStart": a == t0,
            "touchesWindowEnd": b == t1,
            "adjacentToUnknown": adj,
        })

    # Step 6: near-horizon spans.
    ang = track["angularRadiusDeg"]
    band = float(ang["max"]) + float(horizon["uncertaintyDeg"])
    spans: list[dict[str, str]] = []
    run_start: float | None = None
    run_last: float | None = None
    for m, t in zip(ms, ts):
        flagged = m is not None and abs(m) < band
        if flagged:
            if run_start is None:
                run_start = t
            run_last = t
        elif run_start is not None:
            spans.append({"startUtc": iso_millis(run_start), "endUtc": iso_millis(run_last)})
            run_start = run_last = None
    if run_start is not None:
        spans.append({"startUtc": iso_millis(run_start), "endUtc": iso_millis(run_last)})

    def total(state: str) -> float:
        return sum(iv["durationHours"] for iv in intervals if iv["state"] == state)

    blocked = [iv for iv in intervals if iv["state"] == "blocked"]
    longest = None
    for iv in blocked:
        if longest is None or iv["durationHours"] > longest["durationHours"]:
            longest = iv
    longest_out = None
    if longest is not None:
        longest_out = dict(longest)
        longest_out["boundaryTruncated"] = longest["touchesWindowStart"] or longest["touchesWindowEnd"]

    unknown_h = total("unknown")
    limit = None
    if limit_hours is not None:
        exceeding = [iv for iv in blocked if iv["durationHours"] > limit_hours + LIMIT_EPSILON_HOURS]
        if exceeding:
            status = "exceeded"
        elif any(iv["touchesWindowStart"] or iv["touchesWindowEnd"] for iv in blocked):
            status = "not-exceeded-truncated"
        elif unknown_h > 0:
            status = "indeterminate-missing-data"
        else:
            status = "within"
        limit = {"limitHours": limit_hours, "status": status, "exceedingIntervals": exceeding}

    return {
        "body": body,
        "horizonId": horizon["id"],
        "horizonKind": horizon["kind"],
        "windowStartUtc": iso_millis(t0),
        "windowEndUtc": iso_millis(t1),
        "stepSeconds": int(step) if step == int(step) else step,
        "intervals": intervals,
        "nearHorizonSpans": spans,
        "nearHorizonBandDeg": band,
        "visibleHours": total("visible"),
        "blockedHours": total("blocked"),
        "unknownHours": unknown_h,
        "interruptionCount": len(blocked),
        "longestInterruption": longest_out,
        "limit": limit,
    }
