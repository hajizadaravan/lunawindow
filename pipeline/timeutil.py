"""UTC helpers. Internally times are float seconds since the Unix epoch (UTC, no leap seconds in range)."""

from __future__ import annotations

import math
from datetime import datetime, timezone

_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def parse_utc(s: str) -> float:
    """Parse 'YYYY-MM-DDTHH:MM:SS[.fff]Z' into epoch seconds."""
    if not s.endswith("Z"):
        raise ValueError(f"UTC timestamp must end with 'Z': {s!r}")
    dt = datetime.fromisoformat(s[:-1] + "+00:00")
    return (dt - _EPOCH).total_seconds()


def iso_seconds(t: float) -> str:
    """Grid time -> '2027-01-01T00:00:00Z' (used for inputs / dataset time fields)."""
    if abs(t - round(t)) > 1e-9:
        raise ValueError(f"not an integer-second time: {t}")
    dt = datetime.fromtimestamp(round(t), tz=timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def iso_millis(t: float) -> str:
    """Any time -> '2027-01-01T00:00:00.000Z', rounded half-up to the nearest millisecond.

    Rounding (not truncation) is the documented convention; consumers must compare times with a
    tolerance (fixtures use toleranceHours = 1e-6 h = 3.6 ms), not as exact strings.
    """
    ms = math.floor(t * 1000.0 + 0.5)
    secs, rem = divmod(ms, 1000)
    dt = datetime.fromtimestamp(secs, tz=timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S") + f".{rem:03d}Z"


def horizons_time(t: float) -> str:
    """Epoch seconds -> Horizons START/STOP format 'YYYY-MM-DD HH:MM:SS'."""
    dt = datetime.fromtimestamp(round(t), tz=timezone.utc)
    return dt.strftime("%Y-%m-%d %H:%M:%S")


_MONTHS = {m: i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], start=1)}


def parse_horizons_cal(s: str) -> float:
    """Parse a Horizons calendar tag like '2027-Jan-01 00:10:00' or with fractional seconds."""
    s = s.strip()
    date, clock = s.split()
    y, mon, d = date.split("-")
    hh, mm, ss = clock.split(":")
    sec = float(ss)
    whole = int(sec)
    dt = datetime(int(y), _MONTHS[mon], int(d), int(hh), int(mm), whole, tzinfo=timezone.utc)
    return (dt - _EPOCH).total_seconds() + (sec - whole)
