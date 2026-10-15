---
type: product-doc
product: inv-projection
summary: "How planners use ETA / ETD boards, including Dual Source display rows"
modified: 2026-09-16
---

# User guide — Inventory Projection

Task-oriented guide for non-builder users. Field/API detail: [Interface](Interface.md). Business rules: [Core logic](Core%20logic.md).

## Who this is for

- Supply Chain Planners and Managers reviewing weekly projected inventory.
- Use **Netlify** for a read-only shared snapshot; use the **local server** if you need **Refresh data**.

## How it works (plain language)

1. An analyst refreshes company plan data in a notebook and exports files.
2. The website reads those files (it does **not** connect live to EDW).
3. You filter the matrix and optionally turn Demand/Supply drivers on or off to see SI change for your session.

Four boards:

| Tab | Meaning |
|---|---|
| **ETA by Whse** | One row = item × vendor × warehouse (ETA weeks) |
| **ETA** | One row = item × vendor (warehouses combined; SI recalculated) |
| **ETD by Whse** | Same grain as ETA by Whse; week = ship / ETD Saturday |
| **ETD** | Same grain as ETA; ETD week axis |

ETA comes from notebook `pdt_full2`. ETD comes from `pdt_etd_pivot` (ETA minus lead time), **cropped from W-1**. ETA rolls from On Hand every week; ETD copies SHIPPABLE INV on W-1 and W1, then rolls from W2. Details: [Core logic](Core%20logic.md).

## Common tasks

### Open the board

1. Go to https://Inventory-Projection.netlify.app (or local `http://127.0.0.1:8780`).
2. Choose **ETA by Whse**, **ETA**, **ETD by Whse**, or **ETD**.

### Find an item

1. Filter Vendor / Series / Item (and Warehouse on the Whse tab).
2. Optionally filter Division, Prod, MB.
3. Result count shows unique items; the matrix may still be capped at 100 routes until you narrow filters.

### See what drives SI

1. On **ETA** and **ETD**, turn off the Data Types you want to change first. Nothing leaves SI until you pick weeks.
2. Then select those dates in **Apply to ETA weeks** or **Apply to ETD weeks**. The row stays, those dates are struck through, and later SI rolls forward without that quantity. **Week Range** still only hides columns.
3. Clear the matching **Apply to weeks** control to put those data types back into SI. The Data Type checks stay as you left them, so you can pick another range.
4. Use **Show rows** only to hide/show lines without changing SI.
5. Promo Lift, Safety, and **Dual Source** are reference-only — they never change SI.

### See Dual Source PO

1. Keep **Show rows → Dual Source** on (default). One checkbox controls both extra lines.
2. Dual-source items show **Planned PO - secondary vendor** under Planned PO, and **Firm PO - secondary vendor** under Firm PO.
3. Single-source items do not get these lines. A dual-source route with no secondary vendor name and no dual PO qty also hides them.
4. Dual Source is **not** in **Data Types**. Turning it off only hides the lines; SI still uses primary Planned PO / Firm PO when those Data Types are on.

### Exclude one week for an item

1. Click a Demand/Supply cell for that item×week (muted/strike).
2. Shift+click to exclude a week range; click the variable label to toggle all visible weeks.
3. Clear filters resets these exclusions on that tab.

### Spot Lock Week (ETA by Whse)

- Locked weeks for that warehouse show **bold + dotted underline** (from planner lock calendar).
- **ETA**, **ETD by Whse**, and **ETD** have no Lock Week underline. The **Risk Item** filter on ETD still uses the same calendar against ETD SI.

### Export to Excel/CSV

1. Set filters and week range as needed.
2. Use Export — downloads the **full** filter match (not only the first 100 on screen), respecting Data Types / Show rows / exclusions.

### Check risk items

1. Open SI Negative Items to review negative projected ETA SI by warehouse or item/vendor (search-select filters shared across the two sub-tabs).
2. On any projection tab, use the **Risk Item** filter to show routes matching Before, In, or Out of Lock Week risk. Multiple selections use OR logic. On ETD tabs the same warehouse Lock Week calendar is applied to **ETD** SI (cells are not styled as lock weeks).
3. Drill back to the matrix as needed.

## FAQ

- **Why only 100 rows?** Performance — filter to your scope; Export still pulls the full match.
- **Why is Netlify missing Refresh data?** Refresh needs the local FastAPI; on Netlify, update by redeploying after notebook EXPORT.
- **Does toggling Data Types change company data?** No — view-only recalculation until the next notebook EXPORT.
- **What is Dual Source?** Extra Planned/Firm PO lines for the secondary vendor on dual-source items. Display-only; they do not enter SI. Source: [Data](Data.md).
- **What does “Sample data” mean?** No export files are loaded yet; ask an operator to run EXPORT ([Runbook](Runbook.md)).
- **Where do the numbers come from?** [Data](Data.md).

## SI Negative Items

Open **SI Negative Items** to review negative projected **ETA** SI at **item SKU** grain (not series rollup). Classification is Before / In / Out of Lock Week against warehouse Lock Week dates. This workspace does not use ETD SI, Data Types, Show rows, week range, or MB.

The sub-tabs **Risk Item by Whse** and **Risk Item** are the page title (sidebar still says SI Negative Items). Filters use the same search-select bar as ETA (type to search, multi-select, All, X to clear) and are **shared between the two SI Negative tabs only** — they do not sync with ETA/ETD.

- Shared filters: Vendor, Series, Item, Prod, Division, Risk Type. **Warehouse** appears only on **Risk Item by Whse**.
- Columns, left to right: Vendor, Series, Item, Prod, Division, then Whse on by-Whse, then Risk Type, Negative Week, SI negative, ETA, ETA negative.
- **Risk Item** (no Whse) keeps one row per item × vendor × Risk Type, using the warehouse route with the earliest negative week for Series / Prod / Division.
- Use **Export** to download the full current risk match as CSV.
- **Negative before Lock Week** means SI is below zero before the first Lock Week for that warehouse route.
- **Negative in Lock Week** means SI is below zero on the ETA / Lock Week date.
- **Negative out of Lock Week** means SI is below zero after the first Lock Week and the week is not itself a Lock Week.

An item/vendor is shown in **Risk Item** when at least one of its warehouse routes matches the selected risk.

## Get help

- **Owner / channel:** Jo Phung (product owner)
- Field/API detail: [Interface](Interface.md)
- Refresh / deploy: [Runbook](Runbook.md)
