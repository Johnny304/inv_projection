---
type: product-doc
product: inv-projection
summary: "Operate Inventory Projection — notebook export, local server, Netlify deploy"
modified: 2026-09-10
---

# Runbook — Inventory Projection

Operator how-to: refresh data, run locally, publish Netlify, recover from failures.

## Schedule and triggers

- **Cadence:** After PDT / notebook refresh (often daily before Netlify publish).
- **Job / pipeline name:** Manual — `inv_prj.ipynb` EXPORT + optional `DEPLOY_NETLIFY.bat`. No company scheduler required for the website path.

## Refresh steps

### Local website

1. In Jupyter, run through `pdt_full` → **Map MB** → `pdt_full2` (optional Lock Week / `vendor_calendar_lt`).
2. Run the **PDT ETD** cells until `pdt_etd_pivot` exists (needed for ETD website tabs).
3. Run **VALIDATION** then **EXPORT — website cache** (writes four grains: ETA + ETD, Whse + item×vendor under `data/`). Prefer parquet when available.
4. Optional: **§3 So SI** then **§4 CSV gap** — rolled website SI vs PDT `SHIPPABLE INV` on ETA and ETD (`data/si_compare_gap*.csv`). Notebook-only; not on the website.
5. Start or keep `START_SERVER.bat` → `http://127.0.0.1:8780` (this PC only).
6. Sidebar **Refresh data** (`POST /api/refresh`) or hard refresh; confirm freshness = Notebook export + timestamp.

Do **not** run the legacy `masteritem` / matrix / separate Item×Vendor cells for the website path.

### LAN share (same WiFi)

Use this when colleagues on the **same office WiFi / LAN** need the live local site. Do **not** use internet tunnels (`ngrok`, `cloudflared`, etc.).

1. Close `START_SERVER.bat` if it is still running (it only binds localhost).
2. On the host PC, double-click `START_SERVER_LAN.bat` (binds `0.0.0.0:8780`). Keep that window open.
3. The bat prints:
   - **This PC:** `http://127.0.0.1:8780`
   - **Same WiFi:** `http://<your-LAN-IP>:8780` (share this link — DHCP can change it after WiFi reconnect)
4. Colleagues open the **Same WiFi** URL. They must join the **exact Wi-Fi name** printed by the bat (this PC currently uses **Regus-Guest**, which is not the same as **Regust-Ashley**). Guest SSIDs often still block PC-to-PC even then.
5. First time on the host (office Domain PCs): right-click `ALLOW_FIREWALL.bat` → **Run as administrator**. Windows had a local **python.exe inbound Block** on the Domain profile; that blocks other PCs even when the server is listening. Allow TCP **8780** after disabling that block.
6. If the printed IP looks wrong, run `ipconfig` and use the **Wi-Fi** IPv4 Address (the adapter with a Default Gateway).

| Change | Steps |
|---|---|
| Solo on this PC | `START_SERVER.bat` → `http://127.0.0.1:8780` |
| Share on same WiFi | `START_SERVER_LAN.bat` → share `http://<LAN-IP>:8780` |

The host PC must stay on and the bat window must keep running. IP can change after WiFi reconnect — re-check the printed URL.

### Netlify snapshot

1. Same EXPORT as above (prefer parquet in `data/`).
2. Run `DEPLOY_NETLIFY.bat` (builds `netlify_dist/` then `netlify deploy --prod`).
3. Verify https://Inventory-Projection.netlify.app (Visitor password on).

**When you change something**

| Change | Steps |
|---|---|
| New projection data / Lock Week | Notebook **EXPORT** → `DEPLOY_NETLIFY.bat` |
| UI / JS / CSS edits | Edit files → `DEPLOY_NETLIFY.bat` (EXPORT only if data also changed) |
| Full local features | `START_SERVER.bat` → `http://127.0.0.1:8780` |
| Share with same WiFi | `START_SERVER_LAN.bat` → `http://<LAN-IP>:8780` |

### One-time Netlify setup

1. Install [Node.js LTS](https://nodejs.org/) (tick Add to PATH). Close and reopen Cursor after install.
2. In PowerShell (if `node`/`netlify` not found, prepend PATH first):

```powershell
$env:PATH = "C:\Program Files\nodejs;$env:APPDATA\npm;" + $env:PATH
npm install -g netlify-cli --allow-scripts=netlify-cli,esbuild,unix-dgram,sharp
cd "…\inv_projection"
netlify login
netlify sites:create
netlify link
```

3. In Netlify Admin → **Visitor access / password** (internal Ashley data — do not leave public).

`DEPLOY_NETLIFY.bat` prepends the Node/npm PATH automatically. Manual deploy:

```powershell
cd inv_projection
$env:PATH = "C:\Program Files\nodejs;$env:APPDATA\npm;" + $env:PATH
python scripts\build_netlify.py
netlify deploy --prod --dir=netlify_dist
```

### Unlink / delete

```powershell
netlify unlink          # detach this folder only (site stays on Netlify)
# optional: delete the .netlify\ folder in inv_projection
```

To remove the hosted site: Admin → **Delete this project**, or `netlify sites:delete`.

Do **not** commit `netlify_dist/` or large `data/*.parquet|csv` to a public git remote.

## Monitoring

- **Healthy:** Sidebar shows notebook export source · Fresh · recent `updated_at`; matrix filters return expected items.
- **Where to check:** Local sidebar freshness; Netlify site after deploy; `data/inv_projection_meta.json` timestamps.

## Failure modes

| Symptom | Likely cause | Action |
|---|---|---|
| Sample data / empty real filters | No matrix under `data/` or wrong cwd for EXPORT | Re-run EXPORT; confirm files next to app |
| 503 on dashboard | Corrupt / unreadable cache (files present) | Re-EXPORT → Refresh data |
| Page hang / timeout | Old server dumping full matrix | Restart `START_SERVER.bat` |
| Showing 100 of many routes | Designed limit | Apply filters or Export with full match |
| Stale UI after JS edit | Asset cache | Restart server / hard refresh |
| Netlify stale | Deploy skipped | EXPORT → `DEPLOY_NETLIFY.bat` |
| Netlify UI loads, matrix empty | Git deploy (no `netlify_dist`) or `/data` served as HTML | Open `/data/manifest.json` — must be JSON. Redeploy `netlify deploy --prod --dir=netlify_dist` |
| `netlify` not found | PATH | Fix Node/npm PATH; reopen terminal |
| Empty MB on some whses | Key dtype (numeric vs string) | Ensure EXPORT string/strip join |
| ETD tabs empty / EXPORT prints SKIP ETD | `pdt_etd_pivot` missing in the kernel | Run **PDT ETD** cells then re-run EXPORT |

## Ownership and escalation

- **Owner:** Jo Phung
- **Escalate to:** Owner for rule/data issues; IT only for Netlify account / visitor access policy

## Related

- Hub: [README](README.md)
- Surfaces / API errors: [Interface](Interface.md)
- Sources: [Data](Data.md)
- System design: [Architecture](Architecture.md)
- Cache file list: [`data/README.md`](../data/README.md)
