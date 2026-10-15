const core = window.ProjectionCore;
const TOGGLEABLE_VARIABLES = core.TOGGLEABLE_VARIABLES;
const VARIABLE_INPUTS = core.VARIABLE_INPUTS;
const DISPLAY_VARIABLES = core.DISPLAY_VARIABLES;
const DEFAULT_VARIABLES = VARIABLE_INPUTS.map(([key]) => key);
const DEFAULT_VISIBLE = [...DISPLAY_VARIABLES.map(([key]) => key), core.DUAL_SOURCE_VISIBLE_KEY];
const FILTER_SYNC = core.ProjectionFilterSync;
const SHARED_FILTER_IDS = {
  vendor: "vendor-filter",
  series: "series-filter",
  item: "item-filter",
  profile: "profile-filter",
  division: "division-filter",
  mb: "mb-filter",
  risk_filter: "risk-filter",
};

const state = {
  dashboard: null,
  selected: null,
  weekStart: 0,
  weekEnd: 0,
  weekRangeInitialized: false,
  weekDrag: null,
  weekDragReady: false,
  filtersLoaded: false,
  filterOptions: {},
  enabledVariables: new Set(DEFAULT_VARIABLES),
  visibleVariables: new Set(DEFAULT_VISIBLE),
  exclusions: core.createExclusionStore(),
  scopeWeeks: [],
  armedOff: new Set(),
  exclusionAnchor: null, // { item, variable, week } for Shift+click range
  applyingSharedFilters: false,
  lockWeeksByWarehouse: new Map(), // warehouse -> Set(ISO week dates)
};
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const FILTER_IDS = ["vendor-filter", "series-filter", "item-filter", "profile-filter", "division-filter", "warehouse-filter", "mb-filter", "risk-filter"];
const FILTER_OPTION_LIMIT = 120;
const searchSelects = new Map();
let variableFilterController = null;
let showRowsFilterController = null;
let scopeWeekController = null;
const scopeStore = core.scopeExclusions.eta;

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("inventory-projection-theme", theme);
  const isDark = theme === "dark";
  const button = $("#theme-toggle");
  if (button) {
    button.setAttribute("aria-pressed", String(isDark));
    $(".theme-toggle-icon", button).textContent = isDark ? "☀" : "☾";
    $(".theme-toggle-label", button).textContent = isDark ? "Light mode" : "Dark mode";
  }
}

setTheme(localStorage.getItem("inventory-projection-theme") || "light");

window.ProjectionLoading = window.ProjectionLoading || (() => {
  let pending = 0;
  let hideTimer = null;
  const indicator = () => $("#loading-indicator");
  const message = () => $("#loading-message");

  function start(text = "Loading data…") {
    pending += 1;
    clearTimeout(hideTimer);
    const el = indicator();
    if (!el) return;
    el.hidden = false;
    el.dataset.state = "loading";
    if (message()) message().textContent = text;
  }

  function stop() {
    pending = Math.max(0, pending - 1);
    if (pending > 0) return;
    const el = indicator();
    if (!el) return;
    el.dataset.state = "done";
    if (message()) message().textContent = "Done";
    hideTimer = setTimeout(() => { el.hidden = true; }, 800);
  }

  return { start, stop };
})();

async function api(path, options = {}) {
  window.ProjectionLoading.start();
  try {
    if (window.ProjectionStaticApi) {
      return await window.ProjectionStaticApi.handle(path, options);
    }
    const res = await fetch(path, options);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Request failed");
    return await res.json();
  } finally {
    window.ProjectionLoading.stop();
  }
}

const esc = core.esc;
const number = core.number;

function toast(message, ms = 2600) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), ms);
}

function openView(name) {
  $$(".view").forEach(view => view.classList.toggle("active", view.id === name));
  $$(".nav-link").forEach(button => button.classList.toggle("active", button.dataset.view === name));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function weekKeys() {
  return state.dashboard?.weeks || [];
}

function idxForWeekDate(isoDate, pickLast) {
  const keys = weekKeys();
  if (!keys.length) return 0;
  if (pickLast) {
    for (let i = keys.length - 1; i >= 0; i--) if (keys[i] <= isoDate) return i;
    return keys.length - 1;
  }
  for (let i = 0; i < keys.length; i++) if (keys[i] >= isoDate) return i;
  return keys.length - 1;
}

function selectedWeekIndexes() {
  const keys = weekKeys();
  const start = Math.max(0, Math.min(state.weekStart, keys.length - 1));
  const end = Math.max(start, Math.min(state.weekEnd, keys.length - 1));
  return { start, end, keys: keys.slice(start, end + 1), indexes: keys.map((_, i) => i).slice(start, end + 1) };
}

function updateWeekRangeUI() {
  const keys = weekKeys();
  const n = keys.length;
  const fromEl = $("#week-from");
  const toEl = $("#week-to");
  const fill = $("#week-range-fill");
  const thumbFrom = $("#week-thumb-from");
  const thumbTo = $("#week-thumb-to");
  if (!n) {
    fromEl.value = "";
    toEl.value = "";
    return;
  }
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
  thumbFrom.style.left = `${pctFrom}%`;
  thumbTo.style.left = `${pctTo}%`;
  fill.style.left = `${pctFrom}%`;
  fill.style.width = `${pctTo - pctFrom}%`;
  $("#week-box").classList.toggle("has-filter", !(state.weekStart === 0 && state.weekEnd === n - 1));
}

function onWeekDateChange(which) {
  const keys = weekKeys();
  if (!keys.length) return;
  const fromEl = $("#week-from");
  const toEl = $("#week-to");
  if (which === "from" && fromEl.value) {
    state.weekStart = idxForWeekDate(fromEl.value, false);
    if (state.weekStart > state.weekEnd) state.weekEnd = state.weekStart;
  }
  if (which === "to" && toEl.value) {
    state.weekEnd = idxForWeekDate(toEl.value, true);
    if (state.weekEnd < state.weekStart) state.weekStart = state.weekEnd;
  }
  updateWeekRangeUI();
  renderTable();
  publishSharedFilterState();
}

function resetWeekRange(render = true, sync = false) {
  const n = weekKeys().length;
  state.weekStart = 0;
  state.weekEnd = Math.max(0, n - 1);
  updateWeekRangeUI();
  if (render) renderTable();
  if (sync) publishSharedFilterState();
}

function weekIdxFromEvent(event) {
  const track = $("#week-range-track");
  const n = weekKeys().length;
  if (!track || n <= 1) return 0;
  const rect = track.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  return Math.round(pct * (n - 1));
}

function initWeekRangeDrag() {
  if (state.weekDragReady) return;
  state.weekDragReady = true;
  const thumbFrom = $("#week-thumb-from");
  const thumbTo = $("#week-thumb-to");
  const track = $("#week-range-track");
  thumbFrom.addEventListener("mousedown", event => { event.preventDefault(); state.weekDrag = "from"; });
  thumbTo.addEventListener("mousedown", event => { event.preventDefault(); state.weekDrag = "to"; });
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

function markActiveFilters() {
  FILTER_IDS.forEach(id => {
    const widget = searchSelects.get(id);
    if (widget) widget.syncActive();
  });
}

function sharedFilterState() {
  const filters = {};
  Object.entries(SHARED_FILTER_IDS).forEach(([key, id]) => {
    filters[key] = searchSelects.get(id)?.getValues?.() || [];
  });
  return {
    ...filters,
    variables: FILTER_SYNC.get().variables,
    visibleVariables: [...state.visibleVariables],
    weekFrom: $("#week-from")?.value || "",
    weekTo: $("#week-to")?.value || "",
    etaToggleWeeks: state.scopeWeeks.slice(),
    etdToggleWeeks: FILTER_SYNC.get().etdToggleWeeks || [],
    etaArmedOff: [...state.armedOff],
  };
}

function publishSharedFilterState() {
  if (!state.applyingSharedFilters) FILTER_SYNC.set(sharedFilterState(), { source: "whse" });
}

function applySharedWeekRange(shared) {
  const keys = weekKeys();
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
      searchSelects.get(id)?.setValues(shared[key] || [], { notify: false });
    });
    state.scopeWeeks = [...(shared.etaToggleWeeks || [])];
    state.armedOff = new Set(shared.etaArmedOff || []);
    state.enabledVariables = new Set(DEFAULT_VARIABLES);
    applyEtaToggle();
    variableFilterController?.setValues(variableCheckValues(), { silent: true });
    showRowsFilterController?.setValues(shared.visibleVariables || DEFAULT_VISIBLE);
  } finally {
    state.applyingSharedFilters = false;
  }
  scopeWeekController?.setValues(state.scopeWeeks);
  paintVariableChecks();
  applySharedWeekRange(shared);
}

function dashboardQuery({ limit = 100 } = {}) {
  const params = new URLSearchParams();
  $$("#projection .search-select").forEach(root => {
    const param = root.dataset.param;
    const widget = searchSelects.get(root.dataset.filterId);
    const values = widget?.getValues?.() || [];
    if (param) values.forEach(value => params.append(param, value));
  });
  params.set("limit", String(limit));
  return params;
}

function applyFreshness() {
  const freshness = state.dashboard?.freshness || {};
  const statusEl = $("#data-status-detail");
  if (statusEl) {
    const status = freshness.status || "Ready";
    const when = freshness.updated_at || "";
    statusEl.textContent = when ? `${status} · ${when}` : status;
  }
}

function syncLockWeeksFromDashboard() {
  const raw = state.dashboard?.lock_weeks_by_warehouse || {};
  state.lockWeeksByWarehouse = new Map(
    Object.entries(raw).map(([whse, weeks]) => [
      String(whse),
      new Set((Array.isArray(weeks) ? weeks : []).map(String)),
    ]),
  );
}

function isLockWeek(warehouse, week) {
  return Boolean(state.lockWeeksByWarehouse.get(String(warehouse))?.has(String(week)));
}

function isWeekExcluded(item, week, variable) {
  return state.exclusions.isExcluded(item, week, variable);
}

function clearWeekExclusions() {
  state.exclusions.clear();
  state.exclusionAnchor = null;
}

function visibleWeeksForExclusion() {
  return selectedWeekIndexes().keys;
}

function refreshAfterExclusion(message) {
  closeDrawer();
  renderTable();
  if (message) toast(message);
}

function handleExclusionCellClick(event, item, week, variable) {
  if (event.shiftKey && state.exclusionAnchor
      && state.exclusionAnchor.item === item
      && state.exclusionAnchor.variable === variable) {
    const range = core.weeksBetween(weekKeys(), state.exclusionAnchor.week, week);
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
  const weeks = visibleWeeksForExclusion();
  if (!weeks.length) return;
  const allExcluded = weeks.every(week => isWeekExcluded(item, week, variable));
  const excluded = !allExcluded;
  state.exclusions.set(item, weeks, variable, excluded);
  state.exclusionAnchor = { item, variable, week: weeks[0] };
  refreshAfterExclusion(
    excluded
      ? `Excluded ${weeks.length} visible weeks from SI`
      : `Included ${weeks.length} visible weeks in SI`,
  );
}

function pruneWeekExclusions() {
  state.exclusions.prune({
    weeks: weekKeys(),
    items: (state.dashboard?.rows || []).map(row => row.item),
  });
  state.exclusionAnchor = null;
}

function recalculatedProjection(row, weeks) {
  return core.recalculateProjection(row, weeks || weekKeys(), {
    enabled: state.enabledVariables,
    exclusions: state.exclusions,
    scopeExclusions: scopeStore,
  });
}

function variableCheckValues() {
  return DEFAULT_VARIABLES.filter(key => !state.armedOff.has(key));
}

function applyEtaToggle() {
  state.enabledVariables = new Set(DEFAULT_VARIABLES);
  core.applyScopedToggle(scopeStore, state.scopeWeeks, [...state.armedOff]);
}

function paintVariableChecks() {
  variableFilterController?.setValues(variableCheckValues(), { silent: true });
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

function renderTable() {
  markActiveFilters();
  const { keys: weeks, indexes } = selectedWeekIndexes();
  const rows = state.dashboard?.rows || [];
  const head = `<thead><tr>
    <th class="identity item">Item</th>
    <th class="identity vendor">Vendor</th>
    <th class="identity warehouse">Whse</th>
    <th class="identity variable">Data Types</th>
    ${weeks.map(w => `<th>${w.slice(5)}</th>`).join("")}
  </tr></thead>`;
  const allWeeks = weekKeys();
  const body = rows.map(row => {
    // One roll per row, reused by every SI cell in that row.
    const projection = recalculatedProjection(row, allWeeks);
    const variables = core.withDualSourceRows(displayedVariables(), row, state.visibleVariables);
    return variables.map(([key, label], variableIndex) => {
      const identity = variableIndex === 0
        ? `<td class="identity item" rowspan="${variables.length}" title="${esc(row.item)} · ${esc(row.series)} · ${esc(row.division)}">${esc(row.item)}</td><td class="identity vendor" rowspan="${variables.length}" title="${esc(row.vendor)}">${esc(row.vendor)}</td><td class="identity warehouse" rowspan="${variables.length}" title="${esc(row.warehouse)}">${esc(row.warehouse)}</td>`
        : "";
      const series = rowValues(row, key, projection);
      const toggleable = TOGGLEABLE_VARIABLES.has(key);
      const cells = indexes.map(index => {
        const value = series[index];
        const week = allWeeks[index];
        const excluded = toggleable && cellIsExcluded(row.item, week, key);
        const locked = isLockWeek(row.warehouse, week);
        const tdClasses = [
          core.cellTone(key, value),
          excluded ? "excluded" : "",
          locked ? "lock-week" : "",
        ].filter(Boolean).join(" ");
        const stateLabel = excluded ? "Excluded from SI" : "Included in SI";
        const lockLabel = locked ? " · Lock week" : "";
        const attrs = toggleable
          ? ` title="${stateLabel}${lockLabel} · Shift+click for week range" aria-pressed="${excluded}" aria-label="${esc(label)} ${week} ${stateLabel}${lockLabel}"`
          : locked
            ? ` title="Lock week for warehouse ${esc(row.warehouse)}"`
            : "";
        return `<td class="${tdClasses}"><button class="cell${excluded ? " excluded" : ""}${locked ? " lock-week" : ""}"${attrs} data-item="${esc(row.item)}" data-vendor="${esc(row.vendor)}" data-warehouse="${esc(row.warehouse)}" data-week="${week}" data-variable="${key}">${core.formatCell(key, value)}</button></td>`;
      }).join("");
      const varCell = toggleable
        ? `<td class="identity variable"><button type="button" class="var-toggle" title="Toggle all visible weeks for this Item × data type" data-item="${esc(row.item)}" data-variable="${key}">${label}</button></td>`
        : `<td class="identity variable">${label}</td>`;
      const kind = core.rowKind(key);
      const trClass = [variableIndex === 0 ? "group-start" : "", `kind-${kind}`].filter(Boolean).join(" ");
      return `<tr class="${trClass}">${identity}${varCell}${cells}</tr>`;
    }).join("");
  }).join("");
  $("#projection-table").innerHTML = head + `<tbody>${body || `<tr><td colspan="10">No items match the current scope.</td></tr>`}</tbody>`;
}

/* Bound once: the table body is replaced on every render, so per-button
   listeners would be recreated thousands of times. */
function initTableDelegation() {
  $("#projection-table").addEventListener("click", event => {
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
  const row = state.dashboard.rows.find(entry => entry.item === data.item && entry.vendor === data.vendor && entry.warehouse === data.warehouse);
  if (!row) return;
  const weekIndex = state.dashboard.weeks.indexOf(data.week);
  const projection = recalculatedProjection(row);
  state.selected = { ...data, row, weekIndex };
  $("#drawer-title").textContent = `${row.item} · ${data.week}`;
  $("#drawer-subtitle").textContent = `${row.series} · ${row.division} · ${row.profile}`;
  $("#drawer-route").textContent = `${row.vendor}  →  ${row.warehouse}  →  ${data.week}`;
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
  const included = VARIABLE_INPUTS
    .filter(([key]) => state.enabledVariables.has(key))
    .map(([, label]) => label);
  const excludedHere = VARIABLE_INPUTS
    .filter(([key]) => state.enabledVariables.has(key) && cellIsExcluded(row.item, data.week, key))
    .map(([, label]) => label);
  const exclusionNote = excludedHere.length
    ? ` Excluded this week for SI: ${excludedHere.join(", ")}.`
    : "";
  $("#drawer-calc").textContent = `SI = OnHand + SUPPLY − DEMAND with: ${included.join(", ") || "opening inventory only"}. Promo Lift, Safety, SI-SS, and SS% are display-only.${exclusionNote}`;
  $("#detail-drawer").classList.add("open");
  $("#detail-drawer").setAttribute("aria-hidden", "false");
  $("#scrim").classList.add("open");
}

function closeDrawer() {
  $("#detail-drawer").classList.remove("open");
  $("#detail-drawer").setAttribute("aria-hidden", "true");
  $("#scrim").classList.remove("open");
}

async function loadImports() {
  const jobs = (await api("/api/imports")).jobs;
  $("#imports-list").innerHTML = jobs.length
    ? jobs.map(job => `<div class="import-row"><div><strong>${esc(job.filename)}</strong><br><span>${esc(job.submitted_by)} · ${esc(job.submitted_at)}</span></div><span class="badge">${esc(job.status)}</span></div>`).join("")
    : `<p>No supplemental uploads yet.</p>`;
}

async function loadAdmin() {
  const [users, audits] = await Promise.all([api("/api/users"), api("/api/audit")]);
  $("#user-list").innerHTML = users.users.map(user =>
    `<div class="user-row"><div><strong>${esc(user.name)}</strong><span>${esc(user.scope)}</span></div><span class="badge">${esc(user.role)}</span></div>`
  ).join("");
  $("#audit-list").innerHTML = audits.records.map(record =>
    `<div class="audit-row"><div><strong>${esc(record.action)}</strong><span>${esc(record.detail)}</span></div><span>${esc(record.occurred_at)}</span></div>`
  ).join("");
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

  function syncAllCheck() {
    if (!allCheck) return;
    const n = checks.length;
    const on = checks.filter(check => check.checked).length;
    allCheck.checked = n > 0 && on === n;
    allCheck.indeterminate = on > 0 && on < n;
  }

  function sync() {
    const values = checks.filter(check => check.checked).map(check => check.value);
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
    trigger.setAttribute("aria-expanded", "false");
    if (panel.parentElement !== root) root.appendChild(panel);
    if (!document.querySelector(".search-select.open") && !document.querySelector(".variable-filter.open")) {
      document.body.classList.remove("filter-dropdown-open");
    }
  }

  function openPanel() {
    closeAllSearchSelects();
    if (rootId !== "variable-filter") variableFilterController?.close?.();
    if (rootId !== "show-rows-filter") showRowsFilterController?.close?.();
    open = true;
    root.classList.add("open");
    document.body.classList.add("filter-dropdown-open");
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    if (panel.parentElement !== document.body) document.body.appendChild(panel);
    positionPanel();
  }

  function reset() {
    checks.forEach(check => { check.checked = true; });
    sync();
  }

  fieldClear = core.attachFieldClearButton(trigger, {
    isActive: () => checks.filter(check => check.checked).length !== defaults.length,
    onClear() {
      reset();
      onChange();
    },
  });

  trigger.addEventListener("click", () => {
    if (open) close();
    else openPanel();
  });
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
  window.addEventListener("resize", close);
  window.addEventListener("scroll", event => {
    if (event.target instanceof Element && event.target.closest(`#${panelId}`)) return;
    if (event.target instanceof Element && event.target.closest(".filter-bar-global-scroll")) return;
    close();
  }, true);

  sync();
  return { close, reset, setValues, isOpen: () => open };
}

function initVariableFilter() {
  variableFilterController = initCheckboxFilter({
    rootId: "variable-filter",
    triggerId: "variable-filter-trigger",
    labelId: "variable-filter-label",
    panelId: "variable-filter-panel",
    defaults: DEFAULT_VARIABLES,
    onSync(values) {
      if (state.applyingSharedFilters) return;
      const checked = new Set(values);
      state.armedOff = new Set(DEFAULT_VARIABLES.filter(key => !checked.has(key)));
      applyEtaToggle();
    },
    onChange() {
      closeDrawer();
      renderTable();
      if (!state.scopeWeeks.length && state.armedOff.size) {
        toast("Choose Apply to ETA weeks to toggle the selected data types");
      }
      publishSharedFilterState();
    },
  });
}

function initScopeWeekFilter() {
  scopeWeekController = core.createScopeWeekFilter({
    rootId: "eta-scope-weeks",
    triggerId: "eta-scope-weeks-trigger",
    labelId: "eta-scope-weeks-label",
    panelId: "eta-scope-weeks-panel",
    onChange(weeks) {
      state.scopeWeeks = weeks.slice();
      applyEtaToggle();
      closeDrawer();
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
  const present = new Set(weekKeys());
  state.scopeWeeks = state.scopeWeeks.filter(iso => present.has(iso));
  applyEtaToggle();
  scopeWeekController?.setOptions(weekKeys());
  scopeWeekController?.setValues(state.scopeWeeks);
  paintVariableChecks();
}

function initShowRowsFilter() {
  showRowsFilterController = initCheckboxFilter({
    rootId: "show-rows-filter",
    triggerId: "show-rows-filter-trigger",
    labelId: "show-rows-filter-label",
    panelId: "show-rows-filter-panel",
    defaults: DEFAULT_VISIBLE,
    onSync(values) {
      state.visibleVariables = new Set(values);
    },
    onChange() {
      closeDrawer();
      renderTable();
      publishSharedFilterState();
    },
  });
}

function closeAllSearchSelects(except = null) {
  searchSelects.forEach(widget => {
    if (widget !== except) widget.close();
  });
}

function createSearchSelect(root) {
  const id = root.dataset.filterId;
  const allLabel = root.dataset.all || "All";
  const optionsKey = root.dataset.options;
  const hidden = $("#" + id, root);
  const trigger = $(".search-select-trigger", root);
  const valueEl = $(".search-select-value", root);
  const panel = $(".search-select-panel", root);
  const query = $(".search-select-query", root);
  const list = $(".search-select-options", root);
  let activeIndex = -1;
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
    const has = selected.size > 0;
    trigger.classList.toggle("has-filter", has);
    root.classList.toggle("has-value", has);
    fieldClear.sync();
  }

  function refreshLabel() {
    const label = labelForSelection();
    valueEl.textContent = label;
    valueEl.title = selected.size ? [...selected].join(", ") : allLabel;
    syncActive();
  }

  function setValues(values, { notify = false } = {}) {
    selected = new Set((values || []).filter(Boolean).map(String));
    writeHidden();
    refreshLabel();
    if (notify) {
      publishSharedFilterState();
      loadDashboard().catch(error => {
        console.error(error);
        toast("Could not refresh projection data.");
      });
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
      loadDashboard().catch(error => {
        console.error(error);
        toast("Could not refresh projection data.");
      });
    }
  }

  function filteredOptions() {
    const q = query.value.trim().toLowerCase();
    const all = options();
    const matched = q ? all.filter(v => String(v).toLowerCase().includes(q)) : all;
    return { matched, shown: matched.slice(0, FILTER_OPTION_LIMIT) };
  }

  function renderOptions() {
    const { matched, shown } = filteredOptions();
    const rows = [
      `<li><button type="button" class="search-select-option search-select-clear${selected.size ? "" : " selected"}" data-value="" role="option">All</button></li>`,
      ...shown.map(value => {
        const on = selected.has(value);
        return `<li><button type="button" class="search-select-option multi${on ? " selected" : ""}" data-value="${esc(value)}" role="option" aria-selected="${on}" title="${esc(optionLabel(value))}"><span class="search-select-check" aria-hidden="true"></span><span class="search-select-option-text">${esc(optionLabel(value))}</span></button></li>`;
      }),
    ];
    if (!shown.length && query.value.trim()) {
      rows.push(`<li class="search-select-empty">No matches</li>`);
    } else if (matched.length > shown.length) {
      rows.push(`<li class="search-select-empty">Showing ${shown.length} of ${matched.length} — type more to narrow</li>`);
    }
    list.innerHTML = rows.join("");
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
    activeIndex = -1;
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
    closeAllSearchSelects(api);
    variableFilterController?.close();
    showRowsFilterController?.close();
    open = true;
    root.classList.add("open");
    document.body.classList.add("filter-dropdown-open");
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    query.value = "";
    if (panel.parentElement !== document.body) document.body.appendChild(panel);
    positionPanel();
    renderOptions();
    requestAnimationFrame(() => query.focus());
  }

  function close() {
    if (!open) return;
    open = false;
    root.classList.remove("open");
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    activeIndex = -1;
    if (panel.parentElement !== root) root.appendChild(panel);
    if (!document.querySelector(".search-select.open")) {
      document.body.classList.remove("filter-dropdown-open");
    }
  }

  function moveActive(delta) {
    const buttons = $$(".search-select-option", list);
    if (!buttons.length) return;
    activeIndex = (activeIndex + delta + buttons.length) % buttons.length;
    buttons.forEach((btn, i) => btn.classList.toggle("active", i === activeIndex));
    buttons[activeIndex].scrollIntoView({ block: "nearest" });
  }

  selected = new Set(readHidden());
  refreshLabel();

  const api = {
    setValue,
    setValues,
    getValues: () => [...selected],
    close,
    syncActive,
    isOpen: () => open,
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

  trigger.addEventListener("click", () => {
    if (open) close();
    else openPanel();
  });

  query.addEventListener("input", renderOptions);
  query.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      trigger.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const buttons = $$(".search-select-option", list);
      const target = buttons[activeIndex] || buttons[0];
      if (!target) return;
      const value = target.dataset.value;
      if (!value) {
        setValues([], { notify: true });
        close();
      } else {
        toggleValue(value, { notify: true });
      }
    }
  });

  searchSelects.set(id, api);
  return api;
}

function initSearchSelects() {
  $$("#projection .search-select").forEach(createSearchSelect);
  document.addEventListener("mousedown", event => {
    if (event.target.closest("#projection .search-select") || event.target.closest(".search-select-panel")) return;
    closeAllSearchSelects();
  });
  window.addEventListener("resize", () => closeAllSearchSelects());
  window.addEventListener("scroll", event => {
    if (event.target instanceof Element && event.target.closest(".search-select-panel")) return;
    // Horizontal filter-bar scroll must not dismiss the open dropdown (MB sits near the end).
    if (event.target instanceof Element && event.target.closest(".filter-bar-global-scroll")) return;
    closeAllSearchSelects();
  }, true);
}

function fillFilters() {
  const options = state.dashboard.filter_options || {};
  const rows = state.dashboard.rows || [];
  state.filterOptions = {
    items: options.items || [...new Set(rows.map(row => row.item))].sort(),
    vendors: options.vendors || [...new Set(rows.map(row => row.vendor))].sort(),
    warehouses: options.warehouses || [...new Set(rows.map(row => row.warehouse))].sort(),
    series: options.series || [...new Set(rows.map(row => row.series).filter(Boolean))].sort(),
    divisions: options.divisions || [...new Set(rows.map(row => row.division).filter(Boolean))].sort(),
    profiles: options.profiles || [...new Set(rows.map(row => row.profile).filter(Boolean))].sort(),
    mb_codes: options.mb_codes || [...new Set(rows.map(row => row.mb).filter(Boolean))].sort(),
    risk_filters: options.risk_filters || ["before_lock_week", "in_lock_week", "out_of_lock_week"],
  };
  let pruned = false;
  searchSelects.forEach(widget => {
    if (widget.setOptions()) pruned = true;
  });
  state.filtersLoaded = true;
  return pruned;
}

const csvEscape = core.csvEscape;
const downloadCsv = core.downloadCsv;

async function exportCurrent() {
  const button = $("#export-button");
  if (button?.disabled) return;
  if (button) button.disabled = true;
  toast("Exporting full filter match…");
  try {
    const payload = await api(`/api/dashboard?${dashboardQuery({ limit: 0 })}`);
    const weeksAll = payload.weeks || [];
    const selectedKeys = selectedWeekIndexes().keys;
    const indexes = selectedKeys.map(key => weeksAll.indexOf(key)).filter(i => i >= 0);
    const weeks = indexes.map(i => weeksAll[i]);
    const rows = payload.rows || [];
    const variables = displayedVariables();
    const headers = ["Item", "Vendor", "Whse", "Series", "Division", "ProdResource", "MB", "Data Types", ...weeks];
    const lines = [headers.map(csvEscape).join(",")];
    for (const row of rows) {
      // Roll SI against the export payload's own week axis, not the on-screen one.
      const projection = recalculatedProjection(row, weeksAll);
      for (const [key, label] of core.withDualSourceRows(variables, row, state.visibleVariables)) {
        const vals = rowValues(row, key, projection);
        lines.push([
          row.item,
          row.vendor,
          row.warehouse,
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
    downloadCsv("inv-prj-by-whse.csv", lines);
    toast(`Exported ${rows.length} routes (full match) · flat CSV`);
  } catch (error) {
    console.error(error);
    toast("Could not export full match.");
  } finally {
    if (button) button.disabled = false;
  }
}

async function loadDashboard({ resetWeeks = false, allowPruneReload = true } = {}) {
  state.dashboard = await api(`/api/dashboard?${dashboardQuery()}`);
  syncLockWeeksFromDashboard();
  applyFreshness();
  pruneWeekExclusions();
  const pruned = fillFilters();
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

async function refreshProjectionData() {
  if (window.ProjectionStaticApi) {
    toast("Netlify snapshot — re-run EXPORT + DEPLOY_NETLIFY.bat to update.");
    return;
  }
  const button = $("#data-refresh");
  if (button?.disabled) return;
  if (button) {
    button.disabled = true;
    button.classList.add("is-busy");
  }
  try {
    await api("/api/refresh", { method: "POST" });
    await loadDashboard();
    document.dispatchEvent(new CustomEvent("projection-data-refreshed"));
    const when = state.dashboard?.freshness?.updated_at || "now";
    toast(`Data refreshed · ${when}`);
  } catch (error) {
    console.error(error);
    toast("Could not refresh projection data.");
  } finally {
    if (button) {
      button.disabled = false;
      button.classList.remove("is-busy");
    }
  }
}

function clearFilters() {
  searchSelects.forEach(widget => widget.setValue("", { notify: false }));
  variableFilterController?.reset();
  showRowsFilterController?.reset();
  clearWeekExclusions();
  state.scopeWeeks = [];
  state.armedOff = new Set();
  scopeStore.clear();
  scopeWeekController?.setValues([]);
  resetWeekRange(false);
  publishSharedFilterState();
  loadDashboard({ resetWeeks: true }).catch(error => {
    console.error(error);
    toast("Could not refresh projection data.");
  });
}

function initSharedFilterSync() {
  FILTER_SYNC.subscribe((shared, { source }) => {
    if (source === "whse") return;
    applySharedFilterState(shared);
    if (!state.dashboard) return;
    loadDashboard().catch(error => {
      console.error(error);
      toast("Could not sync projection filters.");
    });
  });
}

async function start() {
  initSearchSelects();
  initVariableFilter();
  initShowRowsFilter();
  initScopeWeekFilter();
  initTableDelegation();
  initSharedFilterSync();
  applySharedFilterState(FILTER_SYNC.get());
  await loadDashboard({ resetWeeks: true });
  applySharedWeekRange(FILTER_SYNC.get());
  renderTable();
  initWeekRangeDrag();

  $("#week-from").addEventListener("change", () => onWeekDateChange("from"));
  $("#week-to").addEventListener("change", () => onWeekDateChange("to"));
  $("#week-clear").addEventListener("click", () => resetWeekRange(true, true));
  $("#clear-filters").addEventListener("click", clearFilters);
  $("#data-refresh")?.addEventListener("click", () => {
    refreshProjectionData().catch(error => {
      console.error(error);
      toast("Could not refresh projection data.");
    });
  });
  $$(".nav-link").forEach(button => button.addEventListener("click", () => openView(button.dataset.view)));
  $$("[data-go]").forEach(button => button.addEventListener("click", () => openView(button.dataset.go)));
  $("#export-button").addEventListener("click", () => {
    exportCurrent().catch(error => {
      console.error(error);
      toast("Could not export full match.");
    });
  });
  $("#close-drawer").addEventListener("click", closeDrawer);
  $("#scrim").addEventListener("click", closeDrawer);
  $(".mobile-menu").addEventListener("click", () => document.body.classList.toggle("sidebar-open"));
  $("#theme-toggle").addEventListener("click", () => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  });
}

start().catch(error => {
  console.error(error);
  toast(error.message || "Could not load the workspace.", 8000);
});
