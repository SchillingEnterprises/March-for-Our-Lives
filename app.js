(() => {
  "use strict";

  const MAX_DATABASE_BYTES = 100 * 1024 * 1024;
  const MAX_EXPORT_ROWS = 10000;
  const SAMPLE_DATABASE_URL = "./src/db/temp/mass_shootings.db";
  const state = {
    worker: new Worker("./db-worker.js"),
    requests: new Map(),
    nextRequestId: 0,
    databaseName: "",
    table: "",
    columns: [],
    page: 0,
    pageSize: 25,
    query: "",
    sortColumn: null,
    sortDirection: "asc",
    rowCount: 0,
    profileColumn: "",
    searchTimer: null
  };

  const elements = {
    loadSample: document.querySelector("#load-sample"),
    fileInput: document.querySelector("#database-file"),
    loadStatus: document.querySelector("#load-status"),
    workspace: document.querySelector("#workspace"),
    databaseName: document.querySelector("#database-name"),
    databaseSummary: document.querySelector("#database-summary"),
    integrityButton: document.querySelector("#check-integrity"),
    integrityStatus: document.querySelector("#integrity-status"),
    profileVariable: document.querySelector("#profile-variable"),
    profileMetrics: document.querySelector("#profile-metrics"),
    profileChart: document.querySelector("#profile-chart"),
    profileMethod: document.querySelector("#profile-method"),
    storyPanel: document.querySelector(".snapshot-story"),
    storyIntro: document.querySelector("#story-intro"),
    storyHighlights: document.querySelector("#story-highlights"),
    storyCaveat: document.querySelector("#story-caveat"),
    qualityChecks: document.querySelector("#quality-checks"),
    closeDatabase: document.querySelector("#close-database"),
    tableSelect: document.querySelector("#table-select"),
    search: document.querySelector("#record-search"),
    pageSize: document.querySelector("#page-size"),
    exportButton: document.querySelector("#export-csv"),
    resultsSummary: document.querySelector("#results-summary"),
    tableHead: document.querySelector("#table-head"),
    tableBody: document.querySelector("#table-body"),
    emptyResults: document.querySelector("#empty-results"),
    previousPage: document.querySelector("#previous-page"),
    nextPage: document.querySelector("#next-page"),
    pageSummary: document.querySelector("#page-summary")
  };

  state.worker.addEventListener("message", (event) => {
    const request = state.requests.get(event.data.id);
    if (!request) return;
    state.requests.delete(event.data.id);
    if (event.data.error) request.reject(new Error(event.data.error));
    else request.resolve(event.data.result);
  });

  state.worker.addEventListener("error", () => {
    const error = new Error("The in-browser SQLite worker stopped unexpectedly. Reload the page to try again.");
    for (const request of state.requests.values()) request.reject(error);
    state.requests.clear();
    setStatus(error.message, "error");
  });

  function requestWorker(type, payload = {}, transfer = []) {
    const id = ++state.nextRequestId;
    return new Promise((resolve, reject) => {
      state.requests.set(id, { resolve, reject });
      state.worker.postMessage({ id, type, payload }, transfer);
    });
  }

  function setStatus(message, kind = "") {
    elements.loadStatus.textContent = message;
    elements.loadStatus.dataset.state = kind;
  }

  function setLoading(isLoading) {
    elements.loadSample.disabled = isLoading;
    elements.fileInput.disabled = isLoading;
  }

  function quoteForDisplay(value) {
    return value instanceof Uint8Array
      ? `[binary data · ${value.byteLength} bytes]`
      : value === null || value === undefined
        ? "NULL"
        : String(value);
  }

  function renderTableOptions(tableNames) {
    elements.tableSelect.replaceChildren();
    for (const name of tableNames) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      elements.tableSelect.append(option);
    }
    elements.tableSelect.disabled = tableNames.length === 0;
  }

  async function openDatabase(name, tableNames) {
    state.databaseName = name;
    state.table = "";
    state.columns = [];
    state.query = "";
    state.page = 0;
    state.sortColumn = null;
    state.rowCount = 0;
    state.profileColumn = "";
    elements.search.value = "";
    elements.integrityStatus.textContent = "";
    elements.integrityStatus.dataset.state = "";
    elements.profileMetrics.replaceChildren();
    elements.profileMethod.textContent = "";
    renderEmptyChart("Choose a database table to build a descriptive profile.");
    elements.storyPanel.hidden = true;
    elements.storyIntro.textContent = "";
    elements.storyHighlights.replaceChildren();
    elements.storyCaveat.textContent = "";
    elements.qualityChecks.replaceChildren();
    elements.databaseName.textContent = name;
    renderTableOptions(tableNames);
    elements.workspace.hidden = false;
    elements.exportButton.disabled = true;

    if (!tableNames.length) {
      elements.databaseSummary.textContent = "No user tables were found in this database.";
      elements.resultsSummary.textContent = "There are no user tables to explore.";
      elements.tableHead.replaceChildren();
      elements.tableBody.replaceChildren();
      elements.tableBody.closest("table").hidden = true;
      elements.emptyResults.hidden = true;
      elements.pageSummary.textContent = "";
      elements.previousPage.disabled = true;
      elements.nextPage.disabled = true;
      elements.profileVariable.replaceChildren();
      elements.profileVariable.disabled = true;
      return;
    }

    elements.databaseSummary.textContent = `${tableNames.length} ${tableNames.length === 1 ? "table" : "tables"} available`;
    await selectTable(tableNames[0]);
  }

  async function selectTable(name) {
    state.table = name;
    state.page = 0;
    state.sortColumn = null;
    state.sortDirection = "asc";
    elements.storyPanel.hidden = false;
    elements.storyIntro.textContent = "Reading this table’s coverage and recorded values…";
    elements.storyHighlights.replaceChildren();
    elements.storyCaveat.textContent = "";
    const result = await requestWorker("table", { table: name });
    if (state.table !== name) return;
    state.columns = result.columns;
    renderProfileOptions();
    await Promise.all([updateResults(), updateProfile(), updateStory()]);
  }

  function renderProfileOptions() {
    elements.profileVariable.replaceChildren();
    for (const column of state.columns) {
      const option = document.createElement("option");
      option.value = column.name;
      option.textContent = column.name;
      elements.profileVariable.append(option);
    }
    const preferred = state.columns.find((column) => /(date|time|year)/i.test(column.name));
    state.profileColumn = preferred?.name ?? state.columns[0]?.name ?? "";
    elements.profileVariable.value = state.profileColumn;
    elements.profileVariable.disabled = !state.profileColumn;
  }

  function svgElement(name, attributes = {}, text = "") {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [attribute, value] of Object.entries(attributes)) element.setAttribute(attribute, String(value));
    if (text) element.textContent = text;
    return element;
  }

  function chartShell(title, description, width, height) {
    const svg = svgElement("svg", {
      viewBox: `0 0 ${width} ${height}`,
      role: "img",
      "aria-labelledby": "profile-chart-title profile-chart-description"
    });
    svg.append(
      svgElement("title", { id: "profile-chart-title" }, title),
      svgElement("desc", { id: "profile-chart-description" }, description)
    );
    return svg;
  }

  function renderEmptyChart(message) {
    const empty = document.createElement("div");
    empty.className = "chart-empty";
    empty.textContent = message;
    elements.profileChart.replaceChildren(empty);
  }

  function appendChartData(svg, entries) {
    const details = document.createElement("details");
    details.className = "chart-data";
    const summary = document.createElement("summary");
    summary.textContent = "View chart data as a table";
    const table = document.createElement("table");
    const head = document.createElement("thead");
    const headerRow = document.createElement("tr");
    for (const label of ["Value", "Records"]) {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = label;
      headerRow.append(cell);
    }
    head.append(headerRow);
    const body = document.createElement("tbody");
    for (const entry of entries) {
      const row = document.createElement("tr");
      const label = document.createElement("td");
      label.textContent = entry.label;
      const count = document.createElement("td");
      count.textContent = formatNumber(entry.count);
      row.append(label, count);
      body.append(row);
    }
    table.append(head, body);
    details.append(summary, table);
    elements.profileChart.replaceChildren(svg, details);
  }

  function formatNumber(value) {
    return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function renderDateChart(entries) {
    const width = 900;
    const height = 300;
    const plot = { left: 62, top: 28, width: 806, height: 204 };
    const maximum = Math.max(1, ...entries.map((entry) => entry.count));
    const svg = chartShell(
      "Database records by year",
      `A bar chart of ${entries.length} calendar years. The vertical scale is the number of records in the selected database.`,
      width,
      height
    );
    for (let tick = 0; tick <= 4; tick += 1) {
      const y = plot.top + plot.height * tick / 4;
      svg.append(
        svgElement("line", { x1: plot.left, y1: y, x2: plot.left + plot.width, y2: y, class: "chart-grid" }),
        svgElement("text", { x: plot.left - 10, y: y + 4, "text-anchor": "end", class: "chart-label" }, formatNumber(maximum * (4 - tick) / 4))
      );
    }
    const step = plot.width / entries.length;
    const barWidth = Math.max(2, Math.min(20, step * 0.72));
    entries.forEach((entry, index) => {
      const barHeight = entry.count / maximum * plot.height;
      const x = plot.left + step * index + (step - barWidth) / 2;
      const y = plot.top + plot.height - barHeight;
      svg.append(svgElement("rect", {
        x, y, width: barWidth, height: barHeight,
        class: index === entries.length - 1 ? "chart-bar-accent" : "chart-bar"
      }));
      if (entries.length <= 18 || index % Math.ceil(entries.length / 9) === 0 || index === entries.length - 1) {
        svg.append(svgElement("text", {
          x: x + barWidth / 2,
          y: plot.top + plot.height + 21,
          "text-anchor": "middle",
          class: "chart-label"
        }, entry.label));
      }
    });
    svg.append(svgElement("line", {
      x1: plot.left, y1: plot.top + plot.height,
      x2: plot.left + plot.width, y2: plot.top + plot.height,
      class: "chart-axis"
    }));
    appendChartData(svg, entries);
  }

  function renderNumericChart(distribution) {
    const width = 900;
    const height = 300;
    const plot = { left: 62, top: 28, width: 806, height: 196 };
    const entries = distribution.entries;
    const maximum = Math.max(1, ...entries.map((entry) => entry.count));
    const svg = chartShell(
      "Numeric value distribution",
      `A histogram with ${entries.length} equal-width bins across the profiled sample.`,
      width,
      height
    );
    for (let tick = 0; tick <= 4; tick += 1) {
      const y = plot.top + plot.height * tick / 4;
      svg.append(
        svgElement("line", { x1: plot.left, y1: y, x2: plot.left + plot.width, y2: y, class: "chart-grid" }),
        svgElement("text", { x: plot.left - 10, y: y + 4, "text-anchor": "end", class: "chart-label" }, formatNumber(maximum * (4 - tick) / 4))
      );
    }
    const step = plot.width / entries.length;
    const barWidth = Math.max(2, step - 4);
    entries.forEach((entry, index) => {
      const barHeight = entry.count / maximum * plot.height;
      const x = plot.left + step * index + 2;
      const y = plot.top + plot.height - barHeight;
      svg.append(svgElement("rect", {
        x, y, width: barWidth, height: barHeight,
        class: index === 0 ? "chart-bar-accent" : "chart-bar"
      }));
    });
    svg.append(
      svgElement("line", {
        x1: plot.left, y1: plot.top + plot.height,
        x2: plot.left + plot.width, y2: plot.top + plot.height,
        class: "chart-axis"
      }),
      svgElement("text", { x: plot.left, y: plot.top + plot.height + 25, class: "chart-label" }, formatNumber(distribution.stats.minimum)),
      svgElement("text", { x: plot.left + plot.width, y: plot.top + plot.height + 25, "text-anchor": "end", class: "chart-label" }, formatNumber(distribution.stats.maximum))
    );
    appendChartData(svg, entries.map((entry) => ({
      label: `${formatNumber(entry.start)}–${formatNumber(entry.end)}`,
      count: entry.count
    })));
  }

  function renderCategoryChart(entries) {
    const width = 900;
    const rowHeight = 30;
    const height = Math.max(150, entries.length * rowHeight + 48);
    const left = 285;
    const barWidth = 540;
    const maximum = Math.max(1, ...entries.map((entry) => entry.count));
    const svg = chartShell(
      "Most frequent categories",
      `A horizontal bar chart of up to ${entries.length} categories in the profiled sample.`,
      width,
      height
    );
    entries.forEach((entry, index) => {
      const y = 20 + index * rowHeight;
      const widthValue = entry.count / maximum * barWidth;
      const label = entry.label.length > 38 ? `${entry.label.slice(0, 35)}…` : entry.label;
      svg.append(
        svgElement("text", { x: left - 12, y: y + 14, "text-anchor": "end", class: "chart-label" }, label),
        svgElement("rect", { x: left, y, width: widthValue, height: 17, class: index === 0 ? "chart-bar-accent" : "chart-bar" }),
        svgElement("text", { x: left + widthValue + 8, y: y + 13, class: "chart-value" }, formatNumber(entry.count))
      );
    });
    appendChartData(svg, entries);
  }

  function renderProfile(profile) {
    const { totalCount, missingCount, distinctCount, sampleSize, distribution } = profile;
    const nonMissing = totalCount - missingCount;
    const missingRate = totalCount ? missingCount / totalCount * 100 : 0;
    const kindLabel = {
      date: "Date / time",
      numeric: "Numeric",
      category: "Categorical"
    }[distribution.kind];
    const metrics = [
      ["Records", formatNumber(totalCount)],
      ["Missing values", `${formatNumber(missingCount)} · ${missingRate.toFixed(1)}%`],
      ["Distinct values", formatNumber(distinctCount)],
      ["Profile type", kindLabel]
    ];
    const metricFragment = document.createDocumentFragment();
    for (const [label, value] of metrics) {
      const card = document.createElement("div");
      card.className = "analysis-metric";
      const strong = document.createElement("strong");
      strong.textContent = value;
      const caption = document.createElement("span");
      caption.textContent = label;
      card.append(strong, caption);
      metricFragment.append(card);
    }
    elements.profileMetrics.replaceChildren(metricFragment);

    if (!sampleSize) {
      renderEmptyChart("This field has no non-empty values to chart.");
      elements.profileMethod.textContent = `The table contains ${formatNumber(totalCount)} records; all are missing or blank for this field.`;
      return;
    }

    if (distribution.kind === "date") {
      renderDateChart(distribution.entries);
      elements.profileMethod.textContent = `${formatNumber(distribution.validCount)} valid date values grouped by parsed UTC calendar year; up to ${formatNumber(sampleSize)} non-missing values profiled${sampleSize < nonMissing ? ` from ${formatNumber(nonMissing)} available` : " (the full field)"}.`;
    } else if (distribution.kind === "numeric") {
      renderNumericChart(distribution);
      const stats = distribution.stats;
      const standardDeviation = stats.sampleStandardDeviation === null
        ? "sample SD unavailable for n < 2"
        : `sample SD ${formatNumber(stats.sampleStandardDeviation)}`;
      elements.profileMethod.textContent = `Numeric n = ${formatNumber(distribution.validCount)} of ${formatNumber(sampleSize)} profiled values · mean ${formatNumber(stats.mean)} · median ${formatNumber(stats.median)} · ${standardDeviation} · IQR ${formatNumber(stats.q1)}–${formatNumber(stats.q3)} · range ${formatNumber(stats.minimum)}–${formatNumber(stats.maximum)}.`;
    } else {
      renderCategoryChart(distribution.entries);
      elements.profileMethod.textContent = `Top recorded values among ${formatNumber(sampleSize)} non-missing values${sampleSize < nonMissing ? " sampled from this field" : " (the full field)"}. Values are grouped exactly as stored.`;
    }
  }

  async function updateProfile() {
    if (!state.databaseName || !state.table || !state.profileColumn) return;
    const selectedTable = state.table;
    const selectedColumn = state.profileColumn;
    elements.profileMethod.textContent = "Profiling the selected field…";
    try {
      const profile = await requestWorker("profile", {
        table: selectedTable,
        columnName: selectedColumn
      });
      if (state.table !== selectedTable || state.profileColumn !== selectedColumn) return;
      renderProfile(profile);
    } catch (error) {
      renderEmptyChart("The selected field could not be profiled.");
      elements.profileMethod.textContent = error instanceof Error ? error.message : "The selected field could not be profiled.";
    }
  }

  function addStoryCard(fragment, label, headline, detail) {
    const card = document.createElement("article");
    card.className = "story-card";
    const category = document.createElement("span");
    category.className = "story-label";
    category.textContent = label;
    const title = document.createElement("strong");
    title.textContent = headline;
    const description = document.createElement("p");
    description.textContent = detail;
    card.append(category, title, description);
    fragment.append(card);
  }

  function renderStory(story) {
    const completeness = story.cellCount
      ? `${formatNumber(story.missingCells)} of ${formatNumber(story.cellCount)} cells (${(story.missingCells / story.cellCount * 100).toFixed(1)}%) are NULL or blank.`
      : "This table has no data cells to assess.";
    elements.storyIntro.textContent = `${formatNumber(story.rowCount)} records across ${formatNumber(story.columnCount)} fields. ${completeness} Completeness is not a measure of accuracy or representativeness.`;
    const cards = document.createDocumentFragment();

    if (story.timeSummary?.validCount) {
      const { timeSummary } = story;
      const topYears = timeSummary.topYears.map((entry) => `${entry.year} (${formatNumber(entry.count)})`).join(", ");
      const decadeTotals = new Map();
      for (const entry of timeSummary.years) {
        const decade = `${Math.floor(Number(entry.year) / 10) * 10}s`;
        decadeTotals.set(decade, (decadeTotals.get(decade) ?? 0) + entry.count);
      }
      const decades = [...decadeTotals].map(([decade, count]) => `${decade}: ${formatNumber(count)}`).join(" · ");
      const latestYear = timeSummary.maximum.slice(0, 4);
      const latestDate = new Date(`${timeSummary.maximum}T00:00:00Z`);
      const latestIsPartial = latestDate.getUTCMonth() !== 11 || latestDate.getUTCDate() !== 31;
      const recentYears = timeSummary.years.filter((entry) => Number(entry.year) >= Number(latestYear) - 1);
      const recentCount = recentYears.reduce((sum, entry) => sum + entry.count, 0);
      const dateDetail = `${formatNumber(timeSummary.validCount)} parseable dates span ${timeSummary.minimum} to ${timeSummary.maximum} across ${timeSummary.years.length} represented calendar years. Records are most concentrated in ${topYears || "no single year"}.`;
      const finalWindow = `${decades || "No decade counts available."}${latestIsPartial ? ` The final represented year ends ${timeSummary.maximum}, so this file covers only part of that calendar year.` : ` The last recorded date is ${timeSummary.maximum}; the repository does not document whether collection continued through year-end.`} The last two represented calendar years contain ${formatNumber(recentCount)} records; these are file counts, not a rate or a causal trend.`;
      addStoryCard(cards, "Time coverage", `${timeSummary.minimum} — ${timeSummary.maximum}`, `${dateDetail} ${finalWindow}`);
    }

    if (story.topStates.length) {
      const entries = story.topStates.map((entry) => `${entry.label} (${formatNumber(entry.count)})`).join(", ");
      const firstState = story.topStates[0];
      addStoryCard(cards, "Geographic distribution", `${firstState.label} · ${formatNumber(firstState.count)}`, `The three most frequent recorded state labels are ${entries}. These are counts in the file, not state-level risk: population denominators, coverage, and consistent inclusion rules are not established.`);
    }

    if (story.topPlaces.length) {
      const entries = story.topPlaces.map((entry) => `${entry.label} (${formatNumber(entry.count)})`).join("; ");
      addStoryCard(cards, "Recorded place types", `${formatNumber(story.topPlaces[0].count)} · ${story.topPlaces[0].label}`, `The leading recorded place labels are ${entries}. Categories are shown as supplied; their coding and completeness have not been independently reviewed.`);
    }

    if (story.countFields.length) {
      const totals = story.countFields.map((field) => `${field.name}: ${formatNumber(field.total)} across ${formatNumber(field.observed)} non-NULL rows`).join("; ");
      addStoryCard(cards, "Sums of source fields", `${formatNumber(story.countFields.length)} recorded measures`, `${totals}. These are arithmetic sums of the table’s named fields—not reconciled or independently verified totals.`);
    }

    if (story.idSummary && story.idColumn) {
      const excess = Math.max(0, story.rowCount - story.idSummary.distinctCount - story.idSummary.missingCount);
      const detail = excess
        ? `${formatNumber(story.idSummary.distinctCount)} distinct nonblank values occur in ${formatNumber(story.rowCount)} records, with ${formatNumber(excess)} excess ${story.idColumn} occurrences. Repeated IDs are not necessarily duplicate records.`
        : `${formatNumber(story.idSummary.distinctCount)} distinct nonblank values occur in ${formatNumber(story.rowCount)} records.`;
      addStoryCard(cards, "Identifier check", `${story.idColumn} · ${formatNumber(story.idSummary.distinctCount)} distinct`, detail);
    }

    if (story.sourceColumns && story.sourceCoverage !== null) {
      addStoryCard(cards, "Source coverage", `${formatNumber(story.sourceCoverage)} / ${formatNumber(story.rowCount)} records`, `At least one of the ${formatNumber(story.sourceColumns)} source fields is nonblank for this many rows. This checks presence only—not the quality, independence, or accuracy of those sources. ${formatNumber(story.sourceMissingCells)} source-field cells are blank.`);
    }

    if (!story.rowCount) addStoryCard(cards, "Empty table", "No records", "This table has fields but no rows to summarize.");
    elements.storyHighlights.replaceChildren(cards);
    elements.storyCaveat.textContent = "A cautious reading: this is a historical file snapshot, not a complete or continuously maintained census. The repository does not establish a stable event definition, collection history, source verification, or consistent coding across years. A sharp change in record counts can reflect data coverage or classification as well as real-world change. The file has no population denominators for comparable rates and no validated design for regression or causal inference.";
    renderQualityChecks(story.qualityChecks);
  }

  function renderQualityChecks(checks, emptyMessage = "No automated cross-field checks apply to this table. Use the profile above to inspect field-level completeness and distributions.") {
    const fragment = document.createDocumentFragment();
    if (!checks.length) {
      const empty = document.createElement("p");
      empty.className = "quality-empty";
      empty.textContent = emptyMessage;
      elements.qualityChecks.replaceChildren(empty);
      return;
    }

    for (const check of checks) {
      const card = document.createElement("article");
      card.className = "quality-card";
      card.dataset.level = check.level;
      const label = document.createElement("span");
      label.className = "quality-label";
      label.textContent = check.label;
      const title = document.createElement("strong");
      title.textContent = check.title;
      const detail = document.createElement("p");
      detail.textContent = check.detail;
      card.append(label, title, detail);
      fragment.append(card);
    }
    elements.qualityChecks.replaceChildren(fragment);
  }

  async function updateStory() {
    if (!state.databaseName || !state.table) return;
    const selectedTable = state.table;
    try {
      const story = await requestWorker("story", { table: selectedTable });
      if (state.table !== selectedTable) return;
      renderStory(story);
    } catch (error) {
      elements.storyIntro.textContent = error instanceof Error
        ? `The table summary could not be calculated: ${error.message}`
        : "The table summary could not be calculated.";
      elements.storyHighlights.replaceChildren();
      elements.storyCaveat.textContent = "";
      renderQualityChecks([], error instanceof Error
        ? `The audit could not be calculated: ${error.message}`
        : "The audit could not be calculated.");
    }
  }

  function renderHead() {
    const row = document.createElement("tr");
    const indexHeading = document.createElement("th");
    indexHeading.scope = "col";
    indexHeading.textContent = "#";
    row.append(indexHeading);

    for (const [index, column] of state.columns.entries()) {
      const heading = document.createElement("th");
      heading.scope = "col";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sort-button";
      button.setAttribute("aria-label", `Sort by ${column.name}`);
      button.textContent = column.name;
      if (state.sortColumn === index) {
        heading.setAttribute("aria-sort", state.sortDirection === "asc" ? "ascending" : "descending");
        const indicator = document.createElement("span");
        indicator.setAttribute("aria-hidden", "true");
        indicator.textContent = state.sortDirection === "asc" ? " ↑" : " ↓";
        button.append(indicator);
      }
      button.addEventListener("click", () => {
        if (state.sortColumn === index) {
          state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
        } else {
          state.sortColumn = index;
          state.sortDirection = "asc";
        }
        state.page = 0;
        void updateResults();
      });
      heading.append(button);
      row.append(heading);
    }

    elements.tableHead.replaceChildren(row);
  }

  function renderRows(rows, firstRowNumber) {
    const fragment = document.createDocumentFragment();
    for (const [rowOffset, values] of rows.entries()) {
      const row = document.createElement("tr");
      const rowNumber = document.createElement("th");
      rowNumber.scope = "row";
      rowNumber.textContent = String(firstRowNumber + rowOffset);
      row.append(rowNumber);
      for (const value of values) {
        const cell = document.createElement("td");
        cell.textContent = quoteForDisplay(value);
        row.append(cell);
      }
      fragment.append(row);
    }
    elements.tableBody.replaceChildren(fragment);
  }

  async function updateResults() {
    if (!state.databaseName || !state.table) return;
    try {
      const result = await requestWorker("query", {
        table: state.table,
        query: state.query,
        page: state.page,
        pageSize: state.pageSize,
        sortColumn: state.sortColumn === null ? null : state.columns[state.sortColumn]?.name,
        sortDirection: state.sortDirection
      });
      state.rowCount = result.rowCount;
      const pageCount = Math.ceil(state.rowCount / state.pageSize);
      if (pageCount > 0) state.page = Math.min(state.page, pageCount - 1);
      else state.page = 0;

      renderHead();
      const firstRowNumber = state.rowCount === 0 ? 0 : state.page * state.pageSize + 1;
      renderRows(result.rows, firstRowNumber);
      elements.resultsSummary.textContent = state.query
        ? `${state.rowCount.toLocaleString()} matching ${state.rowCount === 1 ? "row" : "rows"} · ${state.columns.length} ${state.columns.length === 1 ? "column" : "columns"}`
        : `${state.rowCount.toLocaleString()} ${state.rowCount === 1 ? "row" : "rows"} · ${state.columns.length} ${state.columns.length === 1 ? "column" : "columns"}`;
      elements.emptyResults.hidden = result.rows.length > 0;
      elements.tableBody.closest("table").hidden = result.rows.length === 0;
      elements.pageSummary.textContent = pageCount > 0 ? `Page ${state.page + 1} of ${pageCount}` : "No pages";
      elements.previousPage.disabled = state.page === 0;
      elements.nextPage.disabled = pageCount === 0 || state.page >= pageCount - 1;
      elements.exportButton.disabled = state.rowCount === 0;
    } catch (error) {
      setStatus(error instanceof Error ? `Could not read the selected table: ${error.message}` : "Could not read the selected table.", "error");
    }
  }

  async function loadDatabase(buffer, name) {
    if (buffer.byteLength === 0) throw new Error("The selected file is empty.");
    if (buffer.byteLength > MAX_DATABASE_BYTES) throw new Error("This file is larger than the 100 MB browser limit.");
    setStatus("Loading SQLite in a private browser worker…", "");
    setLoading(true);

    try {
      const result = await requestWorker("load", { buffer, name }, [buffer]);
      await openDatabase(name, result.tables);
      setStatus(`Loaded ${name}. Its contents remain in this tab until you close it or leave the page.`, "success");
    } finally {
      setLoading(false);
    }
  }

  function closeDatabase() {
    if (state.databaseName) void requestWorker("close").catch((error) => {
      setStatus(error instanceof Error ? error.message : "The database could not be closed.", "error");
    });
    state.databaseName = "";
    state.table = "";
    state.columns = [];
    state.rowCount = 0;
    state.profileColumn = "";
    elements.workspace.hidden = true;
    elements.storyPanel.hidden = true;
  }

  function exportFileName(table) {
    return `${table.replace(/[^a-z0-9._-]+/gi, "_") || "table"}.csv`;
  }

  async function exportCsv() {
    if (!state.databaseName || !state.table || state.rowCount === 0) return;
    try {
      const result = await requestWorker("export", {
        table: state.table,
        query: state.query,
        sortColumn: state.sortColumn === null ? null : state.columns[state.sortColumn]?.name,
        sortDirection: state.sortDirection,
        maxRows: MAX_EXPORT_ROWS
      });
      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = exportFileName(state.table);
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(`Exported ${result.count.toLocaleString()} rows. Spreadsheet-formula-like values were prefixed with an apostrophe for safety.`, "success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The CSV export failed.", "error");
    }
  }

  elements.loadSample.addEventListener("click", async () => {
    setLoading(true);
    try {
      setStatus("Fetching the preserved sample database…", "");
      const response = await fetch(SAMPLE_DATABASE_URL);
      if (!response.ok) throw new Error(`The sample database could not be loaded (HTTP ${response.status}).`);
      await loadDatabase(await response.arrayBuffer(), "mass_shootings.db");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The database could not be loaded.", "error");
    } finally {
      setLoading(false);
    }
  });

  elements.fileInput.addEventListener("change", async () => {
    const file = elements.fileInput.files?.[0];
    if (!file) return;
    try {
      if (file.size > MAX_DATABASE_BYTES) throw new Error("This file is larger than the 100 MB browser limit.");
      setLoading(true);
      await loadDatabase(await file.arrayBuffer(), file.name);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The selected file could not be opened.", "error");
    } finally {
      elements.fileInput.value = "";
      setLoading(false);
    }
  });

  elements.tableSelect.addEventListener("change", () => {
    void selectTable(elements.tableSelect.value).catch((error) => {
      setStatus(error instanceof Error ? `Could not open the selected table: ${error.message}` : "Could not open the selected table.", "error");
    });
  });

  elements.profileVariable.addEventListener("change", () => {
    state.profileColumn = elements.profileVariable.value;
    void updateProfile();
  });

  elements.search.addEventListener("input", () => {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(() => {
      state.query = elements.search.value.trim();
      state.page = 0;
      void updateResults();
    }, 140);
  });

  elements.pageSize.addEventListener("change", () => {
    state.pageSize = Number(elements.pageSize.value);
    state.page = 0;
    void updateResults();
  });

  elements.previousPage.addEventListener("click", () => {
    if (state.page > 0) {
      state.page -= 1;
      void updateResults();
    }
  });

  elements.nextPage.addEventListener("click", () => {
    if ((state.page + 1) * state.pageSize < state.rowCount) {
      state.page += 1;
      void updateResults();
    }
  });

  elements.exportButton.addEventListener("click", () => {
    void exportCsv();
  });

  elements.integrityButton.addEventListener("click", async () => {
    if (!state.databaseName) return;
    elements.integrityStatus.textContent = "Checking the selected database…";
    elements.integrityStatus.dataset.state = "";
    elements.integrityButton.disabled = true;
    try {
      const result = await requestWorker("integrity");
      if (result.result === "ok") {
        elements.integrityStatus.textContent = "SQLite quick check passed. This checks file structure only; it does not validate the data or its sources.";
      } else {
        elements.integrityStatus.textContent = `SQLite quick check reported: ${result.result}`;
        elements.integrityStatus.dataset.state = "error";
      }
    } catch (error) {
      elements.integrityStatus.textContent = error instanceof Error ? error.message : "The integrity check failed.";
      elements.integrityStatus.dataset.state = "error";
    } finally {
      elements.integrityButton.disabled = false;
    }
  });

  elements.closeDatabase.addEventListener("click", () => {
    closeDatabase();
    setStatus("Database closed. Its in-memory contents have been released.", "");
  });
})();
