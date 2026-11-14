"""Fixed decisions shared by every pipeline stage (see docs/data-contract.md and docs/data-pipeline.md)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
RAW_HORIZONS_DIR = REPO_ROOT / "data" / "raw" / "horizons"
DEM_DIR = REPO_ROOT / "data" / "dem"
WEB_DATA_DIR = REPO_ROOT / "web" / "public" / "data"
FIXTURES_DIR = REPO_ROOT / "fixtures"

CONTRACT_VERSION = "1.0.0"
REFERENCE_RADIUS_M = 1737400.0

# Supported analysis range: inclusive, 10-minute grid -> 12 961 samples.
RANGE_START_UTC = "2027-01-01T00:00:00Z"
RANGE_END_UTC = "2027-04-01T00:00:00Z"
STEP_SECONDS = 600

OBSERVER_HEIGHT_M = 2.0
DEFAULT_DURATION_HOURS = 168
DEFAULT_SHIFT_HOURS = 24

HORIZONS_API = "https://ssd.jpl.nasa.gov/api/horizons.api"
BODY_COMMANDS = {"sun": "10", "earth": "399"}

# LOLA polar DEM actually used (Barker et al. 2023, PGDA product 90).
DEM_PRODUCT = "LDEM_80S_40MPP_ADJ.TIF"
DEM_URL = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_40MPP_ADJ.TIF"
# Coarser sibling used only for the resolution-sensitivity estimate of the horizon uncertainty.
DEM_COARSE_PRODUCT = "LDEM_80S_80MPP_ADJ.TIF"
DEM_COARSE_URL = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF"
DEM_ERR_PRODUCT = "LDEM_80S_80MPP_ADJ_ERR.TIF"
DEM_ERR_URL = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ_ERR.TIF"
DEM_PRODUCT_PAGE = "https://pgda.gsfc.nasa.gov/products/90"
PDS_GDR_PRODUCT = "LDEM_75S_240M.IMG"
PDS_GDR_URL = "https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/LDEM_75S_240M.IMG"
PDS_GDR_LABEL = "LDEM_75S_240M.LBL"

# sha256 of the source files as downloaded for this build. pipeline.dem.verify_raster checks these on every
# load and refuses any file that has no entry here.
RASTER_SHA256 = {
    DEM_PRODUCT: "b7f3567bfa405dbcb42f867f6cd3c9932ca9752b4363ce1eef835f9115c1dd76",
    PDS_GDR_PRODUCT: "d031efe2611b17dfbf3c158f5e15dc04cd5719349dcbf6384bb21fd97697c490",
    DEM_ERR_PRODUCT: "e89306914bb209143f61ba66d341703d75221339424b774c6a1eb3c6c370ffc6",
    PDS_GDR_LABEL: "ec07239f41d8abc1a3681495b5799b770c7206b5268b76721d69180df0422e02",
}


@dataclass(frozen=True)
class SiteSpec:
    id: str
    name: str
    location_hint: str
    description: str
    lat_deg: float
    lon_east_deg: float


# The three demonstration points. Coordinates were chosen by inspecting the DEM (see
# pipeline/site_survey.py and docs/verification-data.md). They are NOT NASA landing sites.
SITES: list[SiteSpec] = [
    SiteSpec(
        id="demo-a",
        name="Demo point A",
        location_hint="Ridge between Shackleton and de Gerlache craters",
        description=(
            "Demonstration point on the elevated ridge that connects the rims of Shackleton and de Gerlache "
            "craters, about 17 km from the south pole. Chosen for this prototype to illustrate a high ridge "
            "location close to the pole. Not a NASA landing site; not selected, approved or recommended."
        ),
        lat_deg=-89.45,
        lon_east_deg=222.7,
    ),
    SiteSpec(
        id="demo-b",
        name="Demo point B",
        location_hint="Summit area of the Malapert massif",
        description=(
            "Demonstration point at the highest DEM pixel of the Malapert massif, about 122 km from the south "
            "pole on the Earth-facing (near-side) meridian. Chosen for this prototype to illustrate a high, "
            "Earth-facing massif. Not a NASA landing site; not selected, approved or recommended."
        ),
        lat_deg=-85.9883,
        lon_east_deg=2.0625,
    ),
    SiteSpec(
        id="demo-c",
        name="Demo point C",
        location_hint="Lower-lying terrain about 32 km from the centre of Shackleton crater",
        description=(
            "Demonstration point in lower-lying terrain (below the 1737.4 km reference sphere) about 32 km "
            "from the centre of Shackleton crater, with surrounding relief that obstructs much of the horizon. "
            "Chosen for this prototype to contrast with the two elevated points. Not a NASA landing site; not "
            "selected, approved or recommended."
        ),
        lat_deg=-88.65,
        lon_east_deg=106.8,
    ),
]


def site_by_id(site_id: str) -> SiteSpec:
    for s in SITES:
        if s.id == site_id:
            return s
    raise KeyError(site_id)
