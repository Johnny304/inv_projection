/* SI Negative Items: warehouse and item/vendor risk lists. Filters stay on this
   workspace only (not ProjectionFilterSync / ETA-ETD). */
(() => {
  const core = window.ProjectionCore;
  const RISK_LABELS = core?.RISK_FILTER_LABELS || {
    before_lock_week: "Before Lock Week",
    in_lock_week: "In Lock Week",
    out_of_lock_week: "Out of Lock Week",
  };
  const RISK_ORDER = Object.keys(RISK_LABELS);
  const DISPLAY_LIMIT = 100;
  const FILTER_OPTION_LIMIT = 120;
  const METRIC_HEADERS = ["Negative Week", "SI negative", "ETA", "ETA negative"];
  const state = {
    active: "whse",
    loaded: new Set(),
    rows: new Map(),
    filterOptions: {
      items: [],
      vendors: [],
      warehouses: [],
      series: [],
      profiles: [],
      divisions: [],
      risk_filters: [...RISK_ORDER],
    },
  };
  const searchSelects = new Map();
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = core?.esc || (value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char])));
  const number = core?.number || (value => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value));
  const csvEscape = core?.csvEscape || (value => {
    const text = value == null ? "" : String(value);
    if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
    return text;
  });

  async function api(path) {
    window.ProjectionLoading?.start("Loading data…");
    try {
      if (window.ProjectionStaticApi) return await window.ProjectionStaticApi.handle(path);
      const response = await fetch(path);
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || "Risk request failed");
      return await response.json();
    } finally {
      window.ProjectionLoading?.stop();
    }
  }

  function includeWarehouse(grain) {
    return grain === "whse";
  }

  function identityHeaders(grain) {
    return [
      "Vendor",
      "Series",
      "Item",
      "Prod",
      "Division",
      ...(includeWarehouse(grain) ? ["Whse"] : []),
      "Risk Type",
    ];
  }

  function identityValues(row, grain) {
    return [
      row.vendor || "",
      row.series || "",
      row.item || "",
      row.profile || "",
      row.division || "",
      ...(includeWarehouse(grain) ? [row.warehouse || ""] : []),
    ];
  }

  function selectedValues(param) {
    const root = $(`#risk-items .search-select[data-param="${param}"]`);
    if (!root) return [];
    return searchSelects.get(root.dataset.filterId)?.getValues() || [];
  }

  function queryFor(grain, limit = DISPLAY_LIMIT) {
    const params = new URLSearchParams();
    ["item", "vendor", "series", "profile", "division", "risk_filter"].forEach(param => {
      selectedValues(param).forEach(value => params.append(param, value));
    });
    if (includeWarehouse(grain)) {
      selectedValues("warehouse").forEach(value => params.append("warehouse", value));
    }
    params.set("grain", grain === "whse" ? "whse" : "item_vendor");
    params.set("limit", String(limit));
    return params;
  }

  function applyFilterOptions(options) {
    state.filterOptions = {
      items: options.items || [],
      vendors: options.vendors || [],
      warehouses: options.warehouses || [],
      series: options.series || [],
      profiles: options.profiles || [],
      divisions: options.divisions || [],
      risk_filters: options.risk_filters?.length ? options.risk_filters : [...RISK_ORDER],
    };
    searchSelects.forEach(widget => widget.setOptions());
  }

  function renderTable(grain, rows) {
    const table = $("#" + (grain === "whse" ? "risk-whse-table" : "risk-iv-table"));
    if (!table) return;
    const headers = [...identityHeaders(grain), ...METRIC_HEADERS];
    const body = rows.map(row => {
      const riskLabel = RISK_LABELS[row.risk_filter] || row.risk_filter;
      const identity = identityValues(row, grain).map(value => `<td>${esc(value)}</td>`).join("");
      return `<tr>
      ${identity}
      <td>${esc(riskLabel)}</td>
      <td>${esc(row.negative_week)}</td>
      <td class="negative">${number(row.negative_si)}</td>
      <td>${esc(row.eta_week || "—")}</td>
      <td class="${row.eta_negative == null ? "" : "negative"}">${row.eta_negative == null ? "—" : number(row.eta_negative)}</td>
    </tr>`;
    }).join("");
    table.innerHTML = `<thead><tr>${headers.map(header => `<th>${header}</th>`).join("")}</tr></thead>
      <tbody>${body || `<tr><td colspan="${headers.length}">No risk items match the current filters.</td></tr>`}</tbody>`;
  }

  function exportRows(grain) {
    const rows = state.rows.get(grain) || [];
    const headers = [...identityHeaders(grain), ...METRIC_HEADERS];
    const lines = [headers.map(csvEscape).join(",")];
    rows.forEach(row => {
      lines.push([
        ...identityValues(row, grain),
        RISK_LABELS[row.risk_filter] || row.risk_filter,
        row.negative_week,
        row.negative_si,
        row.eta_week || "",
        row.eta_negative ?? "",
      ].map(csvEscape).join(","));
    });
    const filename = grain === "whse" ? "risk-items-by-whse.csv" : "risk-items.csv";
    if (core?.downloadCsv) {
      core.downloadCsv(filename, lines);
      return;
    }
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function exportCurrent(grain) {
    const result = await api(`/api/risk-items?${queryFor(grain, 0)}`);
    applyFilterOptions(result.filter_options || {});
    state.rows.set(grain, result.rows || []);
    exportRows(grain);
    await load(grain);
  }

  async function load(grain) {
    const result = await api(`/api/risk-items?${queryFor(grain)}`);
    applyFilterOptions(result.filter_options || {});
    const rows = result.rows || [];
    state.rows.set(grain, rows);
    renderTable(grain, rows);
    state.loaded.add(grain);
  }

  function activate(grain) {
    state.active = grain;
    $("#risk-items")?.classList.toggle("risk-grain-iv", grain !== "whse");
    $$(".risk-tab").forEach(button => {
      const active = button.dataset.riskView === grain;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    $$(".risk-pane").forEach(pane => {
      const active = pane.dataset.riskPane === grain;
      pane.hidden = !active;
      pane.classList.toggle("active", active);
    });
    closeAllSearchSelects();
    load(grain).catch(error => {
      console.error(error);
      renderTable(grain, []);
    });
  }

  function clearFilters() {
    searchSelects.forEach(widget => widget.setValues([], { notify: false }));
    load(state.active).catch(error => console.error(error));
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
    if (!hidden || !trigger || !valueEl || !panel || !query || !list) return null;
    let activeIndex = -1;
    let open = false;
    let selected = new Set();

    function options() {
      return state.filterOptions[optionsKey] || [];
    }

    function optionLabel(value) {
      return optionsKey === "risk_filters"
        ? (RISK_LABELS[value] || value)
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
      valueEl.title = selected.size ? [...selected].map(optionLabel).join(", ") : allLabel;
      syncActive();
    }

    function setValues(values, { notify = false } = {}) {
      selected = new Set((values || []).filter(Boolean).map(String));
      writeHidden();
      refreshLabel();
      if (notify) {
        load(state.active).catch(error => console.error(error));
      }
    }

    const fieldClear = core?.attachFieldClearButton
      ? core.attachFieldClearButton(trigger, {
        isActive: () => selected.size > 0,
        onClear: () => setValues([], { notify: true }),
      })
      : { sync() {} };

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
        load(state.active).catch(error => console.error(error));
      }
    }

    function filteredOptions() {
      const q = query.value.trim().toLowerCase();
      const all = options();
      const matched = q ? all.filter(v => optionLabel(v).toLowerCase().includes(q) || String(v).toLowerCase().includes(q)) : all;
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
    $$("#risk-items .search-select").forEach(createSearchSelect);
    document.addEventListener("mousedown", event => {
      if (event.target.closest("#risk-items .search-select") || event.target.closest(".search-select-panel")) return;
      closeAllSearchSelects();
    });
    window.addEventListener("resize", () => closeAllSearchSelects());
    window.addEventListener("scroll", event => {
      if (event.target instanceof Element && event.target.closest(".search-select-panel")) return;
      if (event.target instanceof Element && event.target.closest("#risk-items .filter-bar-global-scroll")) return;
      closeAllSearchSelects();
    }, true);
  }

  function start() {
    if (!$("#risk-items")) return;
    initSearchSelects();
    $$(".risk-tab").forEach(button => button.addEventListener("click", () => activate(button.dataset.riskView)));
    $("#risk-export")?.addEventListener("click", () => exportCurrent(state.active).catch(error => console.error(error)));
    $("#risk-clear")?.addEventListener("click", () => clearFilters());
    activate("whse");
  }

  start();
})();
