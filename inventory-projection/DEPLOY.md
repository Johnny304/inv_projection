# Inventory Projection

Weekly inventory projection for in-house planners. The website shows the last exported snapshot. It does not open a live connection to EDW.

## Run

From this folder, with the Python packages in `requirements.txt` installed:

```bat
uvicorn app:app --host 0.0.0.0 --port 8780
```

`START_SERVER.bat` binds `127.0.0.1:8780`. `START_SERVER_LAN.bat` binds `0.0.0.0:8780` so other PCs on the same network can open it. `ALLOW_FIREWALL.bat` opens that port on the local Windows firewall and must be run as administrator once.

## Data

GitHub does not contain the projection data. The app reads files next to itself.

Projection snapshot, written by the EXPORT cells in `inv_prj.ipynb` after that notebook reads EDW on a planner laptop:

- `data/inv_projection_matrix.parquet` and `data/inv_projection_matrix_iv.parquet` (ETA, warehouse and item × vendor)
- `data/inv_projection_matrix_etd.parquet` and `data/inv_projection_matrix_etd_iv.parquet` (ETD, same two grains)
- matching `data/inv_projection_meta*.json` files
- CSV files with the same names are the fallback if a parquet file is missing

Planner notes, import jobs, and the audit log are in `inventory_collaboration.db` (SQLite) beside `app.py`. The app creates that file on first use.

`inv_prj.ipynb` signs in to EDW with Azure AD integrated authentication. Set `EDW_USERNAME` in a local `.env` (see `.env.example`). Do not commit `.env`.

## Current publish path

`DEPLOY_NETLIFY.bat` builds `netlify_dist/` and publishes a static copy of the snapshot. That folder is not a database, and it is not the Azure target. `netlify_dist/` is gitignored.

## Open questions for Azure

- Which approved Azure service hosts the FastAPI app.
- Where the parquet snapshot and the SQLite notes file live. The app expects both on the local disk next to `app.py`. A file share or blob plus a persistent disk can hold the snapshot. Notes need a store that survives a restart.
- How the daily EDW refresh runs. Today it is a manual notebook on a laptop using `ActiveDirectoryIntegrated`. A scheduled job needs its own identity.
- Who refreshes the snapshot, and how often.
