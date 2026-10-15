---
type: product-doc
product: inv-projection
summary: "ETA SI from ON HAND; ETD SI copies SHIPPABLE INV on W-1/W1 then rolls from W2"
modified: 2026-09-16
---

# Core logic — Inventory Projection

Business decision rules for projected shippable inventory (SI). Technical pipeline details live in [Architecture](Architecture.md).

## Decision / problem

- **Who decides, how often:** Planners / managers review projected shippable inventory by week (typically after each PDT refresh / daily Netlify snapshot).
- **Cost of status quo:** Spreadsheet or ad-hoc matrix pulls; hard to toggle Demand/Supply drivers and see SI impact; no shared filterable board across warehouses.

## Rule

Shared: **Promotional lift**, **safety stock**, and **Dual Source Planned/Firm PO** are shown but **never** enter the SI formula. Promo may already sit inside Firm Demand upstream. Dual Source qty is the secondary vendor’s PSW planned/firm PO mapped onto the PDT week; primary Planned POs / Firm POs still drive Supply. Website may recompute SI in-browser when the user disables a Data Type, excludes an item×week cell, or excludes a data type on selected **Apply to ETA/ETD weeks** — that does not rewrite the export files. An empty Apply-to-weeks control still turns the data type off for the whole timeline. Selected weeks zero that driver only on those dates; SI then rolls forward from the changed week. Toggles on **ETD** do not change SI at W-1 or W1. Dual Source is Show rows only (not a Data Type). **Week Range** only hides columns.

### ETA

1. Start at **W-1**: opening inventory = On Hand from the plan snapshot.
2. Every week (**W-1**, **W1**, **W2**, …): **SI = Opening + Supply − Demand**.
3. Next week opening = previous week’s SI (roll forward only: W-1 → W1 → W2 → …).

### ETD

Matrix weeks start at the same **W-1** Saturday as ETA (not earlier ETD dates from lead time).

1. **SI(W-1)** = PDT `SHIPPABLE INV` at W-1 (copy; no Supply/Demand).
2. **SI(W1)** = PDT `SHIPPABLE INV` at W1 (copy; no Supply/Demand).
3. **SI(W2)** = `SHIPPABLE INV(W1) + Supply(W2) − Demand(W2)`.
4. **SI(Wn)** = previous SI + Supply − Demand for n ≥ 3.

## Week label glossary

| Planner / docs label | Notebook / EXPORT index | Meaning |
|---|---|---|
| **W-1** | `Wn = 0` | First **displayed** week (ETA export Saturday 0). ETA: ON HAND opens here. ETD: SHIPPABLE INV copy. |
| **W1** | `Wn = 1` | Next Saturday week-ending. ETD: SHIPPABLE INV copy. |
| **W2** | `Wn = 2` | ETD: first rolled SI week |
| *(not used in docs)* | `Wn < 0` | Notebook horizon before export; not rolled for the website |

Docs use **W-1, W1, W2, …** (no W0). Notebook code and validation still say **W0** for the first export week — that is the same week as planner **W-1**.

**ETA vs ETD axis:** ETA weeks are the PDT Saturday columns on `pdt_full2` (EXPORT clips `Wn >= 0`). ETD weeks are those dates minus `weekly_lead_time`, then snapped to Saturday on `pdt_etd_pivot`. ETD EXPORT then **clips from ETA W-1** so the website matrix starts on the same Saturday as ETA. SI formulas differ (see Rule).

## Model intent

- **Optimizes / enforces:** Consistent weekly SI projection from a single PDT snapshot (`pdt_full2` preferred), at two week axes (ETA and ETD) and two grains: item×vendor×whse and item×vendor.

## I/O contract

| Direction | Name / shape | Notes |
|---|---|---|
| Inputs | `pdt_full2` (fallback `pdt_full`) | Identity + MB + Data Types × **ETA** week_end |
| Inputs (notebook) | `pdt_etd` → `pdt_etd_pivot` | Same Data Types; week_end = **ETD** (ETA minus vendor×whse lead time) |
| Inputs (optional) | `vendor_calendar_lt` | Lock Week metadata (`Lockweek=x` → ETA weeks). ETD EXPORT does not write this map; the website Risk Item filter on ETD still reads the ETA map. |
| Outputs | `inv_projection_matrix*` + meta | Whse grain (ETA weeks) |
| Outputs | `inv_projection_matrix_iv*` + meta_iv | Item×vendor grain (sum then re-roll SI) |
| Outputs | `inv_projection_matrix_etd*` + meta_etd | ETD weeks from W-1; SI copy W-1/W1 then roll from W2; SS% / SI-SS after SI |
| Outputs | `inv_projection_matrix_etd_iv*` + meta_etd_iv | ETD item×vendor (sum then re-roll with the ETD rule; then SS% / SI-SS) |
| Outputs | UI / Netlify | Same numbers; client SI recalc is view-only |

### Formula

**Projected inventory each week (ETA)**

```text
SI projection(week)  =  Opening inventory(week)  +  Supply(week)  −  Demand(week)
```

ETD does not apply Supply/Demand at W-1 or W1. See **Rule → ETD**.

**Demand** (reduces inventory)

```text
Demand  =  Firm Demand
        +  Firm Transfer Out
        +  Net Forecast
        +  Planned Transfer Out
```

**Supply** (increases inventory)

```text
Supply  =  Intransit Transfer In
        +  On Order Transfer In
        +  Planned POs
        +  Planned Transfer In
        +  Firm POs
        +  Firm Production
        +  Planned Production
```

**Opening inventory (ETA)**

```text
W-1 opening     =  ON HAND from the plan snapshot
W1 opening      =  SI(W-1)
W2 opening      =  SI(W1)
Wn opening      =  SI(previous week)     for W1, W2, W3, …
```

**Opening inventory (ETD)**

```text
SI(W-1)         =  SHIPPABLE INV(W-1)
SI(W1)          =  SHIPPABLE INV(W1)
W2 opening      =  SHIPPABLE INV(W1)
Wn opening      =  SI(previous week)     for W3, W4, …
```

**Not in the SI formula**

| Shown on website | Effect on SI |
|---|---|
| Promotional Lift | Display only (not subtracted again) |
| Safety Stock | Display only |
| Dual Source Planned PO | Display only (secondary vendor PSW PQty; not added to Supply) |
| Dual Source Firm PO | Display only (secondary vendor PSW FQty; not added to Supply) |
| SI-SS | Display only: rolled SI minus Safety |
| SS% | Display only: (rolled SI / Safety) × 100; blank when Safety is 0 |

Cell colors (matrix + drawer, not CSV): SI Projection and SI-SS are red when the value is below 0. SS% is red below 75%, orange above 150%, and default from 75% through 150%.

### Variable map

| Plan data type | Website name | Definitions |
|---|---|---|
| ON HAND | Opening (ETA W-1 only) | On-hand inventory at the start of the ETA projection (W-1 opening). Not the ETD opening. |
| SHIPPABLE INV | ETD SI at W-1 and W1 | PDT shippable inventory on the ETD week axis. Copied into SI Projection for W-1 and W1; W2 opening uses W1. Not a website row. |
| FIRM DEMANDS | Firm Demand | Confirmed demand / customer orders that must be fulfilled. Reduces SI. |
| FIRM TRF OUT | Firm Transfer Out | Confirmed outbound warehouse transfer (US internal). Reduces SI. |
| NET FCST | Net Forecast | Net forecast demand after planning adjustments. Reduces SI. |
| PLANNED TRF OUT | Planned Transfer Out | Planned outbound warehouse transfer (US internal). Reduces SI. |
| INTRANSIT TRF IN | Intransit Transfer In | Inbound transfer already in transit. Increases SI. |
| ON ORDER TRF IN (FIRM TRF IN) | On Order Transfer In | Confirmed inbound transfer ordered / awaiting receipt (US internal). Increases SI. |
| PLANNED POS | Planned POs | Planned purchase orders. Increases SI. |
| PLANNED PO + Vendor (dual1) | Planned PO - secondary vendor | Dual-source secondary vendor planned PO (PSW PQty). Display only. Does not increase SI. Hidden when Show rows → Dual Source is off, or the route has no secondary vendor name and no dual PO qty. |
| PLANNED TRF IN | Planned Transfer In | Planned inbound warehouse transfer (US internal). Increases SI. |
| FIRM POS | Firm POs | Confirmed / firm purchase orders. Increases SI. |
| FIRM PO + Vendor (dual1) | Firm PO - secondary vendor | Dual-source secondary vendor firm PO (PSW FQty). Display only. Does not increase SI. Same Show rows gate as Dual Source Planned PO. |
| FIRM PROD | Firm Prod | Confirmed / firm production. Increases SI. |
| PLANNED PROD | Planned Prod | Planned production. Increases SI. |
| PROMOTIONAL LIFT | Promotional Lift | Extra demand from promotions; shown for reference. Not subtracted again in SI (may already sit inside Firm Demand upstream). |
| SAFETY STK | Safety Stock | Target safety stock level; shown for reference. Not used in the SI formula. Website also shows SI-SS (rolled SI − Safety) and SS% ((rolled SI / Safety) × 100). |

## Overrides

- **Allowed (session UX, not default):** Disable Data Types; Apply-to-weeks date exclusions; item×week cell exclusion; week range crop (display).
- **Forbidden shortcuts:** Treating promo/safety as Demand; treating Dual Source Planned/Firm PO as Supply in SI; remapping CNW→335 on web path; merging `masteritem` / `base_grid` for website EXPORT.

## Open questions

- When to promote PlanTrsIn / transit shift into the rule
- Confirm display titles for Data Types in UI vs PDT names
- Confirm with planning: promo already embedded in Firm Demand (vs display-only row only)

## Related

- Sources and scope: [Data](Data.md)
- Consumer surfaces: [Interface](Interface.md)
- System design: [Architecture](Architecture.md)
