"""Shared constants. Every value here was verified live — see plans/00-verified-facts.md."""
from pathlib import Path

ROOT = Path(__file__).parent
RAW  = ROOT / "data" / "raw"
OUT  = ROOT / "data" / "out"
LOGS = ROOT / "logs"
for d in (RAW, OUT, LOGS): d.mkdir(parents=True, exist_ok=True)

# ---- Years -------------------------------------------------------------
BEFORE, AFTER = 2017, 2024

# ---- AOI ---------------------------------------------------------------
AOI_4326 = (-82.55, 29.48, -82.15, 29.82)          # Paynes Prairie -> San Felasco -> Newnans Lake

# Analysis grid: EPSG:32617, 20 m, snapped to a clean 20 m grid -> 1958 x 1862 px
ANALYSIS_EPSG = 32617
ANALYSIS_RES  = 20
AOI_UTM = (349720, 3262160, 388880, 3299400)       # xmin, ymin, xmax, ymax

# Delivery grid: EPSG:3857 at web-mercator z13 -> 2330 x 2279 px (frozen in the contract)
DELIVERY_EPSG = 3857
Z13_RES = 156543.03392804097 / 2**13               # 19.10925130208333
AOI_3857 = (-9189424.0, 3436882.3, -9144896.2, 3480433.4)

# ---- AlphaEarth --------------------------------------------------------
# Public COG mirror, anonymous. ALWAYS read the .vrt — the .tiff is bottom-up.
AEF_BASE = "/vsis3/us-west-2.opendata.source.coop/tge-labs/aef/v1/annual"
AEF_TILES = {                                      # 2 tiles per year; north + south of the 29.61 seam
    2017: ["17N/xvsg3n7fhmfjagaa9-0000000000-0000000000",
           "17N/xmf40mpety1i4sreo-0000008192-0000000000"],
    2024: ["17N/xu06dgi8n1s75ik92-0000000000-0000000000",
           "17N/xo1fyt05mcmguib6w-0000008192-0000000000"],
}
AEF_NODATA = -128
AEF_ATTRIBUTION = ("The AlphaEarth Foundations Satellite Embedding dataset "
                   "is produced by Google and Google DeepMind.")

def aef_vrt(year):
    return [f"{AEF_BASE}/{year}/{t}.vrt" for t in AEF_TILES[year]]

def dequantize(v):
    """Raw int8 -> analysis-ready float in [-1,1]. Documented mapping."""
    import numpy as np
    v = v.astype("float32")
    return ((v / 127.5) ** 2) * np.sign(v)

# ---- Sentinel-2 --------------------------------------------------------
STAC = "https://earth-search.aws.element84.com/v1/search"
S2_COLLECTION = "sentinel-2-l2a"
S2_MGRS = ["17RLN", "17RLP"]                       # informational: which tiles the AOI touches.
                                                   # NOT a filter - 02_fetch derives tiles from coverage.
S2_MONTH = 12                                      # FL dry season: clear scenes cluster in December
S2_MAX_CLOUD = 10
S2_MIN_COVER = 0.999                               # a date must fill the AOI. S2 granules are clipped to
                                                   # the orbit swath, so a 0.1%-cloud date can still be
                                                   # half empty - that bug shipped once already.
S2_MIN_COVER_ONDISK = 0.95                         # accept-an-existing-file gate. Looser than the above:
                                                   # scattered nodata from cloud masking is normal (2024
                                                   # lands at 98.6%); a swath cut is not (2017 was 54%).

# ---- GDAL env ----------------------------------------------------------
GDAL_ENV = {
    "AWS_NO_SIGN_REQUEST": "YES",
    "AWS_REGION": "us-west-2",
    "AWS_DEFAULT_REGION": "us-west-2",
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "VSI_CACHE": "TRUE",
    "VSI_CACHE_SIZE": "200000000",
    "GDAL_CACHEMAX": "1024",
    "GDAL_HTTP_MULTIPLEX": "YES",
    "GDAL_NUM_THREADS": "ALL_CPUS",
    "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".vrt,.tiff,.tif",
}

# ---- GLOBE + classes ---------------------------------------------------
GLOBE_API = ("https://api.globe.gov/search/v1/measurement/protocol/measureddate/lat/lon/"
             "?protocols={proto}&startdate={start}&enddate={end}"
             "&minlat={s}&maxlat={n}&minlon={w}&maxlon={e}&geojson=FALSE&sample=FALSE")
FL_BBOX = (-87.7, 24.4, -79.9, 31.1)     # train statewide: only 10 obs exist in Alachua
GLOBE_START, GLOBE_END = "2017-01-01", "2025-12-31"

# 4-class scheme. Codes are FROZEN (frontend contract); labels are served via stats.json.
CLASSES = {0: "Water / Wetland", 1: "Woody", 2: "Herbaceous", 3: "Urban / Barren"}

# MUC Level-1 digit (after stripping the 'M' prefix) -> our 4-class code.
# Lesson's 10 Level-1 names are in the comments; we collapse for sample support.
MUC_TO_CLASS = {
    "0": 1,   # Closed Forest            -> Woody
    "1": 1,   # Woodland                 -> Woody
    "2": 1,   # Shrubland or Thicket     -> Woody
    "3": 2,   # Dwarf-Shrubland          -> Herbaceous
    "4": 2,   # Herbaceous Vegetation    -> Herbaceous
    "5": 3,   # Barren                   -> Urban / Barren  (both non-vegetated)
    "6": 0,   # Wetland                  -> Water / Wetland
    "7": 0,   # Open Water               -> Water / Wetland
    "8": 2,   # Cultivated Land          -> Herbaceous
    "9": 3,   # Urban                    -> Urban / Barren
}

def muc_to_class(muc):
    """'M1121' -> 1. Returns None if unusable. NOTE the 'M' prefix must be stripped."""
    if not muc: return None
    d = str(muc).lstrip("Mm")
    return MUC_TO_CLASS.get(d[:1]) if d[:1].isdigit() else None

# ---- Transition categories + severity ----------------------------------
PADUS_URL = ("https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/"
             "Manager_Name/FeatureServer/0/query")
L4_PROB_MIN   = 0.50      # both years must be at least this confident
L4_CHANGE_PCTL = 97       # cosine-change percentile for the L4 gate
MIN_PATCH_HA  = 1.0       # contiguity filter: real change is contiguous, classifier
                          # flicker is salt-and-pepper. 14.9% of px flip class, but the
                          # flips are near-symmetric (126k Herb->Woody vs 118k Woody->Herb),
                          # which is boundary noise. Patch size removes it better than
                          # raising the threshold alone.
ADJACENT_M    = 500       # "adjacent to protected land" buffer

def categorise(a, b):
    """from-class, to-class -> (category, base severity).

    Paynes Prairie's seasonal flooding is a REAL class flip, so magnitude alone
    would rank natural hydrology above actual forest loss. Category is what keeps
    the task queue honest.
    """
    if a == 0 or b == 0:            return "hydrologic",     20
    if a == 1 and b in (2, 3):      return "vegetation_loss", 100
    if a == 2 and b == 3:           return "development",     70
    if b == 1 and a in (2, 3):      return "revegetation",    30
    return "other", 10

CATEGORY_LABELS = {
    "vegetation_loss": "Vegetation loss",
    "development":     "New development",
    "hydrologic":      "Water / wetland change",
    "revegetation":    "Revegetation",
    "other":           "Other change",
}
CATEGORY_COLORS = {
    "vegetation_loss": "#D7301F", "development": "#EF6548",
    "hydrologic":      "#4A80B5", "revegetation": "#3E8E5A", "other": "#999999",
}
