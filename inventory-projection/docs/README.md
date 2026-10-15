
---
type: product
status: live
owner: "Jo Phung, DinhBao"
consumers:
  - "Supply Chain Planners Inhouse"
domain: Inhouse
summary: "Weekly inventory projection matrix (ETA/ETD × whse/item×vendor) from PDT export — local FastAPI + Netlify snapshot"
modified: 2026-09-07
---

# Inventory Projection

## What it is

- **Output identity:**
  - Files: `inv_projection/data/inv_projection_matrix*.{parquet,csv}` + `*_meta*.json`
  - Local UI: `http://127.0.0.1:8780` (`START_SERVER.bat`)
  - Same WiFi: `START_SERVER_LAN.bat` → share `http://<LAN-IP>:8780` (see [Runbook](Runbook.md))
  - Hosted snapshot: [https://Inventory-Projection.netlify.app](https://Inventory-Projection.netlify.app)
- **One-line value:** Planners see projected SI by week (ETA or ETD) with Demand/Supply toggles, without live EDW from the website.

## Ownership


| Role      | Who                           |
| --------- | ----------------------------- |
| Owner     | Jo Phung,DinhBao                     |
| Consumers | Supply Chain Planners Inhouse |


## Status

`live` — local FastAPI + Netlify daily snapshot in use.

## Doc pack

The website also includes a **Read Me** workspace with an in-app semantic model, source-table summary, data-variable map, and SI formula overview.


| Doc                             | Job                                                     |
| ------------------------------- | ------------------------------------------------------- |
| [Core logic](Core%20logic.md)   | SI rule, week labels, Demand/Supply map, overrides      |
| [Plan projection](../../docs/4%20Project/Plan%20projection.md) | Plan PO scenarios in the PlanPO notebook: SS% half and Cover SI |
| [Data](Data.md)                 | Company sources, scope, grains, caveats                 |
| [Interface](Interface.md)       | UI tabs, API params, errors / empty states              |
| [Runbook](Runbook.md)           | Notebook EXPORT, local server, Netlify deploy, failures |
| [User guide](User%20guide.md)   | Planner tasks and FAQ                                   |
| [Architecture](Architecture.md) | Components, boundaries, runtime paths, design decisions |


## Quick start

1. Double-click `START_SERVER.bat` (this PC) or `START_SERVER_LAN.bat` (same WiFi) — see [Runbook](Runbook.md).
2. Open `http://127.0.0.1:8780` (or the LAN URL printed by `START_SERVER_LAN.bat`). First LAN share from another PC: run `ALLOW_FIREWALL.bat` as Administrator.
3. To load real data: notebook EXPORT → refresh — details in [Runbook](Runbook.md).

## Links

- Notebook (manual only): [inv_prj.ipynb](../inv_prj.ipynb)
- Cache file list: [data/README.md](../data/README.md)
- Retired pre-consolidation docs: [archive/2026-08-doc-consolidation/](archive/2026-08-doc-consolidation/README.md)

