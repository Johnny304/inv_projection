/* Item × Vendor view — independent of warehouse projection board. */
(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const DISPLAY_LIMIT = 100;
  const core = window.ProjectionCore;
  const VARIABLE_INPUTS = core.VARIABLE_INPUTS;
  const DISPLAY_VARIABLES = core.DISPLAY_VARIABLES;
  const DEFAULT_VARS = VARIABLE_INPUTS.map(([k]) => k);
  const DEFAULT_VISIBLE = [...DISPLAY_VARIABLES.map(([k]) => k), core.DUAL_SOURCE_VISIBLE_KEY];
  const TOGGLEABLE_VARIABLES = core.TOGGLEABLE_VARIABLES;
  const FILTER_SYNC = core.ProjectionFilterSync;
  const SHARED_FILTER_IDS = {
    vendor: "iv-vendor-filter",
    series: "iv-series-filter",
    item: "iv-item-filter",
    profile: "iv-profile-filter",
    division: "iv-division-filter",
    mb: "iv-mb-filter",
    risk_filter: "iv-risk-filter",
  };

  const state = {
    dashboard: null,
    weekStart: 0,
    weekEnd: 0,
    weekRangeInitialized: false,
    weekDrag: null,
    weekDragReady: false,
    filterOptions: {},
    enabledVariables: new Set(DEFAULT_VARS),
    visibleVariables: new Set(DEFAULT_VISIBLE),
    exclusions: core.createExclusionStore(),
    scopeWeeks: [],
    armedOff: new Set(),
    exclusionAnchor: null,
    loaded: false,
    applyingSharedFilters: false,
  };
  const widgets = new Map();
  let variableController = null;
  let showRowsController = null;
  let scopeWeekController = null;
  const scopeStore = core.scopeExclusions.eta;

  const esc = core.esc;
  const number = core.number;

  async function api(path, options = {}) {
    window.ProjectionLoading?.start();
    try {
      if (window.ProjectionStaticApi) {
        return await window.ProjectionStaticApi.handle(path, options);
      }
      const res = await fetch(path, options);
      if (!res.ok) throw new Error("Request failed");
      return await res.json();
    } finally {
      window.ProjectionLoading?.stop();
    }
  }
  function toast(message) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 2600);
  }

  function weeks() {
    return state.dashboard?.weeks || [];
  }

  function isWeekExcluded(item, week, variable) {
    return state.exclusions.isExcluded(item, week, variable);
  }

  function visibleWeeksForExclusion() {
    return selectedWeekIndexes().keys;
  }

  function refreshAfterExclusion(message) {
    renderTable();
    if (message) toast(message);
  }

  function handleExclusionCellClick(event, item, week, variable) {
    if (event.shiftKey && state.exclusionAnchor
        && state.exclusionAnchor.item === item
        && state.exclusionAnchor.variable === variable) {
      const range = core.weeksBetween(weeks(), state.exclusionAnchor.week, week);
      const excluded = !isWeekExcluded(item, week, variable);
      state.exclusions.set(item, range, variable, excluded);
      state.exclusionAnchor = { item, variable, week };
      refreshAfterExclusion(
        excluded ? `Excluded ${range.length} weeks from SI` : `Included ${range.length} weeks in SI`,
      );
      return;
    }
    state.exclusions.toggle(item, week, variable);
    const excluded = isWeekExcluded(item, week, variable);
    state.exclusionAnchor = { item, variable, week };
    refreshAfterExclusion(excluded ? "Excluded from SI (Item × week)" : "Included in SI again");
  }

  function handleExclusionRowToggle(item, variable) {
    const weekList = visibleWeeksForExclusion();
    if (!weekList.length) return;
    const allExcluded = weekList.every(week => isWeekExcluded(item, week, variable));
    const excluded = !allExcluded;
    state.exclusions.set(item, weekList, variable, excluded);
    state.exclusionAnchor = { item, variable, week: weekList[0] };
    refreshAfterExclusion(
      excluded
        ? `Excluded ${weekList.length} visible weeks from SI`
        : `Included ${weekList.length} visible weeks in SI`,
    );
  }

  function pruneWeekExclusions() {
    state.exclusions.prune({
      weeks: weeks(),
      items: (state.dashboard?.rows || []).map(row => row.item),
    });
    state.exclusionAnchor = null;
  }

  function recalculatedProjection(row, weekList) {
    return core.recalculateProjection(row, weekList || weeks(), {
      enabled: state.enabledVariables,
      exclusions: state.exclusions,
      scopeExclusions: scopeStore,
    });
  }

  function variableCheckValues() {
    return DEFAULT_VARS.filter(key => !state.armedOff.has(key));
  }

  function applyEtaToggle() {
    state.enabledVariables = new Set(DEFAULT_VARS);
    core.applyScopedToggle(scopeStore, state.scopeWeeks, [...state.armedOff]);
  }

  function paintVariableChecks() {
    variableController?.setValues(variableCheckValues(), { silent: true });
  }

  function cellIsExcluded(item, week, key) {
    return state.exclusions.isExcluded(item, week, key) || scopeStore.isExcluded(week, key);
  }

  function displayedVariables() {
    // Visible row = Show rows on AND (SI-enabled OR display-only). SI Projection always shows.
    return [
      ...DISPLAY_VARIABLES.filter(([key]) => {
        if (!state.visibleVariables.has(key)) return false;
        if (TOGGLEABLE_VARIABLES.has(key)) return state.enabledVariables.has(key);
        return true;
      }),
      ["inv_projection", "SI Projection"],
    ];
  }

  function rowValues(row, key, projection) {
    return core.rowValues(row, key, projection || recalculatedProjection(row));
  }

  function selectedWeekIndexes() {
    const keys = weeks();
    const start = Math.max(0, Math.min(state.weekStart, keys.length - 1));
    const end = Math.max(start, Math.min(state.weekEnd, keys.length - 1));
    return { keys: keys.slice(start, end + 1), indexes: keys.map((_, i) => i).slice(start, end + 1) };
  }

  function updateWeekRangeUI() {
    const keys = weeks();
    const n = keys.length;
    const fromEl = $("#iv-week-from");
    const toEl = $("#iv-week-to");
    if (!n || !fromEl || !toEl) return;
    state.weekStart = Math.max(0, Math.min(state.weekStart, n - 1));
    state.weekEnd = Math.max(state.weekStart, Math.min(state.weekEnd, n - 1));
    fromEl.min = keys[0];
    fromEl.max = keys[n - 1];
    toEl.min = keys[0];
    toEl.max = keys[n - 1];
    fromEl.value = keys[state.weekStart];
    toEl.value = keys[state.weekEnd];
    const pctFrom = n > 1 ? (state.weekStart / (n - 1)) * 100 : 0;
    const pctTo = n > 1 ? (state.weekEnd / (n - 1)) * 100 : 100;
    $("#iv-week-thumb-from").style.left = `${pctFrom}%`;
    $("#iv-week-thumb-to").style.left = `${pctTo}%`;
    $("#iv-week-range-fill").style.left = `${pctFrom}%`;
    $("#iv-week-range-fill").style.width = `${pctTo - pctFrom}%`;
    $("#iv-week-box").classList.toggle("has-filter", !(state.weekStart === 0 && state.weekEnd === n - 1));
  }

  function resetWeekRange(render = true, sync = false) {
    const n = weeks().length;
    state.weekStart = 0;
    state.weekEnd = Math.max(0, n - 1);
    updateWeekRangeUI();
    if (render) renderTable();
    if (sync) publishSharedFilterState();
  }

  function idxForWeekDate(isoDate, pickLast) {
    const keys = weeks();
    if (!keys.length) return 0;
    if (pickLast) {
      for (let i = keys.length - 1; i >= 0; i--) if (keys[i] <= isoDate) return i;
      return keys.length - 1;
    }
    for (let i = 0; i < keys.length; i++) if (keys[i] >= isoDate) return i;
    return keys.length - 1;
  }

  function dashboardQuery({ limit = DISPLAY_LIMIT } = {}) {
    const params = new URLSearchParams();
    $$("#projection-iv .iv-search-select").forEach(root => {
      const param = root.dataset.param;
      const widget = widgets.get(root.dataset.filterId);
      const values = widget?.getValues?.() || [];
      if (param) values.forEach(value => params.append(param, value));
    });
    params.set("limit", String(limit));
    params.set("grain", "item_vendor");
    return params;
  }

  function sharedFilterState() {
    const filters = {};
    Object.entries(SHARED_FILTER_IDS).forEach(([key, id]) => {
      filters[key] = widgets.get(id)?.getValues?.() || [];
    });
    return {
      ...filters,
      variables: FILTER_SYNC.get().variables,
      visibleVariables: [...state.visibleVariables],
      weekFrom: $("#iv-week-from")?.value || "",
      weekTo: $("#iv-week-to")?.value || "",
      etaToggleWeeks: state.scopeWeeks.slice(),
      etdToggleWeeks: FILTER_SYNC.get().etdToggleWeeks || [],
      etaArmedOff: [...state.armedOff],
    };
  }

  function publishSharedFilterState() {
    if (!state.applyingSharedFilters) FILTER_SYNC.set(sharedFilterState(), { source: "iv" });
  }

  function applySharedWeekRange(shared) {
    const keys = weeks();
    if (!keys.length) return;
    if (shared.weekFrom) state.weekStart = idxForWeekDate(shared.weekFrom, false);
    if (shared.weekTo) state.weekEnd = idxForWeekDate(shared.weekTo, true);
    if (state.weekEnd < state.weekStart) state.weekEnd = state.weekStart;
    updateWeekRangeUI();
  }

  function applySharedFilterState(shared) {
    if (!shared) return;
    state.applyingSharedFilters = true;
    try {
      Object.entries(SHARED_FILTER_IDS).forEach(([key, id]) => {
        widgets.get(id)?.setValues(shared[key] || [], { notify: false });
      });
      state.scopeWeeks = [...(shared.etaToggleWeeks || [])];
      state.armedOff = new Set(shared.etaArmedOff || []);
      state.enabledVariables = new Set(DEFAULT_VARS);
      applyEtaToggle();
      variableController?.setValues(variableCheckValues(), { silent: true });
      showRowsController?.setValues(shared.visibleVariables || DEFAULT_VISIBLE);
    } finally {
      state.applyingSharedFilters = false;
    }
    scopeWeekController?.setValues(state.scopeWeeks);
    paintVariableChecks();
    applySharedWeekRange(shared);
  }

  function renderTable() {
    const { keys: weekLabels, indexes } = selectedWeekIndexes();
    const rows = state.dashboard?.rows || [];
    const head = `<thead><tr>
      <th class="identity item">Item</th>
      <th class="identity vendor">Vendor</th>
      <th class="identity variable">Data Types</th>
      ${weekLabels.map(w => `<th>${w.slice(5)}</th>`).join("")}
    </tr></thead>`;
    const allWeeks = weeks();
    const body = rows.map(row => {
      // One roll per row, reused by every SI cell in that row.
      const projection = recalculatedProjection(row, allWeeks);
      const variables = core.withDualSourceRows(displayedVariables(), row, state.visibleVariables);
      return variables.map(([key, label], variableIndex) => {
        const identity = variableIndex === 0
          ? `<td class="identity item" rowspan="${variables.length}" title="${esc(row.item)} · ${esc(row.series)} · ${esc(row.division)}">${esc(row.item)}</td><td class="identity vendor" rowspan="${variables.length}" title="${esc(row.vendor)}">${esc(row.vendor)}</td>`
          : "";
        const series = rowValues(row, key, projection);
        const toggleable = TOGGLEABLE_VARIABLES.has(key);
        const cells = indexes.map(index => {
          const value = series[index];
          const week = allWeeks[index];
          const excluded = toggleable && cellIsExcluded(row.item, week, key);
          const tdClasses = [core.cellTone(key, value), excluded ? "excluded" : ""].filter(Boolean).join(" ");
          const stateLabel = excluded ? "Excluded from SI" : "Included in SI";
          const attrs = toggleable
            ? ` title="${stateLabel} · Shift+click for week range" aria-pressed="${excluded}" aria-label="${esc(label)} ${week} ${stateLabel}"`
            : "";
          return `<td class="${tdClasses}"><button class="cell${excluded ? " excluded" : ""}"${attrs} data-item="${esc(row.item)}" data-vendor="${esc(row.vendor)}" data-week="${week}" data-variable="${key}">${core.formatCell(key, value)}</button></td>`;
        }).join("");
        const varCell = toggleable
          ? `<td class="identity variable"><button type="button" class="var-toggle" title="Toggle all visible weeks for this Item × data type" data-item="${esc(row.item)}" data-variable="${key}">${label}</button></td>`
          : `<td class="identity variable">${label}</td>`;
        const kind = core.rowKind(key);
        const trClass = [variableIndex === 0 ? "group-start" : "", `kind-${kind}`].filter(Boolean).join(" ");
        return `<tr class="${trClass}">${identity}${varCell}${cells}</tr>`;
      }).join("");
    }).join("");
    $("#iv-projection-table").innerHTML = head + `<tbody>${body || `<tr><td colspan="10">No items match the current scope.</td></tr>`}</tbody>`;
  }

  /* Bound once: the table body is replaced on every render. */
  function initTableDelegation() {
    $("#iv-projection-table").addEventListener("click", event => {
      const varToggle = event.target.closest(".var-toggle");
      if (varToggle) {
        handleExclusionRowToggle(varToggle.dataset.item, varToggle.dataset.variable);
        return;
      }
      const cell = event.target.closest(".cell");
      if (!cell) return;
      const { item, week, variable } = cell.dataset;
      if (TOGGLEABLE_VARIABLES.has(variable) && !event.ctrlKey && !event.metaKey) {
        handleExclusionCellClick(event, item, week, variable);
        return;
      }
      openDetail(cell.dataset);
    });
  }

  function openDetail(data) {
    const row = state.dashboard.rows.find(entry => entry.item === data.item && entry.vendor === data.vendor);
    if (!row) return;
    const weekIndex = state.dashboard.weeks.indexOf(data.week);
    const projection = recalculatedProjection(row);
    $("#drawer-title").textContent = `${row.item} · ${data.week}`;
    $("#drawer-subtitle").textContent = `${row.series} · ${row.division} · ${row.profile}`;
    $("#drawer-route").textContent = `${row.vendor}  →  all warehouses  →  ${data.week}`;
    const metrics = [
      ...VARIABLE_INPUTS
        .filter(([key]) => state.enabledVariables.has(key))
        .map(([key, label]) => [label, row.values[key]?.[weekIndex] ?? 0, key]),
      ["Promo Lift", row.values.promotional_lift?.[weekIndex] ?? 0, "promotional_lift"],
      ["Safety", row.values.safety_stock?.[weekIndex] ?? 0, "safety_stock"],
      ["SI-SS", core.rowValues(row, "si_ss", projection)[weekIndex], "si_ss"],
      ["SS%", core.rowValues(row, "ss_pct", projection)[weekIndex], "ss_pct"],
      ["SI Projection", projection[weekIndex], "inv_projection"],
    ];
    $("#drawer-metrics").innerHTML = metrics.map(([label, value, key]) =>
      `<div class="metric"><span>${label}</span><strong style="color:${core.metricColor(key || "", value)}">${core.formatCell(key || "", value)}</strong></div>`
    ).join("");
    const included = VARIABLE_INPUTS.filter(([key]) => state.enabledVariables.has(key)).map(([, label]) => label);
    const excludedHere = VARIABLE_INPUTS
      .filter(([key]) => state.enabledVariables.has(key) && cellIsExcluded(row.item, data.week, key))
      .map(([, label]) => label);
    const exclusionNote = excludedHere.length
      ? ` Excluded this week for SI: ${excludedHere.join(", ")}.`
      : "";
    $("#drawer-calc").textContent = `Item × Vendor (summed whse). SI = OnHand + SUPPLY − DEMAND with: ${included.join(", ") || "opening inventory only"}. Promo Lift, Safety, SI-SS, and SS% are display-only.${exclusionNote}`;
    $("#detail-drawer").classList.add("open");
    $("#detail-drawer").setAttribute("aria-hidden", "false");
    $("#scrim").classList.add("open");
  }

  function closeAll(except = null) {
    widgets.forEach(w => { if (w !== except) w.close(); });
  }

  function createSearchSelect(root) {
    const id = root.dataset.filterId;
    const allLabel = root.dataset.all || "All";
    const optionsKey = root.dataset.options;
    const hidden = $("#" + id, root);
    const trigger = $(".iv-search-select-trigger", root);
    const valueEl = $(".iv-search-select-value", root);
    const panel = $(".iv-search-select-panel", root);
    const query = $(".iv-search-select-query", root);
    const list = $(".iv-search-select-options", root);
    let open = false;
    let selected = new Set();

    function options() {
      return state.filterOptions[optionsKey] || [];
    }
    function optionLabel(value) {
      return optionsKey === "risk_filters"
        ? (core.RISK_FILTER_LABELS[value] || value)
        : value;
    }
    function readHidden() {
      const raw = hidden.value || "";
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
      } catch {
        return raw.split("\u001e").filter(Boolean);
      }
    }
    function writeHidden() {
      const values = [...selected];
      hidden.value = values.length ? JSON.stringify(values) : "";
    }
    function labelForSelection() {
      const values = [...selected];
      if (!values.length) return allLabel;
      if (values.length === 1) return optionLabel(values[0]);
      return `${values.length} selected`;
    }
    function syncActive() {
      trigger.classList.toggle("has-filter", selected.size > 0);
      fieldClear.sync();
    }
    function refreshLabel() {
      valueEl.textContent = labelForSelection();
      valueEl.title = selected.size ? [...selected].join(", ") : allLabel;
      syncActive();
    }
    function setValues(values, { notify = false } = {}) {
      selected = new Set((values || []).filter(Boolean).map(String));
      writeHidden();
      refreshLabel();
      if (notify) {
        publishSharedFilterState();
        loadDashboard().catch(err => { console.error(err); toast("Could not refresh Item × Vendor view."); });
      }
    }
    function setValue(value, { notify = false } = {}) {
      if (Array.isArray(value)) setValues(value, { notify });
      else if (!value) setValues([], { notify });
      else setValues([value], { notify });
    }
    const fieldClear = core.attachFieldClearButton(trigger, {
      isActive: () => selected.size > 0,
      onClear: () => setValues([], { notify: true }),
    });
    function toggleValue(value, { notify = true } = {}) {
      if (!value) {
        setValues([], { notify });
        return;
      }
      if (selected.has(value)) selected.delete(value);
      else selected.add(value);
      writeHidden();
      refreshLabel();
      renderOptions();
      if (notify) {
        publishSharedFilterState();
        loadDashboard().catch(err => { console.error(err); toast("Could not refresh Item × Vendor view."); });
      }
    }
    function renderOptions() {
      const q = query.value.trim().toLowerCase();
      const all = options();
      const matched = q ? all.filter(v => String(v).toLowerCase().includes(q)) : all;
      const shown = matched.slice(0, 120);
      list.innerHTML = [
        `<li><button type="button" class="search-select-option search-select-clear${selected.size ? "" : " selected"}" data-value="">All</button></li>`,
        ...shown.map(value => {
          const on = selected.has(value);
          return `<li><button type="button" class="search-select-option multi${on ? " selected" : ""}" data-value="${esc(value)}" title="${esc(optionLabel(value))}"><span class="search-select-check" aria-hidden="true"></span><span class="search-select-option-text">${esc(optionLabel(value))}</span></button></li>`;
        }),
        matched.length > shown.length ? `<li class="search-select-empty">Showing ${shown.length} of ${matched.length}</li>` : "",
      ].join("");
      $$(".search-select-option", list).forEach(button => {
        button.addEventListener("click", event => {
          event.preventDefault();
          const value = button.dataset.value;
          if (!value) {
            setValues([], { notify: true });
            close();
            return;
          }
          toggleValue(value, { notify: true });
        });
      });
    }
    function positionPanel() {
      const rect = trigger.getBoundingClientRect();
      const width = Math.max(rect.width, 240);
      let left = rect.left;
      if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
      panel.style.position = "fixed";
      panel.style.left = `${left}px`;
      panel.style.top = `${rect.bottom + 4}px`;
      panel.style.width = `${width}px`;
      panel.style.zIndex = "1000";
    }
    function openPanel() {
      closeAll(api);
      variableController?.close?.();
      showRowsController?.close?.();
      open = true;
      root.classList.add("open");
      document.body.classList.add("filter-dropdown-open");
      panel.hidden = false;
      if (panel.parentElement !== document.body) document.body.appendChild(panel);
      query.value = "";
      positionPanel();
      renderOptions();
      requestAnimationFrame(() => query.focus());
    }
    function close() {
      if (!open) return;
      open = false;
      root.classList.remove("open");
      panel.hidden = true;
      if (panel.parentElement !== root) root.appendChild(panel);
      if (!document.querySelector(".iv-search-select.open") && !$("#variable-filter.open") && !$("#iv-variable-filter.open")) {
        document.body.classList.remove("filter-dropdown-open");
      }
    }
    selected = new Set(readHidden());
    refreshLabel();
    const api = {
      setValue,
      setValues,
      getValues: () => [...selected],
      close,
      setOptions() {
        const allowed = new Set(options().map(String));
        const next = [...selected].filter(v => allowed.has(v));
        if (next.length !== selected.size) {
          setValues(next, { notify: false });
          return true;
        }
        refreshLabel();
        return false;
      },
    };
    trigger.addEventListener("click", () => (open ? close() : openPanel()));
    query.addEventListener("input", renderOptions);
    widgets.set(id, api);
    return api;
  }

  function initCheckboxFilter({
    rootId,
    triggerId,
    labelId,
    panelId,
    defaults,
    onSync,
    onChange,
  }) {
    const root = $(`#${rootId}`);
    const trigger = $(`#${triggerId}`);
    const label = $(`#${labelId}`);
    const panel = $(`#${panelId}`);
    if (!root || !trigger || !label || !panel) return null;
    const allCheck = $('input[type="checkbox"][data-all]', panel);
    if (/show-rows-filter/.test(rootId)) core.ensureDualSourceShowRowsOption(panel);
    const checks = $$('input[type="checkbox"]:not([data-all])', panel);
    let open = false;
    let fieldClear = { sync() {} };

    function syncAllCheck() {
      if (!allCheck) return;
      const n = checks.length;
      const on = checks.filter(c => c.checked).length;
      allCheck.checked = n > 0 && on === n;
      allCheck.indeterminate = on > 0 && on < n;
    }

    function sync() {
      const values = checks.filter(c => c.checked).map(c => c.value);
      onSync(values);
      label.textContent = `${values.length} of ${defaults.length}`;
      trigger.classList.toggle("has-filter", values.length !== defaults.length);
      syncAllCheck();
      fieldClear.sync();
    }

    function setValues(values, { silent = false } = {}) {
      const enabled = new Set(values || []);
      checks.forEach(check => { check.checked = enabled.has(check.value); });
      if (silent) {
        const checked = checks.filter(check => check.checked);
        label.textContent = `${checked.length} of ${defaults.length}`;
        trigger.classList.toggle("has-filter", checked.length !== defaults.length);
        syncAllCheck();
        fieldClear.sync();
        return;
      }
      sync();
    }
    function close() {
      if (!open) return;
      open = false;
      root.classList.remove("open");
      panel.hidden = true;
      if (panel.parentElement !== root) root.appendChild(panel);
      if (!document.querySelector(".iv-search-select.open") && !document.querySelector(".variable-filter.open")) {
        document.body.classList.remove("filter-dropdown-open");
      }
    }
    function openPanel() {
      closeAll();
      if (rootId !== "iv-variable-filter") variableController?.close?.();
      if (rootId !== "iv-show-rows-filter") showRowsController?.close?.();
      open = true;
      root.classList.add("open");
      document.body.classList.add("filter-dropdown-open");
      panel.hidden = false;
      if (panel.parentElement !== document.body) document.body.appendChild(panel);
      const rect = trigger.getBoundingClientRect();
      panel.style.position = "fixed";
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.bottom + 4}px`;
      panel.style.width = `${Math.max(rect.width, 240)}px`;
      panel.style.zIndex = "1000";
    }
    function reset() {
      checks.forEach(c => { c.checked = true; });
      sync();
    }
    fieldClear = core.attachFieldClearButton(trigger, {
      isActive: () => checks.filter(c => c.checked).length !== defaults.length,
      onClear() {
        reset();
        onChange();
      },
    });
    trigger.addEventListener("click", () => (open ? close() : openPanel()));
    allCheck?.addEventListener("change", () => {
      const on = allCheck.checked;
      checks.forEach(check => { check.checked = on; });
      sync();
      onChange();
    });
    checks.forEach(check => check.addEventListener("change", () => {
      sync();
      onChange();
    }));
    document.addEventListener("mousedown", event => {
      if (event.target.closest(`#${rootId}`) || event.target.closest(`#${panelId}`)) return;
      close();
    });
    sync();
    return {
      close,
      setValues,
      reset,
    };
  }

  function initScopeWeekFilter() {
    scopeWeekController = core.createScopeWeekFilter({
      rootId: "iv-scope-weeks",
      triggerId: "iv-scope-weeks-trigger",
      labelId: "iv-scope-weeks-label",
      panelId: "iv-scope-weeks-panel",
      onChange(weekList) {
        state.scopeWeeks = weekList.slice();
        applyEtaToggle();
        renderTable();
        const routes = state.dashboard?.rows?.length || 0;
        if (state.scopeWeeks.length && state.armedOff.size) {
          toast(`Toggled ${state.armedOff.size} data type(s) on ${state.scopeWeeks.length} weeks across ${routes} routes`);
        } else if (state.scopeWeeks.length) {
          toast("Turn off a Data Type first. These weeks will then drop it from SI.");
        }
        publishSharedFilterState();
      },
      emptyLabel: "No weeks yet",
      hint: "Choose Data Types to turn off, then pick the ETA weeks that should drop those types from SI.",
    });
  }

  function syncScopeWeeksFromDashboard() {
    const present = new Set(weeks());
    state.scopeWeeks = state.scopeWeeks.filter(iso => present.has(iso));
    applyEtaToggle();
    scopeWeekController?.setOptions(weeks());
    scopeWeekController?.setValues(state.scopeWeeks);
    paintVariableChecks();
  }

  function initVariableFilter() {
    return initCheckboxFilter({
      rootId: "iv-variable-filter",
      triggerId: "iv-variable-filter-trigger",
      labelId: "iv-variable-filter-label",
      panelId: "iv-variable-filter-panel",
      defaults: DEFAULT_VARS,
      onSync(values) {
        if (state.applyingSharedFilters) return;
        const checked = new Set(values);
        state.armedOff = new Set(DEFAULT_VARS.filter(key => !checked.has(key)));
        applyEtaToggle();
      },
      onChange() {
        renderTable();
        if (!state.scopeWeeks.length && state.armedOff.size) {
          toast("Choose Apply to ETA weeks to toggle the selected data types");
        }
        publishSharedFilterState();
      },
    });
  }

  function initShowRowsFilter() {
    return initCheckboxFilter({
      rootId: "iv-show-rows-filter",
      triggerId: "iv-show-rows-filter-trigger",
      labelId: "iv-show-rows-filter-label",
      panelId: "iv-show-rows-filter-panel",
      defaults: DEFAULT_VISIBLE,
      onSync(values) {
        state.visibleVariables = new Set(values);
      },
      onChange() {
        renderTable();
        publishSharedFilterState();
      },
    });
  }

  async function loadDashboard({ resetWeeks = false, allowPruneReload = true } = {}) {
    state.dashboard = await api(`/api/dashboard?${dashboardQuery()}`);
    pruneWeekExclusions();
    const options = state.dashboard.filter_options || {};
    state.filterOptions = {
      items: options.items || [],
      vendors: options.vendors || [],
      mb_codes: options.mb_codes || [],
      series: options.series || [],
      divisions: options.divisions || [],
      profiles: options.profiles || [],
      risk_filters: options.risk_filters || ["before_lock_week", "in_lock_week", "out_of_lock_week"],
    };
    let pruned = false;
    widgets.forEach(w => {
      if (w.setOptions()) pruned = true;
    });
    if (pruned && allowPruneReload) {
      await loadDashboard({ resetWeeks, allowPruneReload: false });
      return;
    }
    if (resetWeeks || !state.weekRangeInitialized) resetWeekRange(false);
    else updateWeekRangeUI();
    syncScopeWeeksFromDashboard();
    state.weekRangeInitialized = true;
    renderTable();
  }

  function initWeekDrag() {
    if (state.weekDragReady) return;
    state.weekDragReady = true;
    const track = $("#iv-week-range-track");
    const weekIdxFromEvent = event => {
      const n = weeks().length;
      if (!track || n <= 1) return 0;
      const rect = track.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      return Math.round(pct * (n - 1));
    };
    $("#iv-week-thumb-from").addEventListener("mousedown", event => { event.preventDefault(); state.weekDrag = "from"; });
    $("#iv-week-thumb-to").addEventListener("mousedown", event => { event.preventDefault(); state.weekDrag = "to"; });
    track.addEventListener("mousedown", event => {
      if (event.target.classList.contains("week-range-thumb")) return;
      const idx = weekIdxFromEvent(event);
      state.weekDrag = Math.abs(idx - state.weekStart) <= Math.abs(idx - state.weekEnd) ? "from" : "to";
      if (state.weekDrag === "from") state.weekStart = Math.min(idx, state.weekEnd);
      else state.weekEnd = Math.max(idx, state.weekStart);
      updateWeekRangeUI();
      renderTable();
    });
    document.addEventListener("mousemove", event => {
      if (!state.weekDrag) return;
      const idx = weekIdxFromEvent(event);
      if (state.weekDrag === "from") state.weekStart = Math.min(idx, state.weekEnd);
      else state.weekEnd = Math.max(idx, state.weekStart);
      updateWeekRangeUI();
    });
    document.addEventListener("mouseup", () => {
      if (!state.weekDrag) return;
      state.weekDrag = null;
      renderTable();
      publishSharedFilterState();
    });
  }

  async function ensureLoaded() {
    if (state.loaded) return;
    state.loaded = true;
    $$("#projection-iv .iv-search-select").forEach(createSearchSelect);
    variableController = initVariableFilter();
    showRowsController = initShowRowsFilter();
    initScopeWeekFilter();
    FILTER_SYNC.subscribe((shared, { source }) => {
      if (source === "iv") return;
      applySharedFilterState(shared);
      if (!state.dashboard) return;
      loadDashboard().catch(err => {
        console.error(err);
        toast("Could not sync Item × Vendor filters.");
      });
    });
    applySharedFilterState(FILTER_SYNC.get());
    initWeekDrag();
    initTableDelegation();
    document.addEventListener("mousedown", event => {
      if (event.target.closest(".iv-search-select") || event.target.closest(".iv-search-select-panel")) return;
      closeAll();
    });
    $("#iv-week-from").addEventListener("change", () => {
      if ($("#iv-week-from").value) {
        state.weekStart = idxForWeekDate($("#iv-week-from").value, false);
        if (state.weekStart > state.weekEnd) state.weekEnd = state.weekStart;
      }
      updateWeekRangeUI();
      renderTable();
      publishSharedFilterState();
    });
    $("#iv-week-to").addEventListener("change", () => {
      if ($("#iv-week-to").value) {
        state.weekEnd = idxForWeekDate($("#iv-week-to").value, true);
        if (state.weekEnd < state.weekStart) state.weekStart = state.weekEnd;
      }
      updateWeekRangeUI();
      renderTable();
      publishSharedFilterState();
    });
    $("#iv-week-clear").addEventListener("click", () => resetWeekRange(true, true));
    $("#iv-clear-filters").addEventListener("click", () => {
      widgets.forEach(w => w.setValue("", { notify: false }));
      variableController?.reset();
      showRowsController?.reset();
      state.exclusions.clear();
      state.exclusionAnchor = null;
      state.scopeWeeks = [];
      state.armedOff = new Set();
      scopeStore.clear();
      scopeWeekController?.setValues([]);
      resetWeekRange(false);
      publishSharedFilterState();
      loadDashboard({ resetWeeks: true }).catch(err => { console.error(err); toast("Could not refresh Item × Vendor view."); });
    });
    $("#iv-export-button").addEventListener("click", () => {
      exportFullMatch().catch(err => {
        console.error(err);
        toast("Could not export full match.");
      });
    });
    await loadDashboard({ resetWeeks: true });
    applySharedWeekRange(FILTER_SYNC.get());
    renderTable();
  }

  async function exportFullMatch() {
    const button = $("#iv-export-button");
    if (button?.disabled) return;
    if (button) button.disabled = true;
    toast("Exporting full filter match…");
    try {
      const payload = await api(`/api/dashboard?${dashboardQuery({ limit: 0 })}`);
      const weeksAll = payload.weeks || [];
      const selectedKeys = selectedWeekIndexes().keys;
      const indexes = selectedKeys.map(key => weeksAll.indexOf(key)).filter(i => i >= 0);
      const weekLabels = indexes.map(i => weeksAll[i]);
      const rows = payload.rows || [];
      const variables = displayedVariables();
      const csvEscape = core.csvEscape;
      const headers = ["Item", "Vendor", "Series", "Division", "ProdResource", "MB", "Data Types", ...weekLabels];
      const lines = [headers.map(csvEscape).join(",")];
      for (const row of rows) {
        // Roll SI against the export payload's own week axis, not the on-screen one.
        const projection = recalculatedProjection(row, weeksAll);
        for (const [key, label] of core.withDualSourceRows(variables, row, state.visibleVariables)) {
          const vals = rowValues(row, key, projection);
          lines.push([
            row.item,
            row.vendor,
            row.series || "",
            row.division || "",
            row.profile || "",
            row.mb || "",
            label,
            ...indexes.map(i => {
              const v = vals[i];
              if (key === "ss_pct") return v == null || Number.isNaN(v) ? "" : Math.round(v);
              return v == null || Number.isNaN(v) ? "" : v;
            }),
          ].map(csvEscape).join(","));
        }
      }
      core.downloadCsv("inv-prj.csv", lines);
      toast(`Exported ${rows.length} routes (full match) · flat CSV`);
    } catch (error) {
      console.error(error);
      toast("Could not export full match.");
    } finally {
      if (button) button.disabled = false;
    }
  }

  document.addEventListener("click", event => {
    const button = event.target.closest(".nav-link[data-view='projection-iv'], [data-go='projection-iv']");
    if (!button) return;
    ensureLoaded().catch(err => {
      console.error(err);
      toast("Could not load Item × Vendor view.");
    });
  });

  document.addEventListener("projection-data-refreshed", () => {
    if (!state.loaded) return;
    loadDashboard().catch(err => {
      console.error(err);
      toast("Could not refresh Item × Vendor view.");
    });
  });
})();
