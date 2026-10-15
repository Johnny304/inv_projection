"""Build a static Netlify publish folder from notebook export files.

Usage (from inv_projection/, with venv active):
    python scripts/build_netlify.py

Writes netlify_dist/ — deploy with DEPLOY_NETLIFY.bat (netlify CLI).
Does not connect to company servers; reads local data/ only.
"""

from __future__ import annotations

import gzip
import json
import os
import re
import shutil
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "netlify_dist"
STATIC_SRC = ROOT / "static"
TEMPLATE = ROOT / "templates" / "index.html"
DATA_OUT = DIST / "data"

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app import VARIABLES, get_projection_store, _read_meta  # noqa: E402


def _utc_stamp() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")


def _write_grain(store, grain_key: str, build_id: str) -> dict:
    """Serialize one ProjectionStore into routes JSON + gzipped int32 values."""
    import numpy as np

    n = store.n
    weeks = list(store.weeks)
    n_weeks = len(weeks)
    meta = store.meta

    routes = [
        [
            str(meta.at[i, "item"]),
            str(meta.at[i, "vendor"]),
            str(meta.at[i, "whse"]),
            str(meta.at[i, "Series"]),
            str(meta.at[i, "AFI Finance Division"]),
            str(meta.at[i, "ProdResourceID"]),
            str(meta.at[i, "MB"] if "MB" in meta.columns else ""),
            str(meta.at[i, "VNAME (dual1)"] if "VNAME (dual1)" in meta.columns else ""),
        ]
        for i in range(n)
    ]

    # Contiguous int32 LE: for each variable, n * n_weeks values.
    parts = []
    for var in VARIABLES:
        arr = np.ascontiguousarray(store.values[var], dtype=np.int32)
        if arr.shape != (n, n_weeks):
            raise ValueError(f"{grain_key}/{var}: expected {(n, n_weeks)}, got {arr.shape}")
        parts.append(arr.reshape(-1))
    flat = np.concatenate(parts)
    raw = flat.tobytes(order="C")
    gz = gzip.compress(raw, compresslevel=6)

    routes_name = f"{grain_key}.routes.json"
    values_name = f"{grain_key}.values.bin.gz"
    (DATA_OUT / routes_name).write_text(json.dumps(routes, separators=(",", ":")), encoding="utf-8")
    (DATA_OUT / values_name).write_bytes(gz)

    freshness = store.query(limit=1)["freshness"]
    freshness = {
        **freshness,
        "source": f"{freshness.get('source') or 'Notebook export'} · Netlify snapshot",
        "status": freshness.get("status") or "Fresh",
    }
    lock_weeks = {}
    if grain_key in ("whse", "etd_whse"):
        meta = _read_meta("whse")
        lock_weeks = {
            str(whse): [str(week) for week in week_list]
            for whse, week_list in (meta.get("lock_weeks_by_warehouse") or {}).items()
            if week_list
        }

    grain_meta = _read_meta(grain_key)
    si_mode = str(grain_meta.get("si_mode") or ("etd" if grain_key.startswith("etd") else "eta"))
    try:
        roll_from_index = int(grain_meta.get("roll_from_index"))
    except (TypeError, ValueError):
        roll_from_index = 2 if grain_key.startswith("etd") else 0

    return {
        "grain": grain_key,
        "weeks": weeks,
        "n": n,
        "variables": list(VARIABLES),
        "routesUrl": f"data/{routes_name}",
        "valuesUrl": f"data/{values_name}",
        "valuesBytes": len(raw),
        "valuesGzipBytes": len(gz),
        "freshness": freshness,
        "lock_weeks_by_warehouse": lock_weeks,
        "si_mode": si_mode,
        "roll_from_index": roll_from_index,
        "anchor_week": grain_meta.get("anchor_week"),
        "first_roll_week": grain_meta.get("first_roll_week"),
        "buildId": build_id,
    }


def _render_index(asset_version: str) -> str:
    html = TEMPLATE.read_text(encoding="utf-8")
    html = html.replace("{{ asset_version }}", asset_version)
    # Inject static API before app scripts; mark body for CSS hooks.
    html = html.replace("<body>", '<body class="netlify-static">', 1)
    inject = (
        f'  <script>window.__NETLIFY_STATIC__=true;window.__NETLIFY_BUILD__={json.dumps(asset_version)};</script>\n'
        f'  <script src="/static/static-projection-api.js?v={asset_version}"></script>\n'
    )
    html = html.replace(
        f'  <script src="/static/projection-core.js?v={asset_version}"></script>',
        inject + f'  <script src="/static/projection-core.js?v={asset_version}"></script>',
        1,
    )
    # Refresh data needs local FastAPI; hide on static Netlify build.
    html = re.sub(
        r'<button class="data-refresh"[^>]*>',
        '<button class="data-refresh" id="data-refresh" type="button" hidden disabled '
        'aria-disabled="true" title="Update by re-deploying from local EXPORT">',
        html,
        count=1,
    )
    return html


def _copy_static(asset_version: str) -> None:
    dest = DIST / "static"
    _clear_dir(dest)
    shutil.copytree(STATIC_SRC, dest, dirs_exist_ok=True)
    # Drop Python caches if any slipped in.
    for junk in dest.rglob("__pycache__"):
        shutil.rmtree(junk, ignore_errors=True)


def _copy_docs() -> None:
    """Publish the canonical product docs linked from the Read Me view."""
    dest = DIST / "docs"
    dest.mkdir(parents=True, exist_ok=True)
    doc_names = [
        "README.md",
        "Architecture.md",
        "Core logic.md",
        "Data.md",
        "Interface.md",
        "Runbook.md",
        "User guide.md",
    ]
    for name in doc_names:
        source = ROOT / "docs" / name
        if source.exists():
            shutil.copy2(source, dest / name)


def _clear_dir(path: Path) -> None:
    """Remove publish folder; tolerate OneDrive locks with retries."""
    if not path.exists():
        return
    for _ in range(5):
        try:
            shutil.rmtree(path, ignore_errors=False)
            if not path.exists():
                return
        except OSError:
            time.sleep(0.4)
    # Fallback: delete files individually, leave stubborn dirs.
    for root, dirs, files in os.walk(path, topdown=False):
        for name in files:
            try:
                Path(root, name).unlink(missing_ok=True)
            except OSError:
                pass
        for name in dirs:
            try:
                Path(root, name).rmdir()
            except OSError:
                pass
    try:
        path.rmdir()
    except OSError:
        pass


def build() -> Path:
    build_id = str(int(time.time()))
    print(f"Building Netlify dist -> {DIST}")
    _clear_dir(DIST)
    DATA_OUT.mkdir(parents=True, exist_ok=True)

    grains = {}
    for grain_key in ("whse", "item_vendor", "etd_whse", "etd_item_vendor"):
        store = get_projection_store(grain=grain_key)
        if store is None:
            if grain_key.startswith("etd_"):
                print(f"  skip {grain_key}: no ETD export yet (re-run notebook EXPORT)")
                continue
            label = "item×vendor" if grain_key == "item_vendor" else "warehouse"
            raise SystemExit(f"Missing {label} matrix in data/. Run notebook EXPORT first.")
        print(f"  {grain_key} routes: {store.n:,}  weeks: {len(store.weeks)}")
        grains[grain_key] = _write_grain(store, grain_key, build_id)
    manifest = {
        "buildId": build_id,
        "builtAt": _utc_stamp(),
        "variables": list(VARIABLES),
        "grains": grains,
    }
    (DATA_OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    _copy_static(build_id)
    _copy_docs()
    (DIST / "index.html").write_text(_render_index(build_id), encoding="utf-8")

    # Keep /data and /static as real files. Catch-all last (no !) so existing
    # files still shadow. identity encoding keeps .bin.gz compressed for JS.
    (DIST / "_redirects").write_text(
        "\n".join(
            [
                "/data/*     /data/:splat     200",
                "/static/*   /static/:splat   200",
                "/docs/*     /docs/:splat     200",
                "/*          /index.html      200",
                "",
            ]
        ),
        encoding="utf-8",
    )
    (DIST / "_headers").write_text(
        "\n".join(
            [
                "/data/*",
                "  Cache-Control: public, max-age=3600",
                "/static/*",
                "  Cache-Control: public, max-age=31536000, immutable",
                "/data/*.bin.gz",
                "  Content-Type: application/octet-stream",
                "  Content-Encoding: identity",
                "",
            ]
        ),
        encoding="utf-8",
    )

    (DIST / "README_DEPLOY.txt").write_text(
        "Built locally. Deploy ONLY with:\n"
        "  DEPLOY_NETLIFY.bat\n"
        "or:\n"
        "  netlify deploy --prod --dir=netlify_dist\n"
        "Do not use Git publish — netlify_dist is gitignored, so the live site\n"
        "would have the UI but no /data files.\n"
        "Check after deploy: https://<site>/data/manifest.json must be JSON.\n"
        "Enable Netlify password / visitor access — data is internal.\n",
        encoding="utf-8",
    )

    total = sum(p.stat().st_size for p in DIST.rglob("*") if p.is_file())
    print(f"Done. dist size ~ {total / (1024 * 1024):.1f} MB  buildId={build_id}")
    for grain_key, info in grains.items():
        print(f"  {grain_key} values gzip: {info['valuesGzipBytes'] / (1024 * 1024):.1f} MB")
    return DIST


if __name__ == "__main__":
    build()
