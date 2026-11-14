"""JPL Horizons client: build requests, serialise + cache raw responses, parse observer tables.

Raw responses are cached under data/raw/horizons/<label>__<hash>.txt with a .meta.json sidecar.
A cached response is never re-fetched. Live requests are strictly sequential with a pause between them.
"""

from __future__ import annotations

import hashlib
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from . import config
from .timeutil import parse_horizons_cal

PAUSE_SECONDS = 2.0
USER_AGENT = "lunawindow-pipeline/0.1 (python urllib)"
_last_request_monotonic = 0.0


def _q(v: str) -> str:
    return f"'{v}'"


def observer_params(command: str, lon_east_deg: float, lat_deg: float, alt_m: float, start: str, stop: str,
                    step: str = "10 m", quantities: str = "4,13,20") -> dict[str, str]:
    """Exact topocentric observer query on the Moon (verified request shape, see task brief)."""
    return {
        "format": "text",
        "COMMAND": _q(command),
        "OBJ_DATA": _q("NO"),
        "MAKE_EPHEM": _q("YES"),
        "EPHEM_TYPE": _q("OBSERVER"),
        "CENTER": _q("coord@301"),
        "COORD_TYPE": _q("GEODETIC"),
        "SITE_COORD": _q(f"{lon_east_deg:.6f},{lat_deg:.6f},{alt_m / 1000.0:.6f}"),
        "START_TIME": _q(start),
        "STOP_TIME": _q(stop),
        "STEP_SIZE": _q(step),
        "QUANTITIES": _q(quantities),
        "CSV_FORMAT": _q("YES"),
        "ANG_FORMAT": _q("DEG"),
        "TIME_DIGITS": _q("SECONDS"),
    }


def _hash(params: dict[str, str]) -> str:
    canon = json.dumps(params, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canon.encode()).hexdigest()[:16]


def cache_path(label: str, params: dict[str, str]) -> Path:
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "-", label)
    return config.RAW_HORIZONS_DIR / f"{safe}__{_hash(params)}.txt"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


@dataclass
class Fetched:
    path: Path
    meta: dict
    text: str


def fetch(label: str, params: dict[str, str], offline: bool = False) -> Fetched:
    """Return the cached response, fetching (once, serialised) only if no cache exists."""
    global _last_request_monotonic
    path = cache_path(label, params)
    meta_path = path.with_suffix(".meta.json")
    if path.exists() and meta_path.exists():
        meta = json.loads(meta_path.read_text())
        if meta.get("params") != params:
            raise ValueError(f"cache metadata params do not match the request for {path.name}")
        if sha256_file(path) != meta.get("sha256"):
            raise ValueError(f"cached Horizons response {path.name} does not match its recorded sha256")
        return Fetched(path, meta, path.read_text())
    if offline:
        raise FileNotFoundError(f"no cached Horizons response for {label} ({path.name}) and offline=True")
    url = config.HORIZONS_API + "?" + urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
    last_err: Exception | None = None
    for attempt in range(4):
        wait = PAUSE_SECONDS - (time.monotonic() - _last_request_monotonic)
        if wait > 0:
            time.sleep(wait)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=300) as resp:
                body = resp.read(64 * 1024 * 1024).decode("utf-8")
            _last_request_monotonic = time.monotonic()
            if "$$SOE" not in body or "$$EOE" not in body:
                raise RuntimeError(f"Horizons returned no ephemeris table for {label}:\n{body[:2000]}")
            break
        except Exception as e:  # transient network errors are retried; table-less replies and 4xx are not
            _last_request_monotonic = time.monotonic()
            last_err = e
            if isinstance(e, RuntimeError):
                raise
            if isinstance(e, urllib.error.HTTPError) and 400 <= e.code < 500:
                raise RuntimeError(f"Horizons rejected the request for {label}: HTTP {e.code}") from e
            if attempt < 3:
                time.sleep(5 * (attempt + 1))
    else:
        raise RuntimeError(f"Horizons request failed for {label}: {last_err}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body)
    meta = {
        "label": label,
        "url": url,
        "params": params,
        "retrievedAtUtc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sha256": sha256_file(path),
    }
    meta_path.write_text(json.dumps(meta, indent=2) + "\n")
    return Fetched(path, meta, body)


# ---------------------------------------------------------------- parsing

@dataclass
class ObserverTable:
    header: dict[str, str]
    columns: list[str]
    times: list[float]                  # epoch seconds UTC
    rows: list[list[str]]               # raw CSV fields (stripped), excluding the time tag


def _parse_header(text: str) -> dict[str, str]:
    head = text.split("$$SOE", 1)[0]
    out: dict[str, str] = {}
    for line in head.splitlines():
        m = re.match(r"^([A-Za-z][A-Za-z0-9 ./()-]*?)\s*:\s(.*)$", line)
        if m and not line.startswith(" "):
            out.setdefault(m.group(1).strip(), m.group(2).strip())
    return out


def parse_table(text: str) -> ObserverTable:
    header = _parse_header(text)
    pre, rest = text.split("$$SOE", 1)
    body = rest.split("$$EOE", 1)[0]
    # Column header is the last line before the '****' line that precedes $$SOE.
    hdr_lines = [ln for ln in pre.splitlines() if ln.strip() and not ln.startswith("****")]
    columns = [c.strip() for c in hdr_lines[-1].split(",")]
    if columns and columns[-1] == "":      # trailing comma in Horizons CSV header
        columns = columns[:-1]
    times: list[float] = []
    rows: list[list[str]] = []
    for ln in body.splitlines():
        if not ln.strip():
            continue
        fields = [f.strip() for f in ln.split(",")]
        if fields and fields[-1] == "":
            fields = fields[:-1]
        times.append(parse_horizons_cal(fields[0]))
        rows.append(fields[1:])
    return ObserverTable(header, columns, times, rows)


def _num(s: str) -> float | None:
    s = s.strip()
    if s in ("", "n.a.", "n.a"):
        return None
    return float(s)


@dataclass
class AzElSeries:
    times: list[float]
    az: list[float | None]
    el: list[float | None]
    ang_diam_arcsec: list[float | None]
    delta_au: list[float | None]
    header: dict[str, str]


def parse_azel(text: str) -> AzElSeries:
    """Parse a QUANTITIES='4,13,20' CSV table: Date, solar, flag, Azi, Elev, Ang-diam, delta, deldot."""
    t = parse_table(text)
    cols = t.columns
    expect = ["Date__(UT)__HR:MN:SS", "", "", "Azi_(a-app)", "Elev_(a-app)", "Ang-diam", "delta", "deldot"]
    if cols != expect:
        raise ValueError(f"unexpected Horizons columns: {cols}")
    az, el, ad, de = [], [], [], []
    for r in t.rows:
        # r[0] solar flag, r[1] interferer/RTS flag, r[2] az, r[3] el, r[4] ang-diam, r[5] delta, r[6] deldot
        if len(r) != 7:
            raise ValueError(f"unexpected row width {len(r)}: {r}")
        az.append(_num(r[2]))
        el.append(_num(r[3]))
        ad.append(_num(r[4]))
        de.append(_num(r[5]))
    return AzElSeries(t.times, az, el, ad, de, t.header)


def check_observer_header(header: dict[str, str], lon_east_deg: float, lat_deg: float, alt_m: float,
                          target_name_prefix: str) -> None:
    """Fail loudly if the response is not in the frame / settings the contract assumes."""
    pole = header.get("Center pole/equ", "")
    if not pole.startswith("MEAN_ME"):
        raise ValueError(f"observer frame is not MEAN_ME: {pole!r}")
    if not header.get("Atmos refraction", "").startswith("NO (AIRLESS)"):
        raise ValueError(f"refraction not airless: {header.get('Atmos refraction')!r}")
    radii = header.get("Center radii", "")
    if not radii.startswith("1737.4, 1737.4, 1737.4 km"):
        raise ValueError(f"unexpected centre radii: {radii!r}")
    if not header.get("Target body name", "").startswith(target_name_prefix):
        raise ValueError(f"unexpected target: {header.get('Target body name')!r}")
    geo = header.get("Center geodetic", "").split("{")[0]
    lon, lat, alt_km = (float(x) for x in geo.split(","))
    if abs(lon - lon_east_deg) > 1e-6 or abs(lat - lat_deg) > 1e-6 or abs(alt_km * 1000 - alt_m) > 1e-3:
        raise ValueError(f"Horizons echoed site {geo!r}, requested {lon_east_deg},{lat_deg},{alt_m} m")
