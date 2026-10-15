/* Shared projection logic for both matrix tabs (Inv Prj by Whse, Inv Prj).
   Kept as a plain global so the page needs no module loader. */
window.ProjectionCore = (() => {
  const SI_INPUTS = [
    // DEMAND (−) — promotional_lift is display-only (not in SI)
    { key: "firm_demand", sign: -1 },
    { key: "firm_trf_out", sign: -1 },
    { key: "net_fcst", sign: -1 },
    { key: "planned_trf_out", sign: -1 },
    // SUPPLY (+)
    { key: "intransit_trf_in", sign: 1 },
    { key: "on_order_trf_in", sign: 1 },
    { key: "planned_pos", sign: 1 },
    { key: "planned_trf_in", sign: 1 },
    { key: "firm_pos", sign: 1 },
    { key: "firm_prod", sign: 1 },
    { key: "planned_prod", sign: 1 },
  ];
  const TOGGLEABLE_VARIABLES = new Set(SI_INPUTS.map(({ key }) => key));
  /* Display labels: Title Case, aligned with filter panel wording. */
  const VARIABLE_INPUTS = [
    ["firm_demand", "Firm Demand"],
    ["firm_trf_out", "Firm Trf Out"],
    ["net_fcst", "Net Forecast"],
    ["planned_trf_out", "Planned Trf Out"],
    ["intransit_trf_in", "In-transit Trf In"],
    ["on_order_trf_in", "On-order Trf In"],
    ["planned_pos", "Planned PO"],
    ["planned_trf_in", "Planned Trf In"],
    ["firm_pos", "Firm PO"],
    ["firm_prod", "Firm Prod"],
    ["planned_prod", "Planned Prod"],
  ];
  /* Rows that can be shown/hidden in the matrix UI (SI Projection always shows). */
  const DISPLAY_VARIABLES = [
    ...VARIABLE_INPUTS,
    ["promotional_lift", "Promo Lift"],
    ["safety_stock", "Safety"],
    ["si_ss", "SI-SS"],
    ["ss_pct", "SS%"],
  ];
  const DUAL_SOURCE_VISIBLE_KEY = "dual_source";
  const SI_SIGN_BY_KEY = Object.fromEntries(SI_INPUTS.map(({ key, sign }) => [key, sign]));
  const SUPPLY_DISPLAY_KEYS = new Set(["planned_po_dual", "firm_po_dual"]);
  const DISPLAY_KIND_KEYS = new Set(["promotional_lift", "safety_stock", "si_ss", "ss_pct"]);

  function rowKind(key) {
    if (key === "inv_projection") return "si";
    if (SUPPLY_DISPLAY_KEYS.has(key)) return "supply";
    if (DISPLAY_KIND_KEYS.has(key)) return "display";
    const sign = SI_SIGN_BY_KEY[key];
    if (sign === -1) return "demand";
    if (sign === 1) return "supply";
    return "display";
  }
  const RISK_FILTER_LABELS = {
    before_lock_week: "Before Lock Week",
    in_lock_week: "In Lock Week",
    out_of_lock_week: "Out of Lock Week",
  };
  const SEP = "\u001e";

  /* Shared UI filter state for both projection tabs. Warehouse and exclusions
     intentionally remain local to their owning tab. */
  const SHARED_FILTER_KEYS = ["vendor", "series", "item", "profile", "division", "mb", "risk_filter"];
  function createProjectionFilterSync() {
    const snapshot = {
      vendor: [],
      mb: [],
      series: [],
      item: [],
      profile: [],
      division: [],
      risk_filter: [],
      variables: VARIABLE_INPUTS.map(([key]) => key),
      visibleVariables: [...DISPLAY_VARIABLES.map(([key]) => key), DUAL_SOURCE_VISIBLE_KEY],
      weekFrom: "",
      weekTo: "",
      etdWeekFrom: "",
      etdWeekTo: "",
      etaToggleWeeks: [],
      etdToggleWeeks: [],
      etaArmedOff: [],
      etdArmedOff: [],
    };
    const listeners = new Set();

    function clone(value) {
      return {
        vendor: [...value.vendor],
        mb: [...value.mb],
        series: [...value.series],
        item: [...value.item],
        profile: [...value.profile],
        division: [...value.division],
        risk_filter: [...value.risk_filter],
        variables: [...value.variables],
        visibleVariables: [...value.visibleVariables],
        weekFrom: value.weekFrom,
        weekTo: value.weekTo,
        etdWeekFrom: value.etdWeekFrom,
        etdWeekTo: value.etdWeekTo,
        etaToggleWeeks: [...value.etaToggleWeeks],
        etdToggleWeeks: [...value.etdToggleWeeks],
        etaArmedOff: [...(value.etaArmedOff || [])],
        etdArmedOff: [...(value.etdArmedOff || [])],
      };
    }

    function normalizeValues(value) {
      return [...new Set((Array.isArray(value) ? value : []).filter(Boolean).map(String))];
    }

    function sameArray(left, right) {
      return left.length === right.length && left.every((value, index) => value === right[index]);
    }

    function set(partial = {}, { source = "unknown" } = {}) {
      const next = clone(snapshot);
      for (const key of SHARED_FILTER_KEYS) {
        if (Object.prototype.hasOwnProperty.call(partial, key)) next[key] = normalizeValues(partial[key]);
      }
      if (Object.prototype.hasOwnProperty.call(partial, "variables")) {
        next.variables = normalizeValues(partial.variables);
      }
      if (Object.prototype.hasOwnProperty.call(partial, "visibleVariables")) {
        next.visibleVariables = normalizeValues(partial.visibleVariables);
      }
      for (const key of ["weekFrom", "weekTo", "etdWeekFrom", "etdWeekTo"]) {
        if (Object.prototype.hasOwnProperty.call(partial, key)) next[key] = String(partial[key] || "");
      }
      for (const key of ["etaToggleWeeks", "etdToggleWeeks", "etaArmedOff", "etdArmedOff"]) {
        if (Object.prototype.hasOwnProperty.call(partial, key)) next[key] = normalizeValues(partial[key]);
      }

      const changed = SHARED_FILTER_KEYS.some(key => !sameArray(snapshot[key], next[key]))
        || !sameArray(snapshot.variables, next.variables)
        || !sameArray(snapshot.visibleVariables, next.visibleVariables)
        || !sameArray(snapshot.etaToggleWeeks, next.etaToggleWeeks)
        || !sameArray(snapshot.etdToggleWeeks, next.etdToggleWeeks)
        || !sameArray(snapshot.etaArmedOff || [], next.etaArmedOff || [])
        || !sameArray(snapshot.etdArmedOff || [], next.etdArmedOff || [])
        || snapshot.weekFrom !== next.weekFrom
        || snapshot.weekTo !== next.weekTo
        || snapshot.etdWeekFrom !== next.etdWeekFrom
        || snapshot.etdWeekTo !== next.etdWeekTo;
      if (!changed) return clone(snapshot);
      Object.assign(snapshot, next);
      const current = clone(snapshot);
      listeners.forEach(listener => listener(current, { source }));
      return current;
    }

    function subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    return {
      get: () => clone(snapshot),
      set,
      subscribe,
    };
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[char]));
  }

  function number(value) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
  }

  function csvEscape(value) {
    const text = value == null ? "" : String(value);
    if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
    return text;
  }

  function downloadCsv(filename, lines) {
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement("a"), { href: url, download: filename });
    link.click();
    URL.revokeObjectURL(url);
  }

  function weeksBetween(allWeeks, weekA, weekB) {
    let i = allWeeks.indexOf(weekA);
    let j = allWeeks.indexOf(weekB);
    if (i < 0 || j < 0) return weekB ? [weekB] : [];
    if (i > j) [i, j] = [j, i];
    return allWeeks.slice(i, j + 1);
  }

  /* Exclusions live as item -> Set of `${week}\u001e${variable}`.
     Nesting by item means item codes can contain any character without
     colliding, and "does this item have exclusions" stays an O(1) lookup. */
  function createExclusionStore() {
    const byItem = new Map();

    const subKey = (week, variable) => `${week}${SEP}${variable}`;

    function forItem(item) {
      return byItem.get(item);
    }

    function isExcluded(item, week, variable) {
      return Boolean(byItem.get(item)?.has(subKey(week, variable)));
    }

    function set(item, weeks, variable, excluded) {
      if (!weeks.length) return;
      if (excluded) {
        let entry = byItem.get(item);
        if (!entry) {
          entry = new Set();
          byItem.set(item, entry);
        }
        for (const week of weeks) entry.add(subKey(week, variable));
        return;
      }
      const entry = byItem.get(item);
      if (!entry) return;
      for (const week of weeks) entry.delete(subKey(week, variable));
      if (!entry.size) byItem.delete(item);
    }

    function toggle(item, week, variable) {
      set(item, [week], variable, !isExcluded(item, week, variable));
    }

    /* Drop keys whose item or week no longer exists in the freshly loaded payload. */
    function prune({ weeks, items }) {
      const weekSet = new Set(weeks);
      const itemSet = items ? new Set(items) : null;
      for (const [item, entry] of [...byItem]) {
        if (itemSet && !itemSet.has(item)) {
          byItem.delete(item);
          continue;
        }
        for (const key of [...entry]) {
          const [week, variable] = key.split(SEP);
          if (!weekSet.has(week) || !TOGGLEABLE_VARIABLES.has(variable)) entry.delete(key);
        }
        if (!entry.size) byItem.delete(item);
      }
    }

    function count() {
      let total = 0;
      for (const entry of byItem.values()) total += entry.size;
      return total;
    }

    return {
      subKey,
      forItem,
      isExcluded,
      set,
      toggle,
      prune,
      count,
      clear: () => byItem.clear(),
    };
  }

  /* Axis-wide week × variable exclusions from the Apply-to-weeks control.
     Empty scope means Data Type checkboxes still turn a variable off everywhere. */
  function createScopeExclusionStore() {
    const byVariable = new Map();

    function weeksFor(variable) {
      return byVariable.get(variable);
    }

    function isExcluded(week, variable) {
      return Boolean(byVariable.get(variable)?.has(week));
    }

    function covers(variable, weeks) {
      if (!weeks.length) return false;
      const entry = byVariable.get(variable);
      return Boolean(entry && weeks.every(week => entry.has(week)));
    }

    function setWeeks(variable, weeks, excluded) {
      if (!weeks.length) return;
      if (excluded) {
        let entry = byVariable.get(variable);
        if (!entry) {
          entry = new Set();
          byVariable.set(variable, entry);
        }
        weeks.forEach(week => entry.add(week));
        return;
      }
      const entry = byVariable.get(variable);
      if (!entry) return;
      weeks.forEach(week => entry.delete(week));
      if (!entry.size) byVariable.delete(variable);
    }

    function prune(weeks) {
      const allowed = new Set(weeks);
      for (const [variable, entry] of [...byVariable]) {
        if (!TOGGLEABLE_VARIABLES.has(variable)) {
          byVariable.delete(variable);
          continue;
        }
        for (const week of [...entry]) if (!allowed.has(week)) entry.delete(week);
        if (!entry.size) byVariable.delete(variable);
      }
    }

    return {
      weeksFor,
      isExcluded,
      covers,
      setWeeks,
      prune,
      clear: () => byVariable.clear(),
      count() {
        let total = 0;
        for (const entry of byVariable.values()) total += entry.size;
        return total;
      },
    };
  }

  /* Roll SI over the whole horizon; excluded or globally-off variables count as 0.
     `weeks` must be the week axis of the payload `row` came from.
     rollFromIndex: 0 = ETA (back out opening from week 0).
     rollFromIndex: 2 = ETD (keep W-1/W1; roll from W2 using SI(W1) as opening). */
  function recalculateProjection(row, weeks, { enabled, exclusions, scopeExclusions, rollFromIndex = 0 }) {
    const values = row.values;
    const original = values.inv_projection || [];
    if (!original.length) return [];
    const excluded = exclusions?.forItem(row.item);
    const allGlobalOn = SI_INPUTS.every(({ key }) => enabled.has(key));
    const scopeActive = Boolean(scopeExclusions?.count());
    if (allGlobalOn && !excluded && !scopeActive) return original;

    const all = SI_INPUTS.map(({ key, sign }) => ({ key, sign, series: values[key] || [] }));
    const active = all.filter(({ key }) => enabled.has(key));
    const rollFrom = Number.isInteger(rollFromIndex) && rollFromIndex > 0 ? rollFromIndex : 0;

    if (rollFrom >= 2) {
      const projection = original.slice();
      projection[0] = original[0] || 0;
      projection[1] = original[1] || 0;
      let opening = original[1] || 0;
      for (let index = 2; index < original.length; index += 1) {
        const week = weeks[index];
        let projected = opening;
        for (const { key, sign, series } of active) {
          if (week != null && scopeExclusions?.isExcluded(week, key)) continue;
          if (excluded && week != null && excluded.has(exclusions.subKey(week, key))) continue;
          projected += sign * (series[index] || 0);
        }
        projection[index] = projected;
        opening = projected;
      }
      return projection;
    }

    // Back week 0 out of the server SI to recover opening inventory before W0.
    let opening = original[0];
    for (const { sign, series } of all) opening -= sign * (series[0] || 0);

    const projection = new Array(original.length);
    for (let index = 0; index < original.length; index += 1) {
      const week = weeks[index];
      let projected = opening;
      for (const { key, sign, series } of active) {
        if (week != null && scopeExclusions?.isExcluded(week, key)) continue;
        if (excluded && week != null && excluded.has(exclusions.subKey(week, key))) continue;
        projected += sign * (series[index] || 0);
      }
      projection[index] = projected;
      opening = projected;
    }
    return projection;
  }

  function ssPctSeries(si, safety) {
    return si.map((value, index) => {
      const ss = safety[index] || 0;
      if (!ss) return null;
      return (value || 0) / ss * 100;
    });
  }

  function siSsSeries(si, safety) {
    return si.map((value, index) => (value || 0) - (safety[index] || 0));
  }

  function rowValues(row, key, projection) {
    if (key === "inv_projection") return projection || [];
    const safety = row.values?.safety_stock || [];
    if (key === "si_ss") return siSsSeries(projection || [], safety);
    if (key === "ss_pct") return ssPctSeries(projection || [], safety);
    return row.values?.[key] || [];
  }

  function formatSsPct(value) {
    if (value == null || Number.isNaN(Number(value))) return "";
    return `${number(value)}%`;
  }

  function formatCell(key, value) {
    if (key === "ss_pct") return formatSsPct(value);
    if (value == null || Number.isNaN(Number(value))) return "";
    return number(value);
  }

  function ssPctTone(value) {
    if (value == null || Number.isNaN(Number(value))) return "";
    if (value < 75) return "ss-low";
    if (value > 150) return "ss-high";
    return "";
  }

  function cellTone(key, value) {
    if (key === "ss_pct") return ssPctTone(value);
    if (value < 0) return "negative";
    return "";
  }

  function metricColor(key, value) {
    const tone = cellTone(key, value);
    if (tone === "ss-high") return "var(--amber)";
    if (tone === "ss-low" || tone === "negative") return "var(--danger)";
    return "var(--ink)";
  }

  function attachFieldClearButton(trigger, { isActive, onClear } = {}) {
    if (!trigger) return { sync() {} };
    /* Span, not <button>: the trigger is already a button (nested buttons are invalid). */
    const btn = document.createElement("span");
    btn.className = "btn-field-clear";
    btn.title = "Clear this filter";
    btn.setAttribute("role", "button");
    btn.setAttribute("aria-label", "Clear this filter");
    btn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
    const caret = trigger.querySelector(".search-select-caret");
    if (caret) trigger.insertBefore(btn, caret);
    else trigger.appendChild(btn);
    function sync() {
      btn.hidden = !(typeof isActive === "function" && isActive());
    }
    btn.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      onClear?.();
    });
    sync();
    return { sync, button: btn };
  }

  function dualSourceRows(row) {
    const name = String(row?.vname_dual || "").trim();
    const planned = row?.values?.planned_po_dual || [];
    const firm = row?.values?.firm_po_dual || [];
    const hasQty = planned.some(value => Number(value)) || firm.some(value => Number(value));
    if (!name && !hasQty) return [];
    const label = name || "secondary vendor";
    return [
      ["planned_po_dual", `Planned PO - ${label}`],
      ["firm_po_dual", `Firm PO - ${label}`],
    ];
  }

  function ensureDualSourceShowRowsOption(panel) {
    if (!panel || panel.querySelector('input[value="dual_source"]')) return;
    const option = document.createElement("label");
    option.innerHTML = '<input type="checkbox" value="dual_source" checked><span>Dual Source</span>';
    const heading = [...panel.querySelectorAll("p")].find(node => /display-only/i.test(node.textContent || ""));
    if (heading && heading.nextSibling) panel.insertBefore(option, heading.nextSibling);
    else {
      const note = panel.querySelector("small");
      if (note) panel.insertBefore(option, note);
      else panel.appendChild(option);
    }
  }

  function withDualSourceRows(displayed, row, visibleVariables) {
    const showDual = visibleVariables instanceof Set
      ? visibleVariables.has(DUAL_SOURCE_VISIBLE_KEY)
      : Array.isArray(visibleVariables) && visibleVariables.includes(DUAL_SOURCE_VISIBLE_KEY);
    const dual = showDual ? dualSourceRows(row) : [];
    if (!dual.length) return displayed;
    const dualByKey = new Map(dual);
    const afterParent = {
      planned_pos: "planned_po_dual",
      firm_pos: "firm_po_dual",
    };
    const inserted = new Set();
    const out = [];
    for (const pair of displayed) {
      out.push(pair);
      const dualKey = afterParent[pair[0]];
      if (dualKey && dualByKey.has(dualKey)) {
        out.push([dualKey, dualByKey.get(dualKey)]);
        inserted.add(dualKey);
      }
    }
    for (const pair of dual) {
      if (inserted.has(pair[0])) continue;
      const siIdx = out.findIndex(([key]) => key === "inv_projection");
      if (siIdx >= 0) out.splice(siIdx, 0, pair);
      else out.push(pair);
    }
    return out;
  }

  /* Replace axis exclusions with the data types the user turned off, on the weeks they chose. */
  function applyScopedToggle(store, weeks, offKeys) {
    store.clear();
    const dates = [...new Set((weeks || []).map(String).filter(Boolean))];
    if (!dates.length) return;
    (offKeys || []).forEach(key => {
      if (!TOGGLEABLE_VARIABLES.has(key)) return;
      store.setWeeks(key, dates, true);
    });
  }

  /* Keep a data type that is off for every currently selected week off when the week list changes. */
  function retainScopeExclusions(store, previousWeeks, nextWeeks, keys) {
    const previous = previousWeeks || [];
    const next = nextWeeks || [];
    if (!previous.length) return;
    if (!next.length) {
      store.clear();
      return;
    }
    const prev = new Set(previous);
    const nextSet = new Set(next);
    const added = next.filter(week => !prev.has(week));
    const removed = previous.filter(week => !nextSet.has(week));
    (keys || []).forEach(key => {
      if (!store.covers(key, previous)) return;
      if (added.length) store.setWeeks(key, added, true);
      if (removed.length) store.setWeeks(key, removed, false);
    });
  }

  const scopeExclusions = {
    eta: createScopeExclusionStore(),
    etd: createScopeExclusionStore(),
  };

  function weekScopeLabel(iso) {
    return String(iso || "").slice(5);
  }

  /* Multi-select of ISO weeks. Empty selection means Data Type toggles the whole timeline. */
  function createScopeWeekFilter({ rootId, triggerId, labelId, panelId, onChange, emptyLabel = "Entire timeline", hint = "Empty selection toggles a data type on the whole timeline. Selected weeks limit that toggle to those dates." }) {
    const root = document.getElementById(rootId);
    const trigger = document.getElementById(triggerId);
    const label = document.getElementById(labelId);
    const panel = document.getElementById(panelId);
    if (!root || !trigger || !label || !panel) return null;
    let options = [];
    let selected = [];
    let open = false;
    let fieldClear = { sync() {} };

    function positionPanel() {
      const rect = trigger.getBoundingClientRect();
      const width = Math.max(rect.width, 220);
      let left = rect.left;
      if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
      panel.style.position = "fixed";
      panel.style.left = `${left}px`;
      panel.style.top = `${rect.bottom + 4}px`;
      panel.style.width = `${width}px`;
      panel.style.zIndex = "1000";
    }

    function paintLabel() {
      if (!selected.length) label.textContent = emptyLabel;
      else if (selected.length === 1) label.textContent = weekScopeLabel(selected[0]);
      else label.textContent = `${selected.length} weeks`;
      trigger.classList.toggle("has-filter", selected.length > 0);
      fieldClear.sync();
    }

    function renderOptions() {
      const chosen = new Set(selected);
      const rows = options.map(iso =>
        `<label><input type="checkbox" value="${esc(iso)}"${chosen.has(iso) ? " checked" : ""}><span>${esc(weekScopeLabel(iso))}</span></label>`
      ).join("");
      panel.innerHTML = `<label class="variable-filter-all"><input type="checkbox" data-clear ${selected.length ? "" : "checked"}><span>${esc(emptyLabel)}</span></label>${rows}<small>${esc(hint)}</small>`;
    }

    function readSelection() {
      selected = [...panel.querySelectorAll('input[type="checkbox"]:not([data-clear])')]
        .filter(check => check.checked)
        .map(check => check.value);
      const clear = panel.querySelector("input[data-clear]");
      if (clear) {
        clear.checked = selected.length === 0;
        clear.indeterminate = false;
      }
      paintLabel();
    }

    function close() {
      if (!open) return;
      open = false;
      root.classList.remove("open");
      panel.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      if (panel.parentElement !== root) root.appendChild(panel);
      if (!document.querySelector(".search-select.open") && !document.querySelector(".variable-filter.open")) {
        document.body.classList.remove("filter-dropdown-open");
      }
    }

    function openPanel() {
      document.querySelectorAll(".variable-filter.open").forEach(node => {
        if (node !== root) node.querySelector(".variable-filter-trigger")?.click();
      });
      open = true;
      root.classList.add("open");
      document.body.classList.add("filter-dropdown-open");
      panel.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      if (panel.parentElement !== document.body) document.body.appendChild(panel);
      positionPanel();
    }

    function setOptions(weeks) {
      options = [...new Set((weeks || []).map(String))];
      selected = selected.filter(iso => options.includes(iso));
      renderOptions();
      paintLabel();
    }

    function setValues(weeks, { notify = false } = {}) {
      const allowed = new Set(options);
      selected = [...new Set((weeks || []).map(String))].filter(iso => !options.length || allowed.has(iso));
      renderOptions();
      paintLabel();
      if (notify) onChange(selected.slice());
    }

    fieldClear = attachFieldClearButton(trigger, {
      isActive: () => selected.length > 0,
      onClear() {
        selected = [];
        renderOptions();
        paintLabel();
        onChange([]);
      },
    });

    trigger.addEventListener("click", () => {
      if (open) close();
      else openPanel();
    });
    panel.addEventListener("change", event => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement)) return;
      if (input.hasAttribute("data-clear")) {
        selected = [];
        renderOptions();
        paintLabel();
        onChange([]);
        return;
      }
      readSelection();
      onChange(selected.slice());
    });
    document.addEventListener("mousedown", event => {
      if (event.target.closest(`#${rootId}`) || event.target.closest(`#${panelId}`)) return;
      close();
    });
    window.addEventListener("resize", close);
    window.addEventListener("scroll", event => {
      if (event.target instanceof Element && event.target.closest(`#${panelId}`)) return;
      if (event.target instanceof Element && event.target.closest(".filter-bar-global-scroll")) return;
      close();
    }, true);

    paintLabel();
    return {
      close,
      setOptions,
      setValues,
      getValues: () => selected.slice(),
      isOpen: () => open,
    };
  }

  return {
    SI_INPUTS,
    TOGGLEABLE_VARIABLES,
    VARIABLE_INPUTS,
    DISPLAY_VARIABLES,
    DUAL_SOURCE_VISIBLE_KEY,
    rowKind,
    dualSourceRows,
    withDualSourceRows,
    ensureDualSourceShowRowsOption,
    RISK_FILTER_LABELS,
    esc,
    number,
    csvEscape,
    downloadCsv,
    weeksBetween,
    createExclusionStore,
    createScopeExclusionStore,
    scopeExclusions,
    retainScopeExclusions,
    applyScopedToggle,
    createScopeWeekFilter,
    recalculateProjection,
    rowValues,
    formatSsPct,
    formatCell,
    ssPctTone,
    cellTone,
    metricColor,
    attachFieldClearButton,
    ProjectionFilterSync: createProjectionFilterSync(),
  };
})();
