---
type: product-doc
product: inv-projection
summary: "Consumer surfaces — local FastAPI, Netlify static, dashboard API"
modified: 2026-09-16
---

# Interface — Inventory Projection

Consumer-facing surfaces (UI, API, export). Planner tasks live in [User guide](User%20guide.md). Implementation detail lives in [Architecture](Architecture.md).

## Surfaces

| Surface | Path / name | Audience |
|---|---|---|
| Local web | `http://127.0.0.1:8780` (`START_SERVER.bat`) | Planners + operators |
| Local LAN (same WiFi) | `http://<LAN-IP>:8780` (`START_SERVER_LAN.bat`) | Colleagues on same network — see [Runbook](Runbook.md) |
| Netlify snapshot | https://Inventory-Projection.netlify.app | Planners (password recommended) |
| Dashboard API | `GET /api/dashboard` | UI + static client store |
| Refresh | `POST /api/refresh` | Local only |
| CSV export | UI Export (client) | Planners |

**Canonical tab names**

| Tab | Grain | Cache |
|---|---|---|
| **ETA by Whse** | item × vendor × warehouse | `inv_projection_matrix.*` (ETA) |
| **ETA** | item × vendor | `inv_projection_matrix_iv.*` (ETA) |
| **ETD by Whse** | item × vendor × warehouse | `inv_projection_matrix_etd.*` |
| **ETD** | item × vendor | `inv_projection_matrix_etd_iv.*` |

## Fields / parameters

### `/api/dashboard` query

| Name | Meaning | Required |
|---|---|---|
| `item`, `vendor`, `warehouse`, `series`, `division`, `profile`, `mb` | Multi-value filters (repeat param = OR within dimension) | No |
| `limit` | Default 100; `0` = full match (export); max 100_000 if >0 | No |
| `grain` | `whse` (default), `item_vendor`, `etd_whse`, or `etd_item_vendor` | No |

### Response (essentials)

| Field | Meaning |
|---|---|
| `weeks`, `rows` | Matrix payload |
| `filter_options` | Cascade facets (`items`, `vendors`, `warehouses`, `series`, `divisions`, `profiles`, `mb_codes`) |
| `matched_*` / `returned_*` | Counts (UI emphasizes unique items) |
| `lock_weeks_by_warehouse` | Whse lock weeks (ISO dates); empty on ETA / ETD item×vendor grains |
| `freshness` | Source + `updated_at` |

### Filter bar order

Vendor → Series → Item → Prod → Division → Warehouse → MB → Variables.

**ETA** / **ETD**: no Warehouse; MB after Division. Shared filters (vendor/item/series/prod/division/MB/risk/Data Types/Show rows) sync across all four tabs. Warehouse stays on the two *by Whse* tabs. Week range syncs within the ETA pair and within the ETD pair only (different week axes). **Apply to ETA weeks** syncs only inside the ETA pair. **Apply to ETD weeks** syncs only inside the ETD pair.

Each filter cell (combobox, Data Types, Show rows, Apply to weeks) has a per-field X when that field is not All / not default; comboboxes clear to All, Data Types and Show rows reset to all checked, Apply to weeks clears to Entire timeline. Week range already has its own X. **Clear filters** still clears every field at once.

### Client SI behavior (contract)

- **Week Range** only chooses which timeline columns are visible. It does not change SI.
- **Apply to ETA weeks** / **Apply to ETD weeks**: choose the Data Types to turn off first, then pick the weeks. The off types drop out of SI only on those weeks, and the row stays visible. With no weeks selected, SI is unchanged. Clearing the weeks puts those types back into SI. ETA and ETD keep separate week lists.
- **Data Types** (11 Demand/Supply drivers): with no Apply-to weeks selected, off = hide row + remove from SI for the session. Dual Source is not a Data Type.
- **Show rows**: hide/show matrix lines only; does not change SI. **Dual Source** is one checkbox that shows or hides both extra PO lines.
- Dual Source rows sit under Planned PO and Firm PO, labeled with the secondary vendor name (`Planned PO - …`, `Firm PO - …`). They appear only when Dual Source is on and the route has a secondary vendor name and/or dual PO quantity.
- **Item×week exclusion**: click cell; Shift+click range; click variable label for all visible weeks. Dual Source lines are not exclusion targets.
- Promo Lift, Safety, Dual Source Planned/Firm PO, SI-SS, and SS% never enter SI ([Core logic](Core%20logic.md)).
- **ETD** SI at W-1 and W1 stays `SHIPPABLE INV` when Data Types or Apply-to weeks are toggled; session roll starts at W2 from SI(W1).
- SS% (matrix + drawer, not CSV): red below 75%, orange above 150%, default from 75% through 150%. SI-SS is red when below 0.
- Lock Week styling (ETA by Whse only): bold + dotted underline; does not change SI. ETD tabs have no Lock Week styling. The **Risk Item** filter on ETD still uses the warehouse Lock Week calendar against **ETD** SI.

## Errors and empty states

| Condition | Behavior |
|---|---|
| No export files under `data/` | Embedded **sample** rows; `freshness.source = Sample data` (demo only) |
| Export files present but read/query fails | HTTP **503** with `detail`; does **not** fall back to sample |
| Default matrix view | API returns up to 100 routes by design — filter to narrow; Export uses full filter match (`limit=0`) |

## Local-only vs Netlify

| Feature | Local FastAPI | Netlify |
|---|---|---|
| Both projection tabs plus ETD tabs, filters, SI toggles, exclusions, SI Negative Items, export, theme | Yes | Yes |
| Lock Week underline | **ETA by Whse** only | **ETA by Whse** only |
| Refresh data (`POST /api/refresh`) | Yes | No |

Light and dark themes use a slate/navy + teal palette; Ashley orange is brand-only on the sidebar wordmark.

Imports and Settings & audit are not shown in the sidebar (removed from the UI). Backend SQLite APIs may still exist for local use but have no nav entry.

## SI Negative Items

The **SI Negative Items** workspace classifies **ETA** warehouse `inv_projection` (baseline SI, not ETD and not Data Type toggles) against `lock_weeks_by_warehouse`. Grain stays **item SKU** × vendor × risk type. The heading is the sub-tab list; there is no extra page title. Filters are search-select (same UX as ETA/ETD) and **share across the two SI Negative sub-tabs only** — they do not use `ProjectionFilterSync`.

| View | Filters | Matrix columns (left to right) |
|---|---|---|
| **Risk Item by Whse** | Vendor, Series, Item, Prod, Division, Warehouse, Risk Type | Vendor, Series, Item, Prod (`ProdResourceID`), Division (`AFI Finance Division`), Whse, Risk Type, Negative Week, SI negative, ETA, ETA negative |
| **Risk Item** | Vendor, Series, Item, Prod, Division, Risk Type (no Warehouse) | Same identity without Whse; one row per item × vendor × Risk Type (earliest `negative_week`; Series / Prod / Division from that warehouse route) |

Risk categories use baseline SI and exported `lock_weeks_by_warehouse`:

- **Negative before Lock Week:** at least one `SI < 0` before the first Lock Week for the route.
- **Negative in Lock Week:** at least one `SI < 0` on a Lock Week / ETA date.
- **Negative out of Lock Week:** at least one `SI < 0` after the first Lock Week on a week that is not itself a Lock Week.

The **Risk Item** view keeps one row per item × vendor × Risk Type from warehouse routes (earliest negative week). `ETA negative` shows the SI value at the relevant ETA when it is negative; `—` means the ETA itself is not negative even though the selected risk category matched another week.

The matrix **Risk Item** multi-select on ETA/ETD tabs is separate: it filters those boards and is not kept in sync with this workspace.

The local and static clients use the same query contract:

`GET /api/risk-items?grain=whse|item_vendor&item=...&vendor=...&series=...&profile=...&division=...&warehouse=...&risk_filter=...&limit=...`

Repeat each filter for multiple values (OR). `profile` is Prod (`ProdResourceID`). Warehouse is applied only on `grain=whse`. Rows include `series`, `profile`, and `division`. `filter_options` includes `items`, `vendors`, `series`, `profiles`, `divisions`, `warehouses`, and `risk_filters`. Default `limit=100`; Export uses `limit=0`.

## Out of scope

- Live EDW from UI
- Tunneling localhost to make Netlify “live”

## Related

- Operate refresh/deploy: [Runbook](Runbook.md)
- Planner how-to: [User guide](User%20guide.md)
- Backend/store design: [Architecture](Architecture.md)
