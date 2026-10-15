"""Notebook EXPORT helper: roll SI and write warehouse + item×vendor matrices.

Called from inv_prj.ipynb (ETA and ETD). Do not run this module against company servers.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

DATE_COL_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

DATA_TYPE_MAP = {
    "FIRM DEMANDS": "firm_demand",
    "FIRM TRF OUT": "firm_trf_out",
    "NET FCST": "net_fcst",
    "PLANNED TRF OUT": "planned_trf_out",
    "INTRANSIT TRF IN": "intransit_trf_in",
    "ON ORDER TRF IN": "on_order_trf_in",
    "PLANNED POS": "planned_pos",
    "PLANNED TRF IN": "planned_trf_in",
    "FIRM POS": "firm_pos",
    "FIRM PROD": "firm_prod",
    "PLANNED PROD": "planned_prod",
    "PROMOTIONAL LIFT": "promotional_lift",
    "SAFETY STK": "safety_stock",
    "PLANNED PO + Vendor (dual1)": "planned_po_dual",
    "FIRM PO + Vendor (dual1)": "firm_po_dual",
}
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
SI_VARS = DEMAND_VARS + SUPPLY_VARS
DISPLAY_VARS = ["promotional_lift", "safety_stock", "planned_po_dual", "firm_po_dual"]
MATRIX_VARS = SI_VARS + DISPLAY_VARS + ["inv_projection", "ss_pct", "si_ss"]

PROFILE_COLS = [
    "ProdResourceID",
    "Series",
    "Collective Class",
    "AFI Finance Division",
    "Current Status",
    "Future Status",
    "MB",
    "VNAME (dual1)",
]
IDENTITY_COLS = {
    "ProdResourceID",
    "Series",
    "Item #",
    "Whse",
    "Data type",
    "Snapshot Date",
    "Collective Class",
    "AFI Finance Division",
    "Primary Vendor",
    "Current Status",
    "Future Status",
    "HB",
    "MB",
    "VNAME (dual1)",
}


ETD_ROLL_FROM_INDEX = 2


def _roll_si(opening: np.ndarray, supply: np.ndarray, demand: np.ndarray) -> np.ndarray:
    """ETA: opening is per-route; supply/demand are (n_routes, n_weeks)."""
    n_routes, n_weeks = supply.shape
    out = np.empty((n_routes, n_weeks), dtype="float64")
    running = opening.astype("float64", copy=True)
    for week_i in range(n_weeks):
        running = running + supply[:, week_i] - demand[:, week_i]
        out[:, week_i] = running
    return out


def _roll_si_etd(shippable: np.ndarray, supply: np.ndarray, demand: np.ndarray) -> np.ndarray:
    """ETD: copy SHIPPABLE INV on W-1 and W1; roll from W2 using SHIPPABLE(W1)."""
    n_routes, n_weeks = supply.shape
    if n_weeks < ETD_ROLL_FROM_INDEX + 1:
        raise ValueError("ETD export needs at least 3 weeks after clip (W-1, W1, W2).")
    out = np.empty((n_routes, n_weeks), dtype="float64")
    out[:, 0] = shippable[:, 0]
    out[:, 1] = shippable[:, 1]
    running = shippable[:, 1].astype("float64", copy=True)
    for week_i in range(ETD_ROLL_FROM_INDEX, n_weeks):
        running = running + supply[:, week_i] - demand[:, week_i]
        out[:, week_i] = running
    return out


def _normalize_week_key(value) -> str:
    parsed = pd.to_datetime(value, errors="coerce")
    if pd.isna(parsed):
        raise ValueError(f"Invalid clip_from_week: {value!r}")
    return pd.Timestamp(parsed).strftime("%Y-%m-%d")


def _attach_ss_planes(value_planes: dict[str, np.ndarray]) -> None:
    si = value_planes["inv_projection"]
    ss = value_planes["safety_stock"]
    ss_pct = np.full(si.shape, np.nan, dtype="float64")
    np.divide(si, ss, out=ss_pct, where=ss != 0)
    ss_pct *= 100.0
    value_planes["ss_pct"] = ss_pct
    value_planes["si_ss"] = si - ss


def _iso_week_columns(src: pd.DataFrame) -> pd.DataFrame:
    src = src.copy()
    src.columns = [str(c) for c in src.columns]
    renamed = {}
    for col in list(src.columns):
        if col in IDENTITY_COLS or DATE_COL_RE.match(col):
            continue
        parsed = pd.to_datetime(col, errors="coerce")
        if pd.notna(parsed):
            renamed[col] = pd.Timestamp(parsed).strftime("%Y-%m-%d")
    return src.rename(columns=renamed)


def _lock_weeks_by_warehouse(vendor_calendar_lt) -> dict[str, list[str]]:
    lock_weeks_by_warehouse: dict[str, list[str]] = {}
    if vendor_calendar_lt is None or not len(vendor_calendar_lt):
        return lock_weeks_by_warehouse
    _lock = vendor_calendar_lt.copy()
    _lock["whse"] = _lock["whse"].astype(str).str.strip()
    _lock_flag = _lock["Lockweek"].astype(str).str.strip().str.lower()
    _lock = _lock.loc[_lock_flag.eq("x")].copy()
    _lock["eta"] = pd.to_datetime(_lock["ETA"], errors="coerce").dt.strftime("%Y-%m-%d")
    _lock = _lock.dropna(subset=["eta"])
    for _whse, _grp in _lock.groupby("whse", sort=True):
        weeks_locked = sorted({str(w) for w in _grp["eta"].tolist() if w})
        if weeks_locked:
            lock_weeks_by_warehouse[str(_whse)] = weeks_locked
    return lock_weeks_by_warehouse


def _write_matrix(df: pd.DataFrame, parquet_path: Path, csv_path: Path) -> bool:
    try:
        df.to_parquet(parquet_path, index=False)
        parquet_ok = True
    except Exception as exc:
        parquet_ok = False
        print(f"Parquet skipped ({exc}); CSV will be used.")
    df.to_csv(csv_path, index=False)
    return parquet_ok


def export_projection(
    src_df: pd.DataFrame,
    *,
    stem: str,
    label: str,
    export_dir: Path,
    week_calendar=None,
    vendor_calendar_lt=None,
    clip_to_calendar: bool = True,
    include_lock: bool = True,
    source_name: str = "",
    si_mode: str = "eta",
    clip_from_week=None,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Roll SI from PDT-shaped wide matrix; write warehouse + item×vendor caches.

    stem examples:
      inv_projection_matrix      → ETA files + _iv
      inv_projection_matrix_etd  → ETD files + _etd_iv

    si_mode:
      eta — ON HAND at week 0 + Supply − Demand every week
      etd — SHIPPABLE INV on W-1 and W1; roll from W2 (clip_from_week required)
    """
    export_dir = Path(export_dir)
    export_dir.mkdir(parents=True, exist_ok=True)
    src_label = source_name or label
    mode = str(si_mode or "eta").strip().lower()
    if mode not in {"eta", "etd"}:
        raise ValueError(f"si_mode must be 'eta' or 'etd', got {si_mode!r}")

    src = _iso_week_columns(src_df)
    required = ["Item #", "Whse", "Primary Vendor", "Data type"]
    missing = [c for c in required if c not in src.columns]
    if missing:
        raise KeyError(f"{src_label} missing required columns: {missing}")

    week_cols_all = sorted(c for c in src.columns if DATE_COL_RE.match(str(c)))
    if not week_cols_all:
        raise ValueError(f"{src_label} has no weekly date columns to export.")

    if (
        clip_to_calendar
        and week_calendar is not None
        and "Wn" in getattr(week_calendar, "columns", [])
    ):
        valid = set(
            pd.to_datetime(week_calendar.loc[week_calendar["Wn"] >= 0, "Week_Ending"], errors="coerce")
            .dt.strftime("%Y-%m-%d")
            .dropna()
            .tolist()
        )
        week_cols = [c for c in week_cols_all if c in valid] or week_cols_all
    else:
        week_cols = week_cols_all

    if mode == "etd":
        if clip_from_week is None or str(clip_from_week).strip() == "":
            raise ValueError("ETD export requires clip_from_week (ETA W-1 Saturday).")
        start_week = _normalize_week_key(clip_from_week)
        week_cols = [c for c in week_cols if c >= start_week]
        if not week_cols:
            raise ValueError(
                f"ETD export has no week columns on or after clip_from_week={start_week}."
            )
        if week_cols[0] != start_week:
            print(
                f"ETD clip_from_week {start_week} not in matrix; first kept week is {week_cols[0]}"
            )
        if len(week_cols) < ETD_ROLL_FROM_INDEX + 1:
            raise ValueError("ETD export needs at least 3 weeks after clip (W-1, W1, W2).")

    src["item"] = src["Item #"].astype(str).str.strip()
    src["vendor"] = src["Primary Vendor"].astype(str).str.strip()
    src["whse"] = src["Whse"].astype(str).str.strip()
    if "MB" not in src.columns:
        src["MB"] = ""
    src["MB"] = src["MB"].fillna("").astype(str).str.strip()
    if "VNAME (dual1)" not in src.columns:
        src["VNAME (dual1)"] = ""
    src["VNAME (dual1)"] = (
        src["VNAME (dual1)"]
        .fillna("")
        .astype(str)
        .str.strip()
        .replace({"0": "", "0.0": "", "nan": "", "NaN": ""})
    )

    profile_cols = [c for c in PROFILE_COLS if c in src.columns]
    for col in profile_cols:
        if col == "VNAME (dual1)":
            continue
        src[col] = src[col].fillna("").astype(str).str.strip()

    if {"Series", "ProdResourceID"}.issubset(src.columns):
        _series_is_prod = src["Series"].astype(str).str.contains("PROD", case=False, na=False).mean()
        _prod_is_prod = src["ProdResourceID"].astype(str).str.contains("PROD", case=False, na=False).mean()
        if _series_is_prod > 0.5 and _prod_is_prod < 0.5:
            src["Series"], src["ProdResourceID"] = src["ProdResourceID"].copy(), src["Series"].copy()
            print(f"Fixed swapped Series <-> ProdResourceID in {src_label} before export")

    src["data_type"] = src["Data type"].astype(str).str.strip()
    src["variable"] = src["data_type"].map(DATA_TYPE_MAP)
    src.loc[src["data_type"].eq("ON HAND"), "variable"] = "_on_hand"
    src.loc[src["data_type"].eq("SHIPPABLE INV"), "variable"] = "_shippable"

    route_keys = ["item", "vendor", "whse"]
    group_profile_cols = [c for c in profile_cols if c != "VNAME (dual1)"]
    vname_by_route = (
        src.loc[src["VNAME (dual1)"].ne(""), [*route_keys, "VNAME (dual1)"]]
        .drop_duplicates(subset=route_keys, keep="first")
        .set_index(route_keys)["VNAME (dual1)"]
    )

    work = src.loc[
        src["variable"].notna(),
        [*route_keys, *group_profile_cols, "variable", *week_cols],
    ].copy()
    for col in week_cols:
        work[col] = pd.to_numeric(work[col], errors="coerce").fillna(0.0)

    work = (
        work.groupby([*route_keys, *group_profile_cols, "variable"], as_index=False)[week_cols]
        .sum()
    )

    routes = (
        work.drop_duplicates(subset=route_keys, keep="first")
        .loc[:, route_keys + group_profile_cols]
        .sort_values(route_keys, kind="mergesort")
        .reset_index(drop=True)
    )
    if "VNAME (dual1)" in profile_cols:
        routes["VNAME (dual1)"] = (
            pd.MultiIndex.from_frame(routes[route_keys]).map(vname_by_route).fillna("").astype(str)
        )
        routes = routes.loc[:, [c for c in (route_keys + profile_cols) if c in routes.columns]]

    def _matrix_for(variable: str) -> np.ndarray:
        sub = work.loc[work["variable"].eq(variable), route_keys + week_cols]
        if sub.empty:
            return np.zeros((len(routes), len(week_cols)), dtype="float64")
        grouped = sub.groupby(route_keys, sort=False)[week_cols].sum()
        grouped = grouped.reindex(pd.MultiIndex.from_frame(routes[route_keys]))
        arr = grouped[week_cols].to_numpy(dtype="float64", copy=True)
        np.nan_to_num(arr, copy=False, nan=0.0)
        return arr

    on_hand = _matrix_for("_on_hand")
    shippable = _matrix_for("_shippable")

    supply = np.zeros((len(routes), len(week_cols)), dtype="float64")
    demand = np.zeros((len(routes), len(week_cols)), dtype="float64")
    value_planes: dict[str, np.ndarray] = {}
    for var in SI_VARS + DISPLAY_VARS:
        plane = _matrix_for(var)
        value_planes[var] = plane
        if var in SUPPLY_VARS:
            supply += plane
        if var in DEMAND_VARS:
            demand += plane
    if mode == "etd":
        value_planes["inv_projection"] = _roll_si_etd(shippable, supply, demand)
    else:
        value_planes["inv_projection"] = _roll_si(on_hand[:, 0].copy(), supply, demand)
    _attach_ss_planes(value_planes)

    frames = []
    for var in MATRIX_VARS:
        frame = routes.copy()
        frame["variable"] = var
        for week_i, week in enumerate(week_cols):
            frame[week] = value_planes[var][:, week_i]
        frames.append(frame)

    export_df = pd.concat(frames, ignore_index=True)
    for col in week_cols:
        export_df[col] = pd.to_numeric(export_df[col], errors="coerce")
    _got = set(export_df["variable"].astype(str).unique())
    if _got != set(MATRIX_VARS):
        raise ValueError(f"export_df variables {sorted(_got)} != MATRIX_VARS {MATRIX_VARS}")

    iv_routes = (
        routes.sort_values(["item", "vendor", "whse"], kind="mergesort")
        .drop_duplicates(subset=["item", "vendor"], keep="first")
        .loc[:, ["item", "vendor", *profile_cols]]
        .reset_index(drop=True)
    )
    iv_routes["whse"] = "ALL"
    if "MB" in routes.columns:
        _iv_mb = (
            routes.assign(_mb=routes["MB"].astype(str).str.strip())
            .loc[lambda d: d["_mb"].ne(""), ["item", "vendor", "_mb"]]
            .drop_duplicates()
            .groupby(["item", "vendor"], sort=False)["_mb"]
            .agg(lambda s: "|".join(sorted(set(s))))
        )
        iv_routes["MB"] = (
            pd.MultiIndex.from_frame(iv_routes[["item", "vendor"]]).map(_iv_mb).fillna("").astype(str)
        )
    if "VNAME (dual1)" in routes.columns:
        _iv_vn = (
            routes.assign(_vn=routes["VNAME (dual1)"].astype(str).str.strip())
            .loc[lambda d: d["_vn"].ne(""), ["item", "vendor", "_vn"]]
            .drop_duplicates()
            .groupby(["item", "vendor"], sort=False)["_vn"]
            .agg(lambda s: ", ".join(dict.fromkeys(s)))
        )
        iv_routes["VNAME (dual1)"] = (
            pd.MultiIndex.from_frame(iv_routes[["item", "vendor"]]).map(_iv_vn).fillna("").astype(str)
        )

    iv_index = pd.MultiIndex.from_frame(iv_routes[["item", "vendor"]])
    iv_planes: dict[str, np.ndarray] = {}
    iv_source_vars = SI_VARS + DISPLAY_VARS + ["_on_hand"]
    if mode == "etd":
        iv_source_vars = iv_source_vars + ["_shippable"]
    for var in iv_source_vars:
        if var == "_on_hand":
            plane = on_hand
        elif var == "_shippable":
            plane = shippable
        else:
            plane = value_planes[var]
        tmp = routes[["item", "vendor"]].copy()
        for week_i, week in enumerate(week_cols):
            tmp[week] = plane[:, week_i]
        summed = tmp.groupby(["item", "vendor"], as_index=True)[week_cols].sum()
        iv_planes[var] = summed.reindex(iv_index).to_numpy(dtype="float64", copy=True)
        np.nan_to_num(iv_planes[var], copy=False, nan=0.0)

    iv_supply = np.zeros((len(iv_routes), len(week_cols)), dtype="float64")
    iv_demand = np.zeros((len(iv_routes), len(week_cols)), dtype="float64")
    for var in SUPPLY_VARS:
        iv_supply += iv_planes[var]
    for var in DEMAND_VARS:
        iv_demand += iv_planes[var]
    if mode == "etd":
        iv_planes["inv_projection"] = _roll_si_etd(iv_planes["_shippable"], iv_supply, iv_demand)
    else:
        iv_planes["inv_projection"] = _roll_si(
            iv_planes["_on_hand"][:, 0].copy(), iv_supply, iv_demand
        )
    _attach_ss_planes(iv_planes)

    iv_frames = []
    for var in MATRIX_VARS:
        frame = iv_routes.copy()
        frame["variable"] = var
        for week_i, week in enumerate(week_cols):
            frame[week] = iv_planes[var][:, week_i]
        iv_frames.append(frame)
    export_iv = pd.concat(iv_frames, ignore_index=True)
    for col in week_cols:
        export_iv[col] = pd.to_numeric(export_iv[col], errors="coerce")
    _got_iv = set(export_iv["variable"].astype(str).unique())
    if _got_iv != set(MATRIX_VARS):
        raise ValueError(f"export_iv variables {sorted(_got_iv)} != MATRIX_VARS {MATRIX_VARS}")

    lock_weeks_by_warehouse = (
        _lock_weeks_by_warehouse(vendor_calendar_lt) if include_lock else {}
    )

    si_meta = {"si_mode": mode, "anchor_week": str(week_cols[0])}
    if mode == "etd":
        si_meta["first_roll_week"] = str(week_cols[ETD_ROLL_FROM_INDEX])
        si_meta["roll_from_index"] = ETD_ROLL_FROM_INDEX
    else:
        si_meta["first_roll_week"] = str(week_cols[0])
        si_meta["roll_from_index"] = 0

    parquet_path = export_dir / f"{stem}.parquet"
    csv_path = export_dir / f"{stem}.csv"
    meta_stem = stem.replace("matrix", "meta", 1)
    meta_path = export_dir / f"{meta_stem}.json"
    parquet_ok = _write_matrix(export_df, parquet_path, csv_path)

    group_n = int(export_df.drop_duplicates(subset=["item", "vendor", "whse"]).shape[0])
    meta = {
        "source": f"Notebook export ({src_label} {label})",
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "status": "Fresh",
        "grain": "whse",
        "axis": label,
        "row_groups": group_n,
        "matrix_rows": int(len(export_df)),
        "week_count": int(len(week_cols)),
        "weeks": [str(w) for w in week_cols],
        "lock_weeks_by_warehouse": lock_weeks_by_warehouse,
        **si_meta,
        "files": {
            "parquet": parquet_path.name if parquet_ok else None,
            "csv": csv_path.name,
        },
    }
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    _dual = export_df.loc[export_df["variable"].eq("planned_po_dual")]
    if not _dual.empty:
        _dual_qty = float(pd.to_numeric(_dual[week_cols].stack(), errors="coerce").fillna(0).sum())
        _dual_named = int(_dual["VNAME (dual1)"].astype(str).str.strip().ne("").sum()) if "VNAME (dual1)" in _dual.columns else 0
        print(
            f"Dual source Planned PO qty={_dual_qty:,.0f}; "
            f"routes with secondary vendor name={_dual_named:,}"
        )
    print(f"Exported {label} {group_n:,} item×vendor×whse routes × {len(week_cols)} weeks")
    if mode == "etd":
        print(
            f"ETD SI: W-1={week_cols[0]} W1={week_cols[1]} "
            f"roll from W2={week_cols[ETD_ROLL_FROM_INDEX]}"
        )
    print(f"Lock warehouses: {len(lock_weeks_by_warehouse):,}")
    print(f"CSV: {csv_path}")
    if parquet_ok:
        print(f"Parquet: {parquet_path}")
    print(f"Meta: {meta_path}")

    iv_stem = f"{stem}_iv"
    parquet_iv = export_dir / f"{iv_stem}.parquet"
    csv_iv = export_dir / f"{iv_stem}.csv"
    meta_iv_path = export_dir / f"{meta_stem}_iv.json"
    parquet_iv_ok = _write_matrix(export_iv, parquet_iv, csv_iv)

    group_iv = int(export_iv.drop_duplicates(subset=["item", "vendor"]).shape[0])
    meta_iv = {
        "source": f"Notebook export ({src_label} {label} item×vendor)",
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "status": "Fresh",
        "grain": "item_vendor",
        "axis": label,
        "row_groups": group_iv,
        "matrix_rows": int(len(export_iv)),
        "week_count": int(len(week_cols)),
        "weeks": [str(w) for w in week_cols],
        "lock_weeks_by_warehouse": {},
        **si_meta,
        "files": {
            "parquet": parquet_iv.name if parquet_iv_ok else None,
            "csv": csv_iv.name,
        },
    }
    meta_iv_path.write_text(json.dumps(meta_iv, indent=2), encoding="utf-8")
    print(f"Exported {label} IV {group_iv:,} item×vendor routes × {len(week_cols)} weeks")
    print(f"IV CSV: {csv_iv}")
    if parquet_iv_ok:
        print(f"IV Parquet: {parquet_iv}")
    print(f"IV Meta: {meta_iv_path}")
    return export_df, export_iv
