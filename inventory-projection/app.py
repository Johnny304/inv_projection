"""Local Inventory Collaboration Website.

Run manually after installing requirements:
    uvicorn app:app --reload --port 8780

This starter uses a local SQLite database for notes/imports and loads the
projection matrix from `data/inv_projection_matrix.parquet` (or `.csv`)
exported by `inv_prj.ipynb`. It does not connect to company systems.
Sample rows are used only when the export file is missing.
"""

from __future__ import annotations

import json
import logging
import re
import sqlite3
from contextlib import closing
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import FastAPI, HTTPException, Query, UploadFile
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi import Request
from pydantic import BaseModel, Field


logger = logging.getLogger("inv_projection")

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "inventory_collaboration.db"
DATA_DIR = BASE_DIR / "data"
MATRIX_PARQUET = DATA_DIR / "inv_projection_matrix.parquet"
MATRIX_CSV = DATA_DIR / "inv_projection_matrix.csv"
MATRIX_META = DATA_DIR / "inv_projection_meta.json"
MATRIX_IV_PARQUET = DATA_DIR / "inv_projection_matrix_iv.parquet"
MATRIX_IV_CSV = DATA_DIR / "inv_projection_matrix_iv.csv"
MATRIX_IV_META = DATA_DIR / "inv_projection_meta_iv.json"
MATRIX_ETD_PARQUET = DATA_DIR / "inv_projection_matrix_etd.parquet"
MATRIX_ETD_CSV = DATA_DIR / "inv_projection_matrix_etd.csv"
MATRIX_ETD_META = DATA_DIR / "inv_projection_meta_etd.json"
MATRIX_ETD_IV_PARQUET = DATA_DIR / "inv_projection_matrix_etd_iv.parquet"
MATRIX_ETD_IV_CSV = DATA_DIR / "inv_projection_matrix_etd_iv.csv"
MATRIX_ETD_IV_META = DATA_DIR / "inv_projection_meta_etd_iv.json"

GRAINS = ("whse", "item_vendor", "etd_whse", "etd_item_vendor")
IV_GRAINS = frozenset({"item_vendor", "etd_item_vendor"})
WHSE_FOR_IV = {"item_vendor": "whse", "etd_item_vendor": "etd_whse"}
GRAIN_FILES = {
    "whse": (MATRIX_PARQUET, MATRIX_CSV, MATRIX_META),
    "item_vendor": (MATRIX_IV_PARQUET, MATRIX_IV_CSV, MATRIX_IV_META),
    "etd_whse": (MATRIX_ETD_PARQUET, MATRIX_ETD_CSV, MATRIX_ETD_META),
    "etd_item_vendor": (MATRIX_ETD_IV_PARQUET, MATRIX_ETD_IV_CSV, MATRIX_ETD_IV_META),
}

VARIABLES = [
    "firm_demand",
    "firm_trf_out",
    "net_fcst",
    "planned_trf_out",
    "promotional_lift",
    "intransit_trf_in",
    "on_order_trf_in",
    "planned_pos",
    "planned_trf_in",
    "firm_pos",
    "firm_prod",
    "planned_prod",
    "safety_stock",
    "planned_po_dual",
    "firm_po_dual",
    "inv_projection",
    "ss_pct",
    "si_ss",
]
DERIVED_VARS = frozenset({"ss_pct", "si_ss"})
DEMAND_VARS = ["firm_demand", "firm_trf_out", "net_fcst", "planned_trf_out"]
SUPPLY_VARS = [
    "intransit_trf_in",
    "on_order_trf_in",
    "planned_pos",
    "planned_trf_in",
    "firm_pos",
    "firm_prod",
    "planned_prod",
]
DATE_COL_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
RISK_FILTERS = ("before_lock_week", "in_lock_week", "out_of_lock_week")


def _normalize_grain(grain: str | None) -> str:
    value = (grain or "whse").strip() or "whse"
    return value if value in GRAINS else "whse"


def _is_iv_grain(grain: str) -> bool:
    return grain in IV_GRAINS


def _is_etd_grain(grain: str) -> bool:
    return grain in ("etd_whse", "etd_item_vendor")


def _whse_grain_for(grain: str) -> str:
    return WHSE_FOR_IV.get(grain, "whse")


def _filter_values(raw: str | list[str] | None) -> list[str]:
    """Normalize filter query params into a unique value list (OR match)."""
    if raw is None:
        return []
    parts = [raw] if isinstance(raw, str) else list(raw)
    out: list[str] = []
    seen: set[str] = set()
    for part in parts:
        for piece in str(part).split(","):
            value = piece.strip()
            if value and value not in seen:
                seen.add(value)
                out.append(value)
    return out


def _classify_risk(
    *,
    item: str,
    vendor: str,
    warehouse: str,
    series: str = "",
    profile: str = "",
    division: str = "",
    weeks: list[str],
    projection: list[int],
    lock_weeks: set[str],
) -> list[dict[str, Any]]:
    """Return one record per applicable negative-SI risk category."""
    negative_indexes = [index for index, value in enumerate(projection) if value < 0]
    if not negative_indexes:
        return []

    ordered_locks = sorted(lock_weeks)
    first_lock = ordered_locks[0] if ordered_locks else ""
    categories: dict[str, list[int]] = {name: [] for name in RISK_FILTERS}
    for index in negative_indexes:
        week = str(weeks[index])
        if first_lock and week < first_lock:
            categories["before_lock_week"].append(index)
        if week in lock_weeks:
            categories["in_lock_week"].append(index)
        if first_lock and week > first_lock and week not in lock_weeks:
            categories["out_of_lock_week"].append(index)

    records: list[dict[str, Any]] = []
    for category, indexes in categories.items():
        if not indexes:
            continue
        negative_index = indexes[0]
        negative_week = str(weeks[negative_index])
        eta_week = negative_week if category == "in_lock_week" else (first_lock or "")
        eta_index = weeks.index(eta_week) if eta_week in weeks else -1
        eta_value = projection[eta_index] if eta_index >= 0 and projection[eta_index] < 0 else None
        records.append(
            {
                "item": str(item),
                "vendor": str(vendor),
                "warehouse": str(warehouse),
                "series": str(series or ""),
                "profile": str(profile or ""),
                "division": str(division or ""),
                "risk_filter": category,
                "negative_week": negative_week,
                "negative_si": int(projection[negative_index]),
                "eta_week": eta_week,
                "eta_negative": int(eta_value) if eta_value is not None else None,
            }
        )
    return records


app = FastAPI(title="Inventory Collaboration", version="0.1.0")
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
app.mount("/docs", StaticFiles(directory=BASE_DIR / "docs", html=False), name="product_docs")
templates = Jinja2Templates(directory=BASE_DIR / "templates")

STATIC_DIR = BASE_DIR / "static"


def asset_version() -> str:
    """Newest mtime across static assets, so a restart always busts browser cache."""
    try:
        newest = max(path.stat().st_mtime for path in STATIC_DIR.glob("*.*"))
    except ValueError:
        return "0"
    return str(int(newest))


def _unique_sorted(values) -> list[str]:
    """Unique non-empty strings, sorted."""
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        text = str(value).strip() if value is not None else ""
        if text and text not in seen:
            seen.add(text)
            out.append(text)
    out.sort()
    return out


def utc_now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def audit(action: str, actor: str, detail: str) -> None:
    with closing(connect()) as conn:
        conn.execute(
            "INSERT INTO audit_log (occurred_at, actor, action, detail) VALUES (?, ?, ?, ?)",
            (utc_now(), actor, action, detail),
        )
        conn.commit()


def init_db() -> None:
    with closing(connect()) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item TEXT NOT NULL,
                vendor TEXT NOT NULL,
                warehouse TEXT NOT NULL,
                week TEXT NOT NULL,
                category TEXT NOT NULL,
                priority TEXT NOT NULL,
                body TEXT NOT NULL,
                owner TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'Open',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS import_jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                source TEXT NOT NULL,
                status TEXT NOT NULL,
                row_count INTEGER NOT NULL,
                submitted_by TEXT NOT NULL,
                submitted_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                occurred_at TEXT NOT NULL,
                actor TEXT NOT NULL,
                action TEXT NOT NULL,
                detail TEXT NOT NULL
            );
            """
        )
        existing = conn.execute("SELECT COUNT(*) FROM notes").fetchone()[0]
        if existing == 0:
            now = utc_now()
            conn.executemany(
                """
                INSERT INTO notes
                (item, vendor, warehouse, week, category, priority, body, owner, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        "B200-58",
                        "624556",
                        "335",
                        "2026-08-01",
                        "Supplier follow-up",
                        "High",
                        "Confirm final container loading date before Wednesday cut-off.",
                        "Minh Tran",
                        "Open",
                        now,
                        now,
                    ),
                    (
                        "U15204",
                        "600039",
                        "ECR",
                        "2026-07-25",
                        "Planning assumption",
                        "Medium",
                        "Demand uplift is tied to the summer promotion; validate with sales on Friday.",
                        "Linh Nguyen",
                        "Reviewed",
                        now,
                        now,
                    ),
                ],
            )
            conn.execute(
                "INSERT INTO audit_log (occurred_at, actor, action, detail) VALUES (?, ?, ?, ?)",
                (now, "System", "Baseline loaded", "Inventory projection sample dataset is ready."),
            )
        conn.commit()


@app.on_event("startup")
def startup() -> None:
    init_db()


# Sample horizon: current Saturday through ~6 months ahead (26 weeks).
_SAMPLE_START = date(2026, 7, 18)
WEEKS = [(_SAMPLE_START + timedelta(weeks=i)).isoformat() for i in range(26)]


def _roll_inv(opening: int, values: dict[str, list[int]]) -> list[int]:
    """InvProj = prior + SUPPLY − DEMAND (safety stock display-only)."""
    out: list[int] = []
    prior = opening
    n = len(next(iter(values.values())))
    for i in range(n):
        supply = sum(values[k][i] for k in SUPPLY_VARS)
        demand = sum(values[k][i] for k in DEMAND_VARS)
        prior = prior + supply - demand
        out.append(prior)
    return out


def _roll_inv_etd(values: dict[str, list[int]]) -> list[int]:
    """Copy SI on W-1/W1 (SHIPPABLE INV); roll from W2 using SI(W1) as opening."""
    n = len(next(iter(values.values())))
    si = values.get("inv_projection") or [0] * n
    out = [0] * n
    if n:
        out[0] = int(si[0])
    if n < 2:
        return out
    out[1] = int(si[1])
    prior = out[1]
    for i in range(2, n):
        supply = sum(values[k][i] for k in SUPPLY_VARS)
        demand = sum(values[k][i] for k in DEMAND_VARS)
        prior = prior + supply - demand
        out[i] = prior
    return out


def _roll_inv_for_grain(grain: str, opening: int, values: dict[str, list[int]]) -> list[int]:
    if _is_etd_grain(grain):
        return _roll_inv_etd(values)
    return _roll_inv(opening, values)


def _attach_ss_metrics(values: dict[str, list[int]]) -> dict[str, list[int]]:
    """SS% and SI-SS from rolled SI. Safety 0 → SS% blank (None)."""
    si = values["inv_projection"]
    ss = values.get("safety_stock") or [0] * len(si)
    values["si_ss"] = [int(si[i] - ss[i]) for i in range(len(si))]
    values["ss_pct"] = [
        None if ss[i] == 0 else int(round(si[i] / ss[i] * 100.0)) for i in range(len(si))
    ]
    return values


def _extend_series(base: list[int], length: int, bump: int = 0) -> list[int]:
    """Repeat / drift a short seed series out to the sample horizon."""
    out: list[int] = []
    for i in range(length):
        seed = base[i % len(base)]
        out.append(max(0, seed + bump * (i // len(base))))
    return out


def _zeros(length: int) -> list[int]:
    return [0] * length


def sample_projection_rows() -> list[dict]:
    """Read-only stand-in for the `inv_projection` matrix (PDT-shaped variables)."""
    n = len(WEEKS)
    specs = [
        {
            "item": "B200-58",
            "vendor": "624556",
            "warehouse": "335",
            "series": "B200",
            "division": "Import Casegoods",
            "profile": "624556-PROD CASEGOOD",
            "opening": 257,
            "po_seed": [0, 120, 240, 0, 0, 0, 180, 0],
            "demand_seed": [42, 55, 58, 61, 63, 68],
            "fcst_seed": [31, 42, 50, 52, 49, 45],
            "safety": 90,
        },
        {
            "item": "U15204",
            "vendor": "600039",
            "warehouse": "ECR",
            "series": "U152",
            "division": "Upholstery",
            "profile": "600039-PROD MOTION",
            "opening": 158,
            "po_seed": [0, 0, 0, 60, 0, 0, 80, 0],
            "demand_seed": [29, 35, 38, 41, 42, 44],
            "fcst_seed": [20, 25, 31, 34, 32, 30],
            "safety": 72,
        },
        {
            "item": "W446-68",
            "vendor": "900515",
            "warehouse": "15",
            "series": "W446",
            "division": "Domestic Casegoods",
            "profile": "900515-PROD FG",
            "opening": 200,
            "po_seed": [30, 60, 0, 0, 90, 0, 45, 0],
            "demand_seed": [14, 15, 18, 16, 20, 23],
            "fcst_seed": [10, 12, 15, 15, 17, 20],
            "safety": 42,
        },
        {
            "item": "M825-31",
            "vendor": "900639",
            "warehouse": "1",
            "series": "M825",
            "division": "Imported Upholstery",
            "profile": "900639-PROD STAT",
            "opening": 163,
            "po_seed": [0, 0, 90, 0, 0, 0, 70, 0],
            "demand_seed": [18, 23, 25, 26, 29, 31],
            "fcst_seed": [15, 17, 18, 23, 25, 22],
            "safety": 55,
        },
    ]
    rows: list[dict] = []
    for spec in specs:
        firm_pos = _extend_series(spec["po_seed"], n)
        firm_demand = _extend_series(spec["demand_seed"], n, bump=1)
        net_fcst = _extend_series(spec["fcst_seed"], n, bump=1)
        values = {
            "firm_demand": firm_demand,
            "firm_trf_out": _zeros(n),
            "net_fcst": net_fcst,
            "planned_trf_out": _zeros(n),
            "promotional_lift": _zeros(n),
            "intransit_trf_in": _zeros(n),
            "on_order_trf_in": _zeros(n),
            "planned_pos": _zeros(n),
            "planned_trf_in": _zeros(n),
            "firm_pos": firm_pos,
            "firm_prod": _zeros(n),
            "planned_prod": _zeros(n),
            "safety_stock": [spec["safety"]] * n,
            "planned_po_dual": _zeros(n),
            "firm_po_dual": _zeros(n),
        }
        values["inv_projection"] = _roll_inv(spec["opening"], values)
        _attach_ss_metrics(values)
        rows.append(
            {
                "item": spec["item"],
                "vendor": spec["vendor"],
                "warehouse": spec["warehouse"],
                "series": spec["series"],
                "division": spec["division"],
                "profile": spec["profile"],
                "mb": "",
                "vname_dual": "",
                "values": values,
            }
        )
    return rows


def _cell_number(value: Any) -> int:
    if value is None:
        return 0
    try:
        import math

        if isinstance(value, float) and math.isnan(value):
            return 0
    except Exception:
        pass
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return 0


def _week_columns(columns: list[str]) -> list[str]:
    return [c for c in columns if DATE_COL_RE.match(str(c))]


def _read_matrix_frame(grain: str = "whse"):
    """Load notebook export; prefer parquet, then CSV. Returns None if unavailable."""
    try:
        import pandas as pd
    except ImportError:
        return None

    grain = _normalize_grain(grain)
    parquet, csv_path, _meta = GRAIN_FILES[grain]
    if parquet.exists():
        try:
            return pd.read_parquet(parquet)
        except Exception:
            logger.warning("Could not read %s; falling back to CSV", parquet.name, exc_info=True)
    if csv_path.exists():
        try:
            return pd.read_csv(csv_path)
        except Exception:
            logger.warning("Could not read %s", csv_path.name, exc_info=True)
    return None


def _read_meta(grain: str = "whse") -> dict[str, Any]:
    grain = _normalize_grain(grain)
    path = GRAIN_FILES[grain][2]
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        logger.warning("Could not parse %s", path.name, exc_info=True)
        return {}


def _source_mtime(grain: str = "whse") -> float:
    """Newest mtime across matrix + meta, so an updated sibling file invalidates cache."""
    grain = _normalize_grain(grain)
    times = [path.stat().st_mtime for path in GRAIN_FILES[grain] if path.exists()]
    return max(times) if times else 0.0


class ProjectionStore:
    """In-memory notebook matrix with fast filter/slice for the website API."""

    def __init__(self, df, *, grain: str = "whse"):
        import numpy as np
        import pandas as pd

        self.grain = _normalize_grain(grain)
        self.prefer_iv = _is_iv_grain(self.grain)
        df = df.copy()
        df.columns = [str(c) for c in df.columns]
        weeks = _week_columns(list(df.columns))
        if not weeks or "variable" not in df.columns:
            raise ValueError("Export matrix missing week/variable columns")

        for col in weeks:
            df[col] = pd.to_numeric(df[col], errors="coerce")

        meta_cols = ["item", "vendor", "whse", "Series", "AFI Finance Division", "ProdResourceID"]
        if "MB" in df.columns:
            meta_cols.append("MB")
        if "VNAME (dual1)" in df.columns:
            meta_cols.append("VNAME (dual1)")
        meta = (
            df.drop_duplicates(subset=["item", "vendor", "whse"], keep="first")
            .loc[:, [c for c in meta_cols if c in df.columns]]
            .copy()
        )
        meta["item"] = meta["item"].astype(str)
        meta["vendor"] = meta["vendor"].astype(str)
        meta["whse"] = meta["whse"].astype(str)
        meta["Series"] = meta["Series"].fillna("").astype(str)
        meta["AFI Finance Division"] = meta["AFI Finance Division"].fillna("").astype(str)
        meta["ProdResourceID"] = meta["ProdResourceID"].fillna("").astype(str)
        if "MB" not in meta.columns:
            meta["MB"] = ""
        else:
            meta["MB"] = meta["MB"].fillna("").astype(str)
        if "VNAME (dual1)" not in meta.columns:
            meta["VNAME (dual1)"] = ""
        else:
            meta["VNAME (dual1)"] = meta["VNAME (dual1)"].fillna("").astype(str)
        # Inv Prj by Whse: stable order Item → Vendor → Whse (IV has whse=ALL)
        meta = meta.sort_values(["item", "vendor", "whse"], kind="mergesort").reset_index(drop=True)
        key_index = pd.MultiIndex.from_frame(meta[["item", "vendor", "whse"]])

        values: dict[str, Any] = {}
        for var in VARIABLES:
            sub = (
                df.loc[df["variable"].astype(str) == var, ["item", "vendor", "whse", *weeks]]
                .assign(item=lambda x: x["item"].astype(str), vendor=lambda x: x["vendor"].astype(str), whse=lambda x: x["whse"].astype(str))
                .drop_duplicates(subset=["item", "vendor", "whse"], keep="first")
                .set_index(["item", "vendor", "whse"])
                .reindex(key_index)
            )
            arr = sub[weeks].to_numpy(dtype="float64", copy=True)
            np.nan_to_num(arr, copy=False, nan=0.0)
            values[var] = np.rint(arr).astype("int32", copy=False)

        self.weeks = weeks
        self.meta = meta
        self.values = values
        self.n = len(meta)

    def _mask(self, item, vendor, warehouse, series, division, profile, mb=""):
        import numpy as np

        mask = np.ones(self.n, dtype=bool)
        meta = self.meta
        items = _filter_values(item)
        vendors = _filter_values(vendor)
        warehouses = _filter_values(warehouse)
        series_vals = _filter_values(series)
        divisions = _filter_values(division)
        profiles = _filter_values(profile)
        mb_vals = _filter_values(mb)
        if items:
            mask &= np.isin(meta["item"].to_numpy(), items)
        if vendors:
            mask &= np.isin(meta["vendor"].to_numpy(), vendors)
        if warehouses:
            mask &= np.isin(meta["whse"].to_numpy(), warehouses)
        if series_vals:
            mask &= np.isin(meta["Series"].to_numpy(), series_vals)
        if divisions:
            mask &= np.isin(meta["AFI Finance Division"].to_numpy(), divisions)
        if profiles:
            mask &= np.isin(meta["ProdResourceID"].to_numpy(), profiles)
        if mb_vals:
            mb_wanted = set(mb_vals)

            def _mb_hit(raw: Any) -> bool:
                text = "" if raw is None else str(raw).strip()
                if not text:
                    return False
                if text in mb_wanted:
                    return True
                return any(part.strip() in mb_wanted for part in text.split("|") if part.strip())

            mask &= meta["MB"].map(_mb_hit).to_numpy()
        return mask

    def _scoped_filter_options(
        self,
        item: str | list[str] = "",
        vendor: str | list[str] = "",
        warehouse: str | list[str] = "",
        series: str | list[str] = "",
        division: str | list[str] = "",
        profile: str | list[str] = "",
        mb: str | list[str] = "",
    ) -> dict[str, list[str]]:
        """Facet options: each dimension ignores its own filter, applies the others."""
        meta = self.meta
        facets = {
            "items": ("item", "", vendor, warehouse, series, division, profile, mb),
            "vendors": ("vendor", item, "", warehouse, series, division, profile, mb),
            "warehouses": ("whse", item, vendor, "", series, division, profile, mb),
            "series": ("Series", item, vendor, warehouse, "", division, profile, mb),
            "divisions": ("AFI Finance Division", item, vendor, warehouse, series, "", profile, mb),
            "profiles": ("ProdResourceID", item, vendor, warehouse, series, division, "", mb),
            "mb_codes": ("MB", item, vendor, warehouse, series, division, profile, ""),
        }
        options: dict[str, list[str]] = {}
        for key, (col, *args) in facets.items():
            if key == "warehouses" and self.prefer_iv:
                options[key] = []
                continue
            mask = self._mask(*args)
            if key == "mb_codes":
                tokens: list[str] = []
                for raw in meta.loc[mask, col].tolist():
                    text = "" if raw is None else str(raw).strip()
                    if not text:
                        continue
                    if "|" in text:
                        tokens.extend(part.strip() for part in text.split("|") if part.strip())
                    else:
                        tokens.append(text)
                options[key] = _unique_sorted(tokens)
            else:
                options[key] = _unique_sorted(meta.loc[mask, col].tolist())
        return options

    def query(
        self,
        *,
        item: str | list[str] = "",
        vendor: str | list[str] = "",
        warehouse: str | list[str] = "",
        series: str | list[str] = "",
        division: str | list[str] = "",
        profile: str | list[str] = "",
        mb: str | list[str] = "",
        risk_filter: str | list[str] = "",
        limit: int = 100,
    ) -> dict[str, Any]:
        import numpy as np

        mask = self._mask(item, vendor, warehouse, series, division, profile, mb)
        selected_risks = set(_filter_values(risk_filter)) & set(RISK_FILTERS)
        if selected_risks:
            risk_routes = _risk_records_from_store(
                self,
                item=item,
                vendor=vendor,
                warehouse=warehouse,
                risk_filter=risk_filter,
            )
            allowed = {
                (record["item"], record["vendor"], record["warehouse"])
                for record in risk_routes
            }
            route_keys = zip(
                self.meta["item"].to_numpy(),
                self.meta["vendor"].to_numpy(),
                self.meta["whse"].to_numpy(),
            )
            mask &= np.fromiter(
                ((item_id, vendor_id, whse_id) in allowed for item_id, vendor_id, whse_id in route_keys),
                dtype=bool,
                count=self.n,
            )
        idxs = np.flatnonzero(mask)
        total_match = int(idxs.size)
        matched_items = int(self.meta.loc[mask, "item"].nunique()) if total_match else 0
        if limit > 0:
            idxs = idxs[:limit]
        rows: list[dict] = []
        for i in idxs:
            i = int(i)
            rows.append(
                {
                    "item": self.meta.at[i, "item"],
                    "vendor": self.meta.at[i, "vendor"],
                    "warehouse": self.meta.at[i, "whse"],
                    "series": self.meta.at[i, "Series"],
                    "division": self.meta.at[i, "AFI Finance Division"],
                    "profile": self.meta.at[i, "ProdResourceID"],
                    "mb": self.meta.at[i, "MB"],
                    "vname_dual": str(self.meta.at[i, "VNAME (dual1)"] or ""),
                    "values": {var: self.values[var][i].tolist() for var in VARIABLES},
                }
            )
        returned_items = len({r["item"] for r in rows})

        meta = _read_meta(self.grain)
        mtime = _source_mtime(self.grain)
        updated = (
            str(meta.get("updated_at"))
            if meta.get("updated_at")
            else datetime.fromtimestamp(mtime, tz=UTC).strftime("%Y-%m-%d %H:%M UTC")
            if mtime
            else utc_now()
        )
        return {
            "weeks": self.weeks,
            "rows": rows,
            # No `exceptions` key: the browser derives them from `rows` so that
            # variable toggles and item-week exclusions are reflected.
            "filter_options": {
                **self._scoped_filter_options(
                    item=item,
                    vendor=vendor,
                    warehouse=warehouse,
                    series=series,
                    division=division,
                    profile=profile,
                    mb=mb,
                ),
                "risk_filters": list(RISK_FILTERS),
            },
            "total_rows": self.n,
            "matched_rows": total_match,
            "returned_rows": len(rows),
            "matched_items": matched_items,
            "returned_items": returned_items,
            "grain": self.grain,
            "lock_weeks_by_warehouse": (
                {}
                if self.grain != "whse"
                else {
                    str(whse): [str(week) for week in weeks]
                    for whse, weeks in (meta.get("lock_weeks_by_warehouse") or {}).items()
                    if weeks
                }
            ),
            "freshness": {
                "source": str(meta.get("source") or f"Notebook export ({self.grain})"),
                "updated_at": updated,
                "status": str(meta.get("status") or "Fresh"),
                "row_groups": int(meta.get("row_groups") or self.n),
                "week_count": int(meta.get("week_count") or len(self.weeks)),
            },
        }


def _risk_records_from_store(
    store: ProjectionStore,
    *,
    item: str | list[str] = "",
    vendor: str | list[str] = "",
    warehouse: str | list[str] = "",
    series: str | list[str] = "",
    profile: str | list[str] = "",
    division: str | list[str] = "",
    risk_filter: str | list[str] = "",
) -> list[dict[str, Any]]:
    """Classify all matching warehouse routes before applying the display limit."""
    import numpy as np

    if store.prefer_iv:
        raise ValueError("Risk classification requires the warehouse projection store")
    mask = store._mask(item, vendor, warehouse, series, division, profile, "")
    selected_risks = set(_filter_values(risk_filter)) & set(RISK_FILTERS)
    cache = getattr(store, "_risk_records_cache", None)
    if cache is None:
        meta = _read_meta("whse")
        lock_map = {
            str(key): {str(week) for week in values}
            for key, values in (meta.get("lock_weeks_by_warehouse") or {}).items()
        }
        cache = {}
        for index in range(store.n):
            route = store.meta.iloc[index]
            key = (str(route["item"]), str(route["vendor"]), str(route["whse"]))
            cache[key] = _classify_risk(
                item=route["item"],
                vendor=route["vendor"],
                warehouse=route["whse"],
                series=str(route["Series"]) if "Series" in route.index else "",
                profile=str(route["ProdResourceID"]) if "ProdResourceID" in route.index else "",
                division=str(route["AFI Finance Division"]) if "AFI Finance Division" in route.index else "",
                weeks=store.weeks,
                projection=store.values["inv_projection"][index].tolist(),
                lock_weeks=lock_map.get(str(route["whse"]), set()),
            )
        setattr(store, "_risk_records_cache", cache)
    records: list[dict[str, Any]] = []
    for index in np.flatnonzero(mask):
        index = int(index)
        route = store.meta.iloc[index]
        key = (str(route["item"]), str(route["vendor"]), str(route["whse"]))
        route_records = cache.get(key, [])
        if selected_risks:
            route_records = [record for record in route_records if record["risk_filter"] in selected_risks]
        records.extend(route_records)
    return records


def _empty_risk_filter_options() -> dict[str, list[str]]:
    return {
        "items": [],
        "vendors": [],
        "warehouses": [],
        "series": [],
        "profiles": [],
        "divisions": [],
        "risk_filters": list(RISK_FILTERS),
    }


def _risk_filter_options(records: list[dict[str, Any]]) -> dict[str, list[str]]:
    return {
        "items": _unique_sorted(record["item"] for record in records),
        "vendors": _unique_sorted(record["vendor"] for record in records),
        "warehouses": _unique_sorted(record["warehouse"] for record in records),
        "series": _unique_sorted(record.get("series", "") for record in records),
        "profiles": _unique_sorted(record.get("profile", "") for record in records),
        "divisions": _unique_sorted(record.get("division", "") for record in records),
        "risk_filters": list(RISK_FILTERS),
    }


def load_risk_items(
    *,
    item: str | list[str] = "",
    vendor: str | list[str] = "",
    warehouse: str | list[str] = "",
    series: str | list[str] = "",
    profile: str | list[str] = "",
    division: str | list[str] = "",
    risk_filter: str | list[str] = "",
    grain: str = "whse",
    limit: int = 100,
) -> dict[str, Any]:
    """Return risk records from every warehouse route, then apply the display limit."""
    store = get_projection_store(prefer_iv=False)
    if store is None:
        return {
            "weeks": WEEKS,
            "rows": [],
            "filter_options": _empty_risk_filter_options(),
            "matched_rows": 0,
            "returned_rows": 0,
            "grain": "item_vendor" if grain == "item_vendor" else "whse",
            "freshness": {"source": "Sample data", "status": "Fallback", "updated_at": utc_now()},
        }

    warehouse_records = _risk_records_from_store(
        store,
        item=item,
        vendor=vendor,
        warehouse=warehouse,
        series=series,
        profile=profile,
        division=division,
        risk_filter=risk_filter,
    )
    if grain == "item_vendor":
        grouped: dict[tuple[str, str, str], dict[str, Any]] = {}
        for record in warehouse_records:
            key = (record["item"], record["vendor"], record["risk_filter"])
            current = grouped.get(key)
            if current is None or record["negative_week"] < current["negative_week"]:
                grouped[key] = {
                    **record,
                    "warehouse": "ALL",
                }
        records = sorted(grouped.values(), key=lambda row: (row["item"], row["vendor"], row["risk_filter"]))
    else:
        records = sorted(
            warehouse_records,
            key=lambda row: (row["item"], row["vendor"], row["warehouse"], row["risk_filter"]),
        )

    meta = _read_meta("whse")
    records_before_limit = len(records)
    if limit > 0:
        records = records[:limit]
    mtime = _source_mtime("whse")
    updated = (
        str(meta.get("updated_at"))
        if meta.get("updated_at")
        else datetime.fromtimestamp(mtime, tz=UTC).strftime("%Y-%m-%d %H:%M UTC")
        if mtime
        else utc_now()
    )
    return {
        "weeks": store.weeks,
        "rows": records,
        "filter_options": _risk_filter_options(warehouse_records),
        "matched_rows": records_before_limit,
        "returned_rows": len(records),
        "grain": "item_vendor" if grain == "item_vendor" else "whse",
        "freshness": {
            "source": str(meta.get("source") or "Notebook export"),
            "updated_at": updated,
            "status": str(meta.get("status") or "Fresh"),
        },
    }


_STORES: dict[str, ProjectionStore | None] = {}
_STORE_MTIMES: dict[str, float] = {}


def clear_projection_stores() -> dict[str, Any]:
    """Drop in-memory caches so the next dashboard call re-reads export files."""
    global _STORES, _STORE_MTIMES
    _STORES = {}
    _STORE_MTIMES = {}
    out: dict[str, Any] = {"ok": True, "cleared_at": utc_now()}
    for grain in GRAINS:
        meta = _read_meta(grain)
        out[grain] = {
            "mtime": _source_mtime(grain),
            "updated_at": meta.get("updated_at"),
            "source": meta.get("source"),
            "row_groups": meta.get("row_groups"),
        }
    return out


def get_projection_store(*, grain: str = "whse", prefer_iv: bool | None = None) -> ProjectionStore | None:
    global _STORES, _STORE_MTIMES
    if prefer_iv is not None:
        grain = "item_vendor" if prefer_iv else "whse"
    grain = _normalize_grain(grain)
    mtime = _source_mtime(grain)
    if mtime <= 0:
        _STORES[grain] = None
        _STORE_MTIMES[grain] = 0.0
        return None
    cached = _STORES.get(grain)
    if cached is not None and _STORE_MTIMES.get(grain) == mtime:
        return cached
    frame = _read_matrix_frame(grain)
    if frame is None:
        _STORES[grain] = None
        _STORE_MTIMES[grain] = 0.0
        return None
    store = ProjectionStore(frame, grain=grain)
    _STORES[grain] = store
    _STORE_MTIMES[grain] = mtime
    return store


def _sample_row_matches(
    row: dict,
    *,
    items: list[str],
    vendors: list[str],
    warehouses: list[str],
    series_vals: list[str],
    divisions: list[str],
    profiles: list[str],
    mb_vals: list[str],
    grain: str,
) -> bool:
    if items and row["item"] not in items:
        return False
    if vendors and row["vendor"] not in vendors:
        return False
    if warehouses and not _is_iv_grain(grain) and row["warehouse"] not in warehouses:
        return False
    if series_vals and row["series"] not in series_vals:
        return False
    if divisions and row["division"] not in divisions:
        return False
    if profiles and row["profile"] not in profiles:
        return False
    if mb_vals:
        raw = str(row.get("mb", "") or "").strip()
        tokens = {raw} if raw and "|" not in raw else {p.strip() for p in raw.split("|") if p.strip()}
        if not tokens.intersection(mb_vals):
            return False
    return True


def _sample_scoped_filter_options(
    all_rows: list[dict],
    *,
    item: str | list[str] = "",
    vendor: str | list[str] = "",
    warehouse: str | list[str] = "",
    series: str | list[str] = "",
    division: str | list[str] = "",
    profile: str | list[str] = "",
    mb: str | list[str] = "",
    grain: str = "whse",
) -> dict[str, list[str]]:
    items = _filter_values(item)
    vendors = _filter_values(vendor)
    warehouses = _filter_values(warehouse)
    series_vals = _filter_values(series)
    divisions = _filter_values(division)
    profiles = _filter_values(profile)
    mb_vals = _filter_values(mb)

    def scoped(exclude: str) -> list[dict]:
        return [
            r
            for r in all_rows
            if _sample_row_matches(
                r,
                items=[] if exclude == "item" else items,
                vendors=[] if exclude == "vendor" else vendors,
                warehouses=[] if exclude == "warehouse" else warehouses,
                series_vals=[] if exclude == "series" else series_vals,
                divisions=[] if exclude == "division" else divisions,
                profiles=[] if exclude == "profile" else profiles,
                mb_vals=[] if exclude == "mb" else mb_vals,
                grain=grain,
            )
        ]

    return {
        "items": _unique_sorted(r["item"] for r in scoped("item")),
        "vendors": _unique_sorted(r["vendor"] for r in scoped("vendor")),
        "warehouses": [] if _is_iv_grain(grain) else _unique_sorted(r["warehouse"] for r in scoped("warehouse")),
        "series": _unique_sorted(r["series"] for r in scoped("series")),
        "divisions": _unique_sorted(r["division"] for r in scoped("division")),
        "profiles": _unique_sorted(r["profile"] for r in scoped("profile")),
        "mb_codes": _unique_sorted(r.get("mb", "") for r in scoped("mb")),
    }


def sample_dashboard(
    *,
    item: str | list[str] = "",
    vendor: str | list[str] = "",
    warehouse: str | list[str] = "",
    series: str | list[str] = "",
    division: str | list[str] = "",
    profile: str | list[str] = "",
    mb: str | list[str] = "",
    risk_filter: str | list[str] = "",
    limit: int = 1500,
    grain: str = "whse",
) -> dict[str, Any]:
    grain = _normalize_grain(grain)
    all_rows = sample_projection_rows()
    items = _filter_values(item)
    vendors = _filter_values(vendor)
    warehouses = _filter_values(warehouse)
    series_vals = _filter_values(series)
    divisions = _filter_values(division)
    profiles = _filter_values(profile)
    mb_vals = _filter_values(mb)
    rows = [
        r
        for r in all_rows
        if _sample_row_matches(
            r,
            items=items,
            vendors=vendors,
            warehouses=warehouses,
            series_vals=series_vals,
            divisions=divisions,
            profiles=profiles,
            mb_vals=mb_vals,
            grain=grain,
        )
    ]
    selected_risks = set(_filter_values(risk_filter)) & set(RISK_FILTERS)
    if selected_risks:
        rows = [
            row
            for row in rows
            if {
                record["risk_filter"]
                for record in _classify_risk(
                    item=row["item"],
                    vendor=row["vendor"],
                    warehouse=row["warehouse"],
                    weeks=WEEKS,
                    projection=row["values"]["inv_projection"],
                    lock_weeks=set(),
                )
            } & selected_risks
        ]
    if _is_iv_grain(grain):
        # Sample fallback: collapse to item×vendor by summing inputs (not SS%/SI-SS).
        grouped: dict[tuple[str, str], dict] = {}
        for row in rows:
            key = (row["item"], row["vendor"])
            if key not in grouped:
                grouped[key] = {
                    **{k: row[k] for k in ("item", "vendor", "series", "division", "profile", "mb")},
                    "warehouse": "ALL",
                    "opening": 0,
                    "values": {var: list(row["values"][var]) for var in VARIABLES if var not in DERIVED_VARS},
                }
                values = row["values"]
                opening = int(values["inv_projection"][0])
                for var in DEMAND_VARS:
                    opening += int(values[var][0])
                for var in SUPPLY_VARS:
                    opening -= int(values[var][0])
                grouped[key]["opening"] = opening
            else:
                for var in VARIABLES:
                    if var in DERIVED_VARS:
                        continue
                    grouped[key]["values"][var] = [
                        a + b for a, b in zip(grouped[key]["values"][var], row["values"][var], strict=True)
                    ]
                values = row["values"]
                opening = int(values["inv_projection"][0])
                for var in DEMAND_VARS:
                    opening += int(values[var][0])
                for var in SUPPLY_VARS:
                    opening -= int(values[var][0])
                grouped[key]["opening"] += opening
        rows = []
        for group in grouped.values():
            vals = {var: list(group["values"][var]) for var in VARIABLES if var not in DERIVED_VARS}
            vals["inv_projection"] = _roll_inv_for_grain(grain, int(group["opening"]), vals)
            _attach_ss_metrics(vals)
            rows.append({**{k: group[k] for k in ("item", "vendor", "warehouse", "series", "division", "profile", "mb")}, "values": vals})
    rows.sort(key=lambda r: (str(r["item"]), str(r["vendor"]), str(r.get("warehouse", ""))))
    matched = len(rows)
    matched_items = len({r["item"] for r in rows})
    if limit > 0:
        rows = rows[:limit]
    returned_items = len({r["item"] for r in rows})
    return {
        "weeks": WEEKS,
        "rows": rows,
        "filter_options": {
            **_sample_scoped_filter_options(
                all_rows,
                item=item,
                vendor=vendor,
                warehouse=warehouse,
                series=series,
                division=division,
                profile=profile,
                mb=mb,
                grain=grain,
            ),
            "risk_filters": list(RISK_FILTERS),
        },
        "total_rows": matched if _is_iv_grain(grain) else len(all_rows),
        "matched_rows": matched,
        "returned_rows": len(rows),
        "matched_items": matched_items,
        "returned_items": returned_items,
        "grain": grain,
        "lock_weeks_by_warehouse": {},
        "freshness": {
            "source": "Sample data",
            "updated_at": utc_now(),
            "status": "Fallback",
            "row_groups": len(all_rows),
            "week_count": len(WEEKS),
        },
    }


def _query_iv_from_whse_mb(
    whse: "ProjectionStore",
    *,
    item: str | list[str] = "",
    vendor: str | list[str] = "",
    series: str | list[str] = "",
    division: str | list[str] = "",
    profile: str | list[str] = "",
    mb: str | list[str] = "",
    risk_filter: str | list[str] = "",
    limit: int = 100,
    grain: str = "item_vendor",
) -> dict[str, Any]:
    """Item×vendor view filtered by MB must roll up matching warehouses only."""
    import numpy as np

    mask = whse._mask(item, vendor, "", series, division, profile, mb)
    selected_risks = set(_filter_values(risk_filter)) & set(RISK_FILTERS)
    if selected_risks:
        risk_routes = _risk_records_from_store(
            whse,
            item=item,
            vendor=vendor,
            risk_filter=risk_filter,
        )
        allowed = {
            (record["item"], record["vendor"], record["warehouse"])
            for record in risk_routes
        }
        route_keys = zip(
            whse.meta["item"].to_numpy(),
            whse.meta["vendor"].to_numpy(),
            whse.meta["whse"].to_numpy(),
        )
        mask &= np.fromiter(
            ((item_id, vendor_id, whse_id) in allowed for item_id, vendor_id, whse_id in route_keys),
            dtype=bool,
            count=whse.n,
        )
    idxs = np.flatnonzero(mask)
    n_weeks = len(whse.weeks)
    groups: dict[tuple[str, str], dict[str, Any]] = {}
    for i in idxs:
        i = int(i)
        item_id = str(whse.meta.at[i, "item"])
        vendor_id = str(whse.meta.at[i, "vendor"])
        key = (item_id, vendor_id)
        group = groups.get(key)
        if group is None:
            group = {
                "item": item_id,
                "vendor": vendor_id,
                "warehouse": "ALL",
                "series": str(whse.meta.at[i, "Series"]),
                "division": str(whse.meta.at[i, "AFI Finance Division"]),
                "profile": str(whse.meta.at[i, "ProdResourceID"]),
                "mbs": set(),
                "vnames": set(),
                "opening": 0,
                "values": {var: np.zeros(n_weeks, dtype="int64") for var in VARIABLES if var not in DERIVED_VARS},
            }
            groups[key] = group
        values = {var: whse.values[var][i] for var in VARIABLES if var not in DERIVED_VARS}
        opening = int(values["inv_projection"][0])
        for var in DEMAND_VARS:
            opening += int(values[var][0])
        for var in SUPPLY_VARS:
            opening -= int(values[var][0])
        group["opening"] += opening
        for var in VARIABLES:
            if var in DERIVED_VARS:
                continue
            group["values"][var] += values[var]
        raw_mb = str(whse.meta.at[i, "MB"] or "").strip()
        if raw_mb:
            for part in raw_mb.split("|"):
                token = part.strip()
                if token:
                    group["mbs"].add(token)
        raw_vn = str(whse.meta.at[i, "VNAME (dual1)"] or "").strip()
        if raw_vn:
            group["vnames"].add(raw_vn)

    rows: list[dict] = []
    for key in sorted(groups):
        group = groups[key]
        vals = {var: group["values"][var].astype(int).tolist() for var in VARIABLES if var not in DERIVED_VARS}
        vals["inv_projection"] = _roll_inv_for_grain(grain, int(group["opening"]), vals)
        _attach_ss_metrics(vals)
        rows.append(
            {
                "item": group["item"],
                "vendor": group["vendor"],
                "warehouse": "ALL",
                "series": group["series"],
                "division": group["division"],
                "profile": group["profile"],
                "mb": "|".join(sorted(group["mbs"])),
                "vname_dual": ", ".join(group["vnames"]),
                "values": vals,
            }
        )

    total_match = len(rows)
    matched_items = len({r["item"] for r in rows})
    if limit > 0:
        rows = rows[:limit]
    returned_items = len({r["item"] for r in rows})

    meta = _read_meta(grain)
    mtime = _source_mtime(_whse_grain_for(grain))
    updated = (
        str(meta.get("updated_at"))
        if meta.get("updated_at")
        else datetime.fromtimestamp(mtime, tz=UTC).strftime("%Y-%m-%d %H:%M UTC")
        if mtime
        else utc_now()
    )
    filter_options = whse._scoped_filter_options(
        item=item,
        vendor=vendor,
        warehouse="",
        series=series,
        division=division,
        profile=profile,
        mb=mb,
    )
    filter_options["warehouses"] = []
    filter_options["risk_filters"] = list(RISK_FILTERS)
    return {
        "weeks": whse.weeks,
        "rows": rows,
        "filter_options": filter_options,
        "total_rows": whse.n,
        "matched_rows": total_match,
        "returned_rows": len(rows),
        "matched_items": matched_items,
        "returned_items": returned_items,
        "grain": grain,
        "lock_weeks_by_warehouse": {},
        "freshness": {
            "source": str(meta.get("source") or f"Notebook export ({grain})"),
            "updated_at": updated,
            "status": str(meta.get("status") or "Fresh"),
            "row_groups": int(meta.get("row_groups") or total_match),
            "week_count": int(meta.get("week_count") or len(whse.weeks)),
        },
    }


def load_projection_dashboard(
    *,
    item: str | list[str] = "",
    vendor: str | list[str] = "",
    warehouse: str | list[str] = "",
    series: str | list[str] = "",
    division: str | list[str] = "",
    profile: str | list[str] = "",
    mb: str | list[str] = "",
    risk_filter: str | list[str] = "",
    limit: int = 100,
    grain: str = "whse",
) -> dict[str, Any]:
    """Prefer notebook export under data/; fall back to embedded sample."""
    grain = _normalize_grain(grain)
    if _is_iv_grain(grain) and (_filter_values(mb) or _filter_values(risk_filter)):
        whse = get_projection_store(grain=_whse_grain_for(grain))
        if whse is not None:
            try:
                return _query_iv_from_whse_mb(
                    whse,
                    item=item,
                    vendor=vendor,
                    series=series,
                    division=division,
                    profile=profile,
                    mb=mb,
                    risk_filter=risk_filter,
                    limit=limit,
                    grain=grain,
                )
            except Exception as exc:
                logger.exception("IV+MB projection query failed")
                raise HTTPException(
                    status_code=503,
                    detail=(
                        f"Could not read the {grain} projection cache "
                        f"({type(exc).__name__}: {exc}). Re-run the notebook EXPORT cell, "
                        "then use Refresh data."
                    ),
                ) from exc
    store = get_projection_store(grain=grain)
    if store is None:
        return sample_dashboard(
            item=item,
            vendor=vendor,
            warehouse=warehouse,
            series=series,
            division=division,
            profile=profile,
            mb=mb,
            risk_filter=risk_filter,
            limit=limit,
            grain=grain,
        )
    try:
        return store.query(
            item=item,
            vendor=vendor,
            warehouse="" if _is_iv_grain(grain) else warehouse,
            series=series,
            division=division,
            profile=profile,
            mb=mb,
            risk_filter=risk_filter,
            limit=limit,
        )
    except Exception as exc:
        # Never fall back to sample rows here: that silently drops every filter
        # and shows plausible-looking numbers from the wrong dataset.
        logger.exception("Projection query failed (grain=%s)", grain)
        raise HTTPException(
            status_code=503,
            detail=(
                f"Could not read the {grain} projection cache "
                f"({type(exc).__name__}: {exc}). Re-run the notebook EXPORT cell, "
                "then use Refresh data."
            ),
        ) from exc


class NoteCreate(BaseModel):
    item: str
    vendor: str
    warehouse: str
    week: str
    category: str
    priority: Literal["Low", "Medium", "High", "Critical"]
    body: str = Field(min_length=4, max_length=1000)
    owner: str = Field(min_length=2, max_length=80)


class NoteStatus(BaseModel):
    status: Literal["Open", "Reviewed", "Resolved"]
    actor: str = Field(min_length=2, max_length=80)


@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={"asset_version": asset_version()},
    )


@app.get("/api/dashboard")
def dashboard(
    item: Annotated[list[str] | None, Query()] = None,
    vendor: Annotated[list[str] | None, Query()] = None,
    warehouse: Annotated[list[str] | None, Query()] = None,
    series: Annotated[list[str] | None, Query()] = None,
    division: Annotated[list[str] | None, Query()] = None,
    profile: Annotated[list[str] | None, Query()] = None,
    mb: Annotated[list[str] | None, Query()] = None,
    risk_filter: Annotated[list[str] | None, Query()] = None,
    limit: int = 100,
    grain: str = "whse",
):
    return load_projection_dashboard(
        item=item or [],
        vendor=vendor or [],
        warehouse=warehouse or [],
        series=series or [],
        division=division or [],
        profile=profile or [],
        mb=mb or [],
        risk_filter=risk_filter or [],
        limit=0 if limit <= 0 else min(limit, 100_000),
        grain=(grain or "whse").strip() or "whse",
    )


@app.get("/api/risk-items")
def risk_items(
    item: Annotated[list[str] | None, Query()] = None,
    vendor: Annotated[list[str] | None, Query()] = None,
    warehouse: Annotated[list[str] | None, Query()] = None,
    series: Annotated[list[str] | None, Query()] = None,
    profile: Annotated[list[str] | None, Query()] = None,
    division: Annotated[list[str] | None, Query()] = None,
    risk_filter: Annotated[list[str] | None, Query()] = None,
    grain: str = "whse",
    limit: int = 100,
):
    return load_risk_items(
        item=item or [],
        vendor=vendor or [],
        warehouse=warehouse or [],
        series=series or [],
        profile=profile or [],
        division=division or [],
        risk_filter=risk_filter or [],
        grain=(grain or "whse").strip() or "whse",
        limit=0 if limit <= 0 else min(limit, 100_000),
    )


@app.post("/api/refresh")
def refresh_projection_cache():
    """Force re-read of notebook export files on the next /api/dashboard call."""
    return clear_projection_stores()

@app.get("/api/notes")
def list_notes():
    with closing(connect()) as conn:
        notes = [dict(row) for row in conn.execute("SELECT * FROM notes ORDER BY updated_at DESC, id DESC")]
    return {"notes": notes}


@app.post("/api/notes", status_code=201)
def create_note(note: NoteCreate):
    now = utc_now()
    with closing(connect()) as conn:
        cursor = conn.execute(
            """
            INSERT INTO notes
            (item, vendor, warehouse, week, category, priority, body, owner, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Open', ?, ?)
            """,
            (
                note.item.strip(),
                note.vendor.strip(),
                note.warehouse.strip(),
                note.week,
                note.category,
                note.priority,
                note.body.strip(),
                note.owner.strip(),
                now,
                now,
            ),
        )
        conn.commit()
        created = dict(conn.execute("SELECT * FROM notes WHERE id = ?", (cursor.lastrowid,)).fetchone())
    audit("Note created", note.owner, f"{note.item} / {note.warehouse} / {note.week}")
    return created


@app.patch("/api/notes/{note_id}")
def update_note_status(note_id: int, update: NoteStatus):
    now = utc_now()
    with closing(connect()) as conn:
        found = conn.execute("SELECT item, warehouse, week FROM notes WHERE id = ?", (note_id,)).fetchone()
        if not found:
            raise HTTPException(status_code=404, detail="Note not found")
        conn.execute("UPDATE notes SET status = ?, updated_at = ? WHERE id = ?", (update.status, now, note_id))
        conn.commit()
    audit("Note status updated", update.actor, f"#{note_id} → {update.status}")
    return {"ok": True}


@app.post("/api/imports", status_code=201)
async def create_import(file: UploadFile, actor: str = "Planner"):
    allowed = {".csv", ".xlsx", ".xls"}
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in allowed:
        raise HTTPException(status_code=422, detail="Use a CSV or Excel file.")
    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=422, detail="The selected file is empty.")
    now = utc_now()
    with closing(connect()) as conn:
        cursor = conn.execute(
            """
            INSERT INTO import_jobs (filename, source, status, row_count, submitted_by, submitted_at)
            VALUES (?, 'Supplemental upload', 'Validated', ?, ?, ?)
            """,
            (file.filename, 0, actor, now),
        )
        conn.commit()
        job = dict(conn.execute("SELECT * FROM import_jobs WHERE id = ?", (cursor.lastrowid,)).fetchone())
    audit("Import validated", actor, file.filename or "Unnamed import")
    return {
        "job": job,
        "validation": {
            "valid": True,
            "message": "File structure is accepted. Review mapping before applying it to a production pipeline.",
            "warnings": ["Sample app: uploaded values are not applied to the baseline projection."],
        },
    }


@app.get("/api/imports")
def list_imports():
    with closing(connect()) as conn:
        jobs = [dict(row) for row in conn.execute("SELECT * FROM import_jobs ORDER BY id DESC")]
    return {"jobs": jobs}


@app.get("/api/audit")
def audit_log():
    with closing(connect()) as conn:
        records = [dict(row) for row in conn.execute("SELECT * FROM audit_log ORDER BY id DESC LIMIT 50")]
    return {"records": records}


@app.get("/api/users")
def users():
    return {
        "users": [
            {"name": "Minh Tran", "role": "Planner", "scope": "624556 · 335", "status": "Active"},
            {"name": "Linh Nguyen", "role": "Planner", "scope": "600039 · ECR", "status": "Active"},
            {"name": "Tuan Pham", "role": "Manager", "scope": "All vendor groups", "status": "Active"},
            {"name": "Admin", "role": "Admin", "scope": "System configuration", "status": "Active"},
        ]
    }
