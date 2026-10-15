/* Client-side ProjectionStore for Netlify static deploys.
   Intercepts /api/* when window.__NETLIFY_STATIC__ is set by the build. */
(() => {
  if (!window.__NETLIFY_STATIC__) return;

  let manifestPromise = null;
  const grainCache = new Map();

  function filterValues(raw) {
    if (raw == null || raw === "") return [];
    const parts = Array.isArray(raw) ? raw : [raw];
    const out = [];
    const seen = new Set();
    for (const part of parts) {
      for (const piece of String(part).split(",")) {
        const value = piece.trim();
        if (value && !seen.has(value)) {
          seen.add(value);
          out.push(value);
        }
      }
    }
    return out;
  }

  function uniqueSorted(values) {
    const seen = new Set();
    const out = [];
    for (const value of values) {
      const text = value == null ? "" : String(value).trim();
      if (text && !seen.has(text)) {
        seen.add(text);
        out.push(text);
      }
    }
    out.sort();
    return out;
  }

  /** MB may be a single code or pipe-joined codes (IV grain across warehouses). */
  function mbTokenSet(raw) {
    const text = raw == null ? "" : String(raw).trim();
    if (!text) return new Set();
    if (!text.includes("|")) return new Set([text]);
    return new Set(text.split("|").map(part => part.trim()).filter(Boolean));
  }

  function rowMatchesMb(raw, mbCodes) {
    if (!mbCodes.size) return true;
    const tokens = mbTokenSet(raw);
    if (!tokens.size) return false;
    for (const code of mbCodes) {
      if (tokens.has(code)) return true;
    }
    return false;
  }

  const SI_SIGNS = {
    firm_demand: -1,
    firm_trf_out: -1,
    net_fcst: -1,
    planned_trf_out: -1,
    intransit_trf_in: 1,
    on_order_trf_in: 1,
    planned_pos: 1,
    planned_trf_in: 1,
    firm_pos: 1,
    firm_prod: 1,
    planned_prod: 1,
  };
  const DERIVED_VARS = new Set(["ss_pct", "si_ss"]);
  const VALID_GRAINS = new Set(["whse", "item_vendor", "etd_whse", "etd_item_vendor"]);
  const IV_GRAINS = new Set(["item_vendor", "etd_item_vendor"]);

  function normalizeGrain(grain) {
    const key = (grain || "whse").trim() || "whse";
    return VALID_GRAINS.has(key) ? key : "whse";
  }
  function isIvGrain(grain) {
    return IV_GRAINS.has(grain);
  }
  function whseGrainFor(grain) {
    return grain === "etd_item_vendor" ? "etd_whse" : "whse";
  }
  function isEtdGrain(grain) {
    return grain === "etd_whse" || grain === "etd_item_vendor";
  }
  function lockMapHasEntries(map) {
    return Boolean(map && Object.keys(map).length);
  }
  /** ETD meta has no lock calendar; reuse ETA warehouse locks from the manifest (no ETA .bin.gz). */
  function lockWeeksForGrain(grainKey, info, manifest) {
    const local = (info && info.lock_weeks_by_warehouse) || {};
    if (lockMapHasEntries(local)) return local;
    if (isEtdGrain(grainKey)) {
      return (manifest.grains && manifest.grains.whse && manifest.grains.whse.lock_weeks_by_warehouse) || {};
    }
    return local;
  }
  function attachSsMetrics(values) {
    const si = values.inv_projection || [];
    const ss = values.safety_stock || [];
    values.si_ss = si.map((v, i) => (v || 0) - (ss[i] || 0));
    values.ss_pct = si.map((v, i) => {
      const safety = ss[i] || 0;
      if (!safety) return 0;
      return Math.round(((v || 0) / safety) * 100);
    });
    return values;
  }

  function rollInvProjection(opening, values, nWeeks) {
    const out = new Array(nWeeks);
    let running = opening;
    for (let w = 0; w < nWeeks; w++) {
      let next = running;
      for (const [key, sign] of Object.entries(SI_SIGNS)) {
        next += sign * ((values[key] && values[key][w]) || 0);
      }
      out[w] = next;
      running = next;
    }
    return out;
  }

  function rollInvProjectionEtd(values, nWeeks) {
    const out = new Array(nWeeks);
    const si = values.inv_projection || [];
    out[0] = si[0] || 0;
    if (nWeeks < 2) return out;
    out[1] = si[1] || 0;
    let running = out[1];
    for (let w = 2; w < nWeeks; w++) {
      let next = running;
      for (const [key, sign] of Object.entries(SI_SIGNS)) {
        next += sign * ((values[key] && values[key][w]) || 0);
      }
      out[w] = next;
      running = next;
    }
    return out;
  }

  function openingFromWhseSeries(values) {
    let opening = (values.inv_projection && values.inv_projection[0]) || 0;
    for (const [key, sign] of Object.entries(SI_SIGNS)) {
      opening -= sign * ((values[key] && values[key][0]) || 0);
    }
    return opening;
  }

  const FETCH_OPTS = { credentials: "same-origin", cache: "no-cache" };

  function cacheBust(url) {
    const version = window.__NETLIFY_BUILD__;
    if (!version) return url;
    return url + (url.includes("?") ? "&" : "?") + "v=" + encodeURIComponent(version);
  }

  function looksLikeHtmlBytes(bytes) {
    let i = 0;
    const n = Math.min(bytes.length, 64);
    while (i < n && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i += 1;
    return i < n && bytes[i] === 0x3c;
  }

  function dataFileWrongType(url, status) {
    return new Error(
      `Got a web page instead of data from ${url} (${status}). ` +
      `Open that URL in the browser — it must be JSON or a download, not the app. ` +
      `Redeploy with DEPLOY_NETLIFY.bat (--dir=netlify_dist), not Git.`
    );
  }

  async function gunzipToInt32(buffer, url) {
    const bytes = new Uint8Array(buffer);
    if (looksLikeHtmlBytes(bytes)) {
      throw dataFileWrongType(url || "/data/*.values.bin.gz", 200);
    }
    const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    if (!isGzip) {
      if (bytes.byteLength % 4 !== 0) {
        throw new Error(
          `Values file from ${url || "data"} is not gzip and not int32. ` +
          `Check Netlify headers for .bin.gz (Content-Encoding).`
        );
      }
      return new Int32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    }
    if (typeof DecompressionStream === "undefined") {
      throw new Error("Browser cannot decompress gzip (need recent Chrome, Edge, or Firefox).");
    }
    const stream = new Response(buffer).body.pipeThrough(new DecompressionStream("gzip"));
    const ab = await new Response(stream).arrayBuffer();
    return new Int32Array(ab);
  }

  async function loadManifest() {
    if (!manifestPromise) {
      manifestPromise = (async () => {
        const url = cacheBust("/data/manifest.json");
        const res = await fetch(url, FETCH_OPTS);
        const text = await res.text();
        if (!res.ok || text.trimStart().startsWith("<")) {
          throw dataFileWrongType("/data/manifest.json", res.status);
        }
        return JSON.parse(text);
      })();
    }
    return manifestPromise;
  }

  async function loadGrain(grainKey) {
    if (grainCache.has(grainKey)) return grainCache.get(grainKey);
    const pending = (async () => {
      const manifest = await loadManifest();
      const info = manifest.grains[grainKey];
      if (!info) throw new Error(`Unknown grain: ${grainKey}`);
      const routesUrl = cacheBust(`/${info.routesUrl}`);
      const valuesUrl = cacheBust(`/${info.valuesUrl}`);
      const [routes, valuesRes] = await Promise.all([
        fetch(routesUrl, FETCH_OPTS).then(async r => {
          const text = await r.text();
          if (!r.ok || text.trimStart().startsWith("<")) {
            throw dataFileWrongType(`/${info.routesUrl}`, r.status);
          }
          return JSON.parse(text);
        }),
        fetch(valuesUrl, FETCH_OPTS).then(async r => {
          if (!r.ok) throw new Error(`Failed to load ${info.valuesUrl} (${r.status})`);
          return r.arrayBuffer();
        }),
      ]);
      const flat = await gunzipToInt32(valuesRes, `/${info.valuesUrl}`);
      const n = info.n;
      const nWeeks = info.weeks.length;
      const variables = info.variables;
      const expected = n * nWeeks * variables.length;
      if (flat.length !== expected) {
        throw new Error(`Values size mismatch for ${grainKey}: ${flat.length} vs ${expected}`);
      }
      const values = {};
      variables.forEach((varName, vi) => {
        const start = vi * n * nWeeks;
        values[varName] = flat.subarray(start, start + n * nWeeks);
      });
      const store = {
        grain: grainKey,
        weeks: info.weeks,
        n,
        nWeeks,
        variables,
        routes,
        values,
        freshness: info.freshness,
        lockWeeksByWarehouse: lockWeeksForGrain(grainKey, info, manifest),
      };
      grainCache.set(grainKey, store);
      return store;
    })();
    grainCache.set(grainKey, pending);
    return pending;
  }

  function rowSeries(store, routeIndex, varName) {
    const { nWeeks, values } = store;
    const base = routeIndex * nWeeks;
    const src = values[varName];
    const out = new Array(nWeeks);
    if (!src) {
      out.fill(0);
      return out;
    }
    for (let w = 0; w < nWeeks; w++) out[w] = src[base + w];
    return out;
  }

  function mask(store, filters) {
    const items = new Set(filterValues(filters.item));
    const vendors = new Set(filterValues(filters.vendor));
    const warehouses = new Set(filterValues(filters.warehouse));
    const series = new Set(filterValues(filters.series));
    const divisions = new Set(filterValues(filters.division));
    const profiles = new Set(filterValues(filters.profile));
    const mbCodes = new Set(filterValues(filters.mb));
    const idxs = [];
    const routes = store.routes;
    for (let i = 0; i < store.n; i++) {
      const r = routes[i];
      if (items.size && !items.has(r[0])) continue;
      if (vendors.size && !vendors.has(r[1])) continue;
      if (warehouses.size && !isIvGrain(store.grain) && !warehouses.has(r[2])) continue;
      if (series.size && !series.has(r[3])) continue;
      if (divisions.size && !divisions.has(r[4])) continue;
      if (profiles.size && !profiles.has(r[5])) continue;
      if (!rowMatchesMb(r[6], mbCodes)) continue;
      idxs.push(i);
    }
    return idxs;
  }

  function scopedFilterOptions(store, filters) {
    const facets = {
      items: { col: 0, drop: "item" },
      vendors: { col: 1, drop: "vendor" },
      warehouses: { col: 2, drop: "warehouse" },
      series: { col: 3, drop: "series" },
      divisions: { col: 4, drop: "division" },
      profiles: { col: 5, drop: "profile" },
      mb_codes: { col: 6, drop: "mb" },
    };
    const options = {};
    for (const [key, { col, drop }] of Object.entries(facets)) {
      if (key === "warehouses" && isIvGrain(store.grain)) {
        options[key] = [];
        continue;
      }
      const f = { ...filters, [drop]: [] };
      const idxs = mask(store, f);
      const values = [];
      for (const i of idxs) {
        const raw = store.routes[i][col];
        if (key === "mb_codes") values.push(...mbTokenSet(raw));
        else values.push(raw);
      }
      options[key] = uniqueSorted(values);
    }
    return options;
  }

  /** Inv Prj (IV) + MB: roll up only warehouses that match MB (SI re-rolled). */
  function queryIvFromWhseMb(whseStore, filters, limit, grainKey) {
    const whseFilters = { ...filters, warehouse: [] };
    let idxs = mask(whseStore, whseFilters);
    const selectedRisks = new Set(filterValues(filters.risk_filter).filter(value => RISK_FILTERS.includes(value)));
    if (selectedRisks.size) {
      idxs = idxs.filter(index => {
        const route = whseStore.routes[index];
        const lockWeeks = new Set((whseStore.lockWeeksByWarehouse[String(route[2])] || []).map(String));
        return classifyRisk(
          route[0],
          route[1],
          route[2],
          whseStore.weeks,
          rowSeries(whseStore, index, "inv_projection"),
          lockWeeks,
        ).some(record => selectedRisks.has(record.risk_filter));
      });
    }
    const nWeeks = whseStore.nWeeks;
    const groups = new Map();
    for (const i of idxs) {
      const r = whseStore.routes[i];
      const key = `${r[0]}\0${r[1]}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          item: r[0],
          vendor: r[1],
          warehouse: "ALL",
          series: r[3],
          division: r[4],
          profile: r[5],
          mbs: new Set(),
          vnames: new Set(),
          opening: 0,
          values: Object.fromEntries(whseStore.variables.map(name => [name, new Array(nWeeks).fill(0)])),
        };
        groups.set(key, group);
      }
      const seriesMap = {};
      for (const varName of whseStore.variables) {
        if (DERIVED_VARS.has(varName)) continue;
        seriesMap[varName] = rowSeries(whseStore, i, varName);
        const dest = group.values[varName];
        if (!dest) continue;
        for (let w = 0; w < nWeeks; w++) dest[w] += seriesMap[varName][w];
      }
      group.opening += openingFromWhseSeries(seriesMap);
      for (const token of mbTokenSet(r[6])) group.mbs.add(token);
      const vn = String(r[7] || "").trim();
      if (vn) group.vnames.add(vn);
    }

    const allRows = [];
    for (const group of groups.values()) {
      // Inputs were summed; replace SI with a correct roll from summed opening.
      if (isEtdGrain(grainKey)) {
        group.values.inv_projection = rollInvProjectionEtd(group.values, nWeeks);
      } else {
        group.values.inv_projection = rollInvProjection(group.opening, group.values, nWeeks);
      }
      attachSsMetrics(group.values);
      allRows.push({
        item: group.item,
        vendor: group.vendor,
        warehouse: group.warehouse,
        series: group.series,
        division: group.division,
        profile: group.profile,
        mb: [...group.mbs].sort().join("|"),
        vname_dual: [...group.vnames].join(", "),
        values: group.values,
      });
    }
    allRows.sort((a, b) => {
      const itemCmp = a.item.localeCompare(b.item);
      if (itemCmp) return itemCmp;
      return a.vendor.localeCompare(b.vendor);
    });

    const totalMatch = allRows.length;
    const matchedItems = new Set(allRows.map(row => row.item)).size;
    const rows = limit > 0 ? allRows.slice(0, limit) : allRows;
    // Facets for IV+MB come from the MB-filtered whse slice (ignore warehouse).
    const filter_options = { ...scopedFilterOptions(whseStore, whseFilters), risk_filters: [...RISK_FILTERS] };
    filter_options.warehouses = [];
    return {
      weeks: whseStore.weeks,
      rows,
      filter_options,
      total_rows: whseStore.n,
      matched_rows: totalMatch,
      returned_rows: rows.length,
      matched_items: matchedItems,
      returned_items: new Set(rows.map(row => row.item)).size,
      grain: grainKey || "item_vendor",
      lock_weeks_by_warehouse: {},
      freshness: whseStore.freshness,
    };
  }

  async function queryDashboard(params) {
    const grainKey = normalizeGrain(params.get("grain") || "whse");
    const filters = {
      item: params.getAll("item"),
      vendor: params.getAll("vendor"),
      warehouse: params.getAll("warehouse"),
      series: params.getAll("series"),
      division: params.getAll("division"),
      profile: params.getAll("profile"),
      mb: params.getAll("mb"),
      risk_filter: params.getAll("risk_filter"),
    };
    let limit = Number(params.get("limit"));
    if (!Number.isFinite(limit)) limit = 100;
    if (limit > 0) limit = Math.min(limit, 100_000);

    // IV + MB must aggregate from warehouse grain (IV meta MB is first-whse only).
    if (isIvGrain(grainKey) && (filterValues(filters.mb).length || filterValues(filters.risk_filter).length)) {
      const whseStore = await loadGrain(whseGrainFor(grainKey));
      return queryIvFromWhseMb(whseStore, filters, limit, grainKey);
    }

    const store = await loadGrain(grainKey);
    let idxs = mask(store, filters);
    const selectedRisks = new Set(filterValues(filters.risk_filter).filter(value => RISK_FILTERS.includes(value)));
    if (selectedRisks.size) {
      idxs = idxs.filter(index => {
        const route = store.routes[index];
        const lockWeeks = new Set((store.lockWeeksByWarehouse[String(route[2])] || []).map(String));
        return classifyRisk(
          route[0],
          route[1],
          route[2],
          store.weeks,
          rowSeries(store, index, "inv_projection"),
          lockWeeks,
        ).some(record => selectedRisks.has(record.risk_filter));
      });
    }
    const totalMatch = idxs.length;
    const matchedItems = new Set(idxs.map(i => store.routes[i][0])).size;
    const slice = limit > 0 ? idxs.slice(0, limit) : idxs;
    const rows = slice.map(i => {
      const r = store.routes[i];
      const values = {};
      for (const varName of store.variables) values[varName] = rowSeries(store, i, varName);
      return {
        item: r[0],
        vendor: r[1],
        warehouse: r[2],
        series: r[3],
        division: r[4],
        profile: r[5],
        mb: r[6] || "",
        vname_dual: r[7] || "",
        values,
      };
    });
    return {
      weeks: store.weeks,
      rows,
      filter_options: { ...scopedFilterOptions(store, filters), risk_filters: [...RISK_FILTERS] },
      total_rows: store.n,
      matched_rows: totalMatch,
      returned_rows: rows.length,
      matched_items: matchedItems,
      returned_items: new Set(rows.map(r => r.item)).size,
      grain: grainKey,
      lock_weeks_by_warehouse: grainKey === "whse" ? (store.lockWeeksByWarehouse || {}) : {},
      freshness: store.freshness,
    };
  }

  const RISK_FILTERS = ["before_lock_week", "in_lock_week", "out_of_lock_week"];

  function classifyRisk(item, vendor, warehouse, weeks, projection, lockWeeks, extra = {}) {
    const negative = projection.map((value, index) => value < 0 ? index : -1).filter(index => index >= 0);
    if (!negative.length) return [];
    const locks = [...lockWeeks].sort();
    const firstLock = locks[0] || "";
    const groups = Object.fromEntries(RISK_FILTERS.map(name => [name, []]));
    negative.forEach(index => {
      const week = String(weeks[index]);
      if (firstLock && week < firstLock) groups.before_lock_week.push(index);
      if (lockWeeks.has(week)) groups.in_lock_week.push(index);
      if (firstLock && week > firstLock && !lockWeeks.has(week)) groups.out_of_lock_week.push(index);
    });
    return RISK_FILTERS.flatMap(riskFilter => {
      const indexes = groups[riskFilter];
      if (!indexes.length) return [];
      const negativeIndex = indexes[0];
      const negativeWeek = String(weeks[negativeIndex]);
      const etaWeek = riskFilter === "in_lock_week" ? negativeWeek : firstLock;
      const etaIndex = weeks.indexOf(etaWeek);
      const etaValue = etaIndex >= 0 && projection[etaIndex] < 0 ? projection[etaIndex] : null;
      return [{
        item: String(item),
        vendor: String(vendor),
        warehouse: String(warehouse),
        series: String(extra.series || ""),
        profile: String(extra.profile || ""),
        division: String(extra.division || ""),
        risk_filter: riskFilter,
        negative_week: negativeWeek,
        negative_si: projection[negativeIndex],
        eta_week: etaWeek,
        eta_negative: etaValue,
      }];
    });
  }

  function riskFilterOptions(records) {
    return {
      items: uniqueSorted(records.map(record => record.item)),
      vendors: uniqueSorted(records.map(record => record.vendor)),
      warehouses: uniqueSorted(records.map(record => record.warehouse)),
      series: uniqueSorted(records.map(record => record.series)),
      profiles: uniqueSorted(records.map(record => record.profile)),
      divisions: uniqueSorted(records.map(record => record.division)),
      risk_filters: [...RISK_FILTERS],
    };
  }

  async function queryRiskItems(params) {
    const store = await loadGrain("whse");
    const filters = {
      item: params.getAll("item"),
      vendor: params.getAll("vendor"),
      warehouse: params.getAll("warehouse"),
      series: params.getAll("series"),
      profile: params.getAll("profile"),
      division: params.getAll("division"),
    };
    const selectedRisks = new Set(filterValues(params.getAll("risk_filter")).filter(value => RISK_FILTERS.includes(value)));
    const allRecords = [];
    for (const index of mask(store, filters)) {
      const route = store.routes[index];
      const projection = rowSeries(store, index, "inv_projection");
      const lockWeeks = new Set((store.lockWeeksByWarehouse[String(route[2])] || []).map(String));
      const records = classifyRisk(route[0], route[1], route[2], store.weeks, projection, lockWeeks, {
        series: route[3] || "",
        division: route[4] || "",
        profile: route[5] || "",
      });
      allRecords.push(...(selectedRisks.size
        ? records.filter(record => selectedRisks.has(record.risk_filter))
        : records));
    }
    const grain = params.get("grain") === "item_vendor" ? "item_vendor" : "whse";
    let records = allRecords;
    if (grain === "item_vendor") {
      const grouped = new Map();
      for (const record of allRecords) {
        const key = `${record.item}\0${record.vendor}\0${record.risk_filter}`;
        const current = grouped.get(key);
        if (!current || record.negative_week < current.negative_week) {
          grouped.set(key, { ...record, warehouse: "ALL" });
        }
      }
      records = [...grouped.values()];
    }
    records.sort((left, right) =>
      `${left.item}\0${left.vendor}\0${left.warehouse}\0${left.risk_filter}`.localeCompare(
        `${right.item}\0${right.vendor}\0${right.warehouse}\0${right.risk_filter}`
      )
    );
    let limit = Number(params.get("limit"));
    if (!Number.isFinite(limit)) limit = 100;
    if (limit > 0) limit = Math.min(limit, 100_000);
    const matched = records.length;
    if (limit > 0) records = records.slice(0, limit);
    return {
      weeks: store.weeks,
      rows: records,
      filter_options: riskFilterOptions(allRecords),
      matched_rows: matched,
      returned_rows: records.length,
      grain,
      freshness: store.freshness,
    };
  }

  function parsePath(path) {
    const url = new URL(path, window.location.origin);
    return { pathname: url.pathname, params: url.searchParams, methodPath: url.pathname };
  }

  async function handle(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const { pathname, params } = parsePath(path);

    if (pathname === "/api/dashboard" && method === "GET") {
      return queryDashboard(params);
    }
    if (pathname === "/api/risk-items" && method === "GET") {
      return queryRiskItems(params);
    }
    if (pathname === "/api/refresh" && method === "POST") {
      return {
        ok: false,
        local_only: true,
        detail: "Refresh is local-only. Re-run notebook EXPORT and DEPLOY_NETLIFY.bat to update this site.",
      };
    }
    if (pathname === "/api/imports" || pathname.startsWith("/api/imports")) {
      return { jobs: [], local_only: true };
    }
    if (pathname === "/api/notes" || pathname.startsWith("/api/notes")) {
      if (method === "GET") return { notes: [], local_only: true };
      throw new Error("Notes are available only on the local FastAPI server.");
    }
    if (pathname === "/api/users") {
      return { users: [], local_only: true };
    }
    if (pathname === "/api/audit") {
      return { records: [], local_only: true };
    }
    throw new Error(`Static Netlify build does not support ${method} ${pathname}`);
  }

  window.ProjectionStaticApi = { handle, loadGrain, loadManifest };

  function applyStaticChrome() {
    document.querySelectorAll(".netlify-hide").forEach(el => {
      el.hidden = true;
    });
    const refresh = document.getElementById("data-refresh");
    if (refresh) {
      refresh.hidden = true;
      refresh.disabled = true;
      refresh.title = "Update by re-deploying from local EXPORT";
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyStaticChrome);
  } else {
    applyStaticChrome();
  }
})();
