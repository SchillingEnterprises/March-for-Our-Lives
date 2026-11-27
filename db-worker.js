"use strict";

const SQL_JS_BASE = "https://cdn.jsdelivr.net/npm/sql.js@1.17.0/dist/";
const PROFILE_SAMPLE_SIZE = 10000;
let SQL = null;
let database = null;

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function searchClause(query, columns) {
  if (!query) return { sql: "", parameters: [] };
  const predicates = columns.map((column) =>
    `instr(lower(CAST(${quoteIdentifier(column.name)} AS TEXT)), lower(?)) > 0`
  );
  return {
    sql: ` WHERE (${predicates.join(" OR ")})`,
    parameters: columns.map(() => query)
  };
}

function getColumns(table) {
  return database.exec(`PRAGMA table_info(${quoteIdentifier(table)})`)[0]?.values.map((row) => ({
    name: row[1],
    type: row[2] || ""
  })) ?? [];
}

function getOrderedQuery(table, columns, query, sortColumn, sortDirection) {
  const where = searchClause(query, columns);
  const sort = columns.find((column) => column.name === sortColumn);
  const orderBy = sort
    ? ` ORDER BY ${quoteIdentifier(sort.name)} ${sortDirection === "desc" ? "DESC" : "ASC"}`
    : "";
  return { where, orderBy, tableName: quoteIdentifier(table) };
}

async function loadDatabase(buffer) {
  if (!SQL) {
    if (typeof self.initSqlJs !== "function") {
      importScripts(`${SQL_JS_BASE}sql-wasm.js`);
    }
    SQL = await self.initSqlJs({ locateFile: (file) => `${SQL_JS_BASE}${file}` });
  }
  const candidate = new SQL.Database(new Uint8Array(buffer));
  let tables;
  try {
    tables = candidate.exec(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )[0]?.values.map(([name]) => name) ?? [];
  } catch (error) {
    candidate.close();
    throw error;
  }
  if (database) database.close();
  database = candidate;
  return tables;
}

function queryTable({ table, query, page, pageSize, sortColumn, sortDirection }) {
  const columns = getColumns(table);
  const { where, orderBy, tableName } = getOrderedQuery(table, columns, query, sortColumn, sortDirection);
  const rowCount = Number(database.exec(
    `SELECT COUNT(*) FROM ${tableName}${where.sql}`,
    where.parameters
  )[0]?.values[0]?.[0] ?? 0);
  const result = database.exec(
    `SELECT * FROM ${tableName}${where.sql}${orderBy} LIMIT ? OFFSET ?`,
    [...where.parameters, pageSize, page * pageSize]
  )[0];
  return { columns, rowCount, rows: result?.values ?? [] };
}

function getProfile({ table, columnName }) {
  const columns = getColumns(table);
  const column = columns.find((item) => item.name === columnName);
  if (!column) throw new Error("The selected profile field is no longer available.");

  const tableName = quoteIdentifier(table);
  const fieldName = quoteIdentifier(column.name);
  const summary = database.exec(
    `SELECT COUNT(*), SUM(CASE WHEN ${fieldName} IS NULL OR trim(CAST(${fieldName} AS TEXT)) = '' THEN 1 ELSE 0 END), COUNT(DISTINCT CASE WHEN ${fieldName} IS NOT NULL AND trim(CAST(${fieldName} AS TEXT)) <> '' THEN ${fieldName} END) FROM ${tableName}`
  )[0]?.values[0] ?? [0, 0, 0];
  const totalCount = Number(summary[0]);
  const missingCount = Number(summary[1] ?? 0);
  const distinctCount = Number(summary[2] ?? 0);
  const result = database.exec(
    `SELECT ${fieldName} FROM ${tableName} WHERE ${fieldName} IS NOT NULL AND trim(CAST(${fieldName} AS TEXT)) <> '' LIMIT ?`,
    [PROFILE_SAMPLE_SIZE]
  );
  const values = result[0]?.values.map(([value]) => value) ?? [];
  const numericValues = values.map((value) => {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string" || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }).filter((value) => value !== null);
  const dateValues = values.map((value) => {
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? new Date(parsed).getUTCFullYear() : null;
  }).filter((year) => year !== null);
  const dateLike = /(date|time|year)/i.test(column.name) || /(DATE|TIME)/i.test(column.type);
  let distribution;

  if (dateLike && dateValues.length >= values.length * 0.7) {
    const counts = new Map();
    for (const year of dateValues) counts.set(year, (counts.get(year) ?? 0) + 1);
    distribution = {
      kind: "date",
      validCount: dateValues.length,
      entries: [...counts].sort(([left], [right]) => left - right).map(([label, count]) => ({ label: String(label), count }))
    };
  } else if (values.length > 0 && numericValues.length >= values.length * 0.85) {
    const sorted = [...numericValues].sort((left, right) => left - right);
    const quantile = (fraction) => {
      const position = (sorted.length - 1) * fraction;
      const lower = Math.floor(position);
      const upper = Math.ceil(position);
      return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
    };
    const minimum = sorted[0];
    const maximum = sorted[sorted.length - 1];
    const mean = numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length;
    const sampleStandardDeviation = numericValues.length < 2
      ? null
      : Math.sqrt(numericValues.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (numericValues.length - 1));
    const bucketCount = minimum === maximum ? 1 : 10;
    const buckets = Array.from({ length: bucketCount }, (_, index) => {
      const start = minimum === maximum ? minimum : minimum + (maximum - minimum) * index / bucketCount;
      const end = minimum === maximum ? maximum : minimum + (maximum - minimum) * (index + 1) / bucketCount;
      return { start, end, count: 0 };
    });
    for (const value of numericValues) {
      const index = minimum === maximum ? 0 : Math.min(bucketCount - 1, Math.floor((value - minimum) / (maximum - minimum) * bucketCount));
      buckets[index].count += 1;
    }
    distribution = {
      kind: "numeric",
      validCount: numericValues.length,
      stats: {
        mean,
        sampleStandardDeviation,
        median: quantile(0.5),
        q1: quantile(0.25),
        q3: quantile(0.75),
        minimum,
        maximum
      },
      entries: buckets
    };
  } else {
    const counts = new Map();
    for (const value of values) {
      const label = String(value);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    distribution = {
      kind: "category",
      entries: [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 10)
        .map(([label, count]) => ({ label, count }))
    };
  }

  return {
    column,
    totalCount,
    missingCount,
    distinctCount,
    sampleSize: values.length,
    distribution
  };
}

function getStory({ table }) {
  const columns = getColumns(table);
  const tableName = quoteIdentifier(table);
  const rowCount = Number(database.exec(`SELECT COUNT(*) FROM ${tableName}`)[0]?.values[0]?.[0] ?? 0);
  const missingTerms = columns.map((column) => {
    const name = quoteIdentifier(column.name);
    return `SUM(CASE WHEN ${name} IS NULL OR trim(CAST(${name} AS TEXT)) = '' THEN 1 ELSE 0 END)`;
  });
  const missingCells = missingTerms.length
    ? Number(database.exec(`SELECT ${missingTerms.join(" + ")} FROM ${tableName}`)[0]?.values[0]?.[0] ?? 0)
    : 0;
  const sourceColumns = columns.filter((column) => /^data source/i.test(column.name));
  const sourceMissingTerms = sourceColumns.map((column) => {
    const name = quoteIdentifier(column.name);
    return `SUM(CASE WHEN ${name} IS NULL OR trim(CAST(${name} AS TEXT)) = '' THEN 1 ELSE 0 END)`;
  });
  const sourceMissingCells = sourceMissingTerms.length
    ? Number(database.exec(`SELECT ${sourceMissingTerms.join(" + ")} FROM ${tableName}`)[0]?.values[0]?.[0] ?? 0)
    : 0;
  const findColumn = (pattern) => columns.find((column) => pattern.test(column.name));
  const dateColumn = findColumn(/^(date|event date|incident date|timestamp)$/i);
  const stateColumn = findColumn(/^(state|state name)$/i);
  const placeColumn = findColumn(/^place type$/i);
  const idColumn = findColumn(/^case ?id$/i);
  const date = dateColumn ? quoteIdentifier(dateColumn.name) : null;
  let timeSummary = null;
  if (date) {
    const valid = `date(${date})`;
    const range = database.exec(
      `SELECT COUNT(${valid}), MIN(${valid}), MAX(${valid}) FROM ${tableName}`
    )[0]?.values[0] ?? [0, null, null];
    const years = database.exec(
      `SELECT strftime('%Y', ${valid}) AS year, COUNT(*) FROM ${tableName} WHERE strftime('%Y', ${date}) IS NOT NULL GROUP BY year ORDER BY year`
    )[0]?.values.map(([year, count]) => ({ year, count: Number(count) })) ?? [];
    timeSummary = {
      validCount: Number(range[0]),
      minimum: range[1],
      maximum: range[2],
      years,
      topYears: [...years].sort((left, right) => right.count - left.count || left.year.localeCompare(right.year)).slice(0, 3)
    };
  }
  const topValues = (column) => {
    if (!column) return [];
    const name = quoteIdentifier(column.name);
    return database.exec(
      `SELECT CAST(${name} AS TEXT), COUNT(*) FROM ${tableName} WHERE ${name} IS NOT NULL AND trim(CAST(${name} AS TEXT)) <> '' GROUP BY ${name} ORDER BY COUNT(*) DESC, CAST(${name} AS TEXT) LIMIT 3`
    )[0]?.values.map(([label, count]) => ({ label: String(label), count: Number(count) })) ?? [];
  };
  let idSummary = null;
  if (idColumn) {
    const id = quoteIdentifier(idColumn.name);
    const values = database.exec(
      `SELECT COUNT(DISTINCT CASE WHEN ${id} IS NOT NULL AND trim(CAST(${id} AS TEXT)) <> '' THEN ${id} END), SUM(CASE WHEN ${id} IS NULL OR trim(CAST(${id} AS TEXT)) = '' THEN 1 ELSE 0 END) FROM ${tableName}`
    )[0]?.values[0] ?? [0, 0];
    idSummary = {
      distinctCount: Number(values[0] ?? 0),
      missingCount: Number(values[1] ?? 0)
    };
  }
  let sourceCoverage = null;
  if (sourceColumns.length) {
    const hasSource = sourceColumns.map((column) => {
      const source = quoteIdentifier(column.name);
      return `(${source} IS NOT NULL AND trim(CAST(${source} AS TEXT)) <> '')`;
    }).join(" OR ");
    sourceCoverage = Number(database.exec(
      `SELECT SUM(CASE WHEN ${hasSource} THEN 1 ELSE 0 END) FROM ${tableName}`
    )[0]?.values[0]?.[0] ?? 0);
  }
  const countFields = columns.filter((column) =>
    /(victim fatalities|total number of fatalities|victims injured)/i.test(column.name) &&
    /(INT|REAL|NUM|DEC|FLOAT|DOUBLE)/i.test(column.type)
  ).map((column) => {
    const name = quoteIdentifier(column.name);
    const values = database.exec(
      `SELECT SUM(${name}), COUNT(${name}) FROM ${tableName}`
    )[0]?.values[0] ?? [0, 0];
    return { name: column.name, total: Number(values[0] ?? 0), observed: Number(values[1] ?? 0) };
  });
  const qualityChecks = [];
  const addCheck = (level, label, title, detail) => qualityChecks.push({ level, label, title, detail });

  const dayColumn = findColumn(/^day of week$/i);
  if (dateColumn && dayColumn) {
    const weekday = quoteIdentifier(dayColumn.name);
    const expectedDay = `CASE strftime('%w', date(${date})) WHEN '0' THEN 'sunday' WHEN '1' THEN 'monday' WHEN '2' THEN 'tuesday' WHEN '3' THEN 'wednesday' WHEN '4' THEN 'thursday' WHEN '5' THEN 'friday' WHEN '6' THEN 'saturday' END`;
    const comparisons = database.exec(
      `SELECT COUNT(*), SUM(CASE WHEN lower(trim(${weekday})) <> ${expectedDay} THEN 1 ELSE 0 END) FROM ${tableName} WHERE date(${date}) IS NOT NULL AND ${weekday} IS NOT NULL AND trim(${weekday}) <> ''`
    )[0]?.values[0] ?? [0, 0];
    const compared = Number(comparisons[0] ?? 0);
    const mismatches = Number(comparisons[1] ?? 0);
    if (mismatches) {
      addCheck("review", "Date consistency", `${formatAuditCount(mismatches)} weekday labels disagree`, `${formatAuditCount(mismatches)} of ${formatAuditCount(compared)} rows with parseable dates have a “Day of Week” value that disagrees with the calendar date. This is a cross-field check, not a judgment about which field is authoritative.`);
    }

    const detailColumn = findColumn(/^date - detailed$/i);
    if (detailColumn) {
      const detailed = quoteIdentifier(detailColumn.name);
      const datePairs = database.exec(
        `SELECT date(${date}), CAST(${detailed} AS TEXT) FROM ${tableName} WHERE ${detailed} IS NOT NULL AND trim(CAST(${detailed} AS TEXT)) <> '' LIMIT ?`,
        [PROFILE_SAMPLE_SIZE]
      )[0]?.values ?? [];
      let parseable = 0;
      let mismatches = 0;
      let unsupported = 0;
      for (const [isoDate, text] of datePairs) {
        let detailedDate = null;
        const value = String(text).trim();
        const iso = value.match(/^(\d{4}-\d{2}-\d{2})(?:[ T].*)?$/);
        const longDate = value.match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/i);
        if (iso) {
          detailedDate = iso[1];
        } else if (longDate) {
          const parsed = Date.parse(`${longDate[1]} ${longDate[2]}, ${longDate[3]} UTC`);
          if (Number.isFinite(parsed)) detailedDate = new Date(parsed).toISOString().slice(0, 10);
        } else {
          unsupported += 1;
        }
        if (detailedDate && isoDate) {
          parseable += 1;
          if (detailedDate !== isoDate) mismatches += 1;
        }
      }
      if (mismatches || unsupported) {
        const sampled = datePairs.length < rowCount ? "in the first 10,000 nonblank values returned by SQLite" : "in the available nonblank values";
        addCheck("review", "Detailed dates", `${formatAuditCount(mismatches)} date conflict${mismatches === 1 ? "" : "s"} · ${formatAuditCount(unsupported)} unparsed`, `${formatAuditCount(mismatches)} of ${formatAuditCount(parseable)} recognized “Date - Detailed” values disagree with “Date”; ${formatAuditCount(unsupported)} ${sampled} did not match the two checked date formats. Unparsed does not necessarily mean invalid.`);
      }
    }
  }

  const victimFatalities = findColumn(/^number of victim fatalities$/i);
  const totalFatalities = findColumn(/^total number of fatalities$/i);
  const victimInjuries = findColumn(/^number of victims injured$/i);
  const totalVictims = findColumn(/^total number of victims$/i);
  if (victimFatalities && totalFatalities && victimInjuries && totalVictims) {
    const victimFatalityName = quoteIdentifier(victimFatalities.name);
    const totalFatalityName = quoteIdentifier(totalFatalities.name);
    const injuryName = quoteIdentifier(victimInjuries.name);
    const victimName = quoteIdentifier(totalVictims.name);
    const values = database.exec(
      `SELECT SUM(CASE WHEN ${victimFatalityName} > ${totalFatalityName} THEN 1 ELSE 0 END), SUM(CASE WHEN ${totalFatalityName} + ${injuryName} > ${victimName} THEN 1 ELSE 0 END), SUM(CASE WHEN ${victimFatalityName} < 0 OR ${totalFatalityName} < 0 OR ${injuryName} < 0 OR ${victimName} < 0 THEN 1 ELSE 0 END) FROM ${tableName}`
    )[0]?.values[0] ?? [0, 0, 0];
    const fatalityConflicts = Number(values[0] ?? 0);
    const denominatorDifferences = Number(values[1] ?? 0);
    const negativeCounts = Number(values[2] ?? 0);
    if (fatalityConflicts || denominatorDifferences || negativeCounts) {
      addCheck("review", "Count-field reconciliation", `${formatAuditCount(fatalityConflicts)} direct conflicts · ${formatAuditCount(denominatorDifferences)} denominator differences`, `${formatAuditCount(fatalityConflicts)} rows report more “Number of Victim Fatalities” than “Total Number of Fatalities”; ${formatAuditCount(denominatorDifferences)} rows have total fatalities plus injuries above “Total Number of Victims”. There are ${formatAuditCount(negativeCounts)} rows with a negative value in these fields. Definitions may differ; reconcile them before summing or comparing.`);
    }
  }

  const latitude = findColumn(/^latitude$/i);
  const longitude = findColumn(/^longitude$/i);
  if (latitude && longitude) {
    const lat = quoteIdentifier(latitude.name);
    const lon = quoteIdentifier(longitude.name);
    const values = database.exec(
      `SELECT COUNT(*), SUM(CASE WHEN ${lat} IS NULL OR ${lon} IS NULL THEN 1 ELSE 0 END), SUM(CASE WHEN ${lat} IS NOT NULL AND (${lat} < -90 OR ${lat} > 90) OR ${lon} IS NOT NULL AND (${lon} < -180 OR ${lon} > 180) THEN 1 ELSE 0 END) FROM ${tableName}`
    )[0]?.values[0] ?? [0, 0, 0];
    const total = Number(values[0] ?? 0);
    const missing = Number(values[1] ?? 0);
    const outOfRange = Number(values[2] ?? 0);
    addCheck(missing || outOfRange ? "review" : "ok", "Coordinate bounds", `${formatAuditCount(total - missing)} / ${formatAuditCount(total)} pairs present`, `${formatAuditCount(missing)} rows have an incomplete coordinate pair and ${formatAuditCount(outOfRange)} fall outside global latitude/longitude bounds. In-range coordinates are not proof of correct geocoding.`);
  }

  const categoryFields = [
    findColumn(/^school related$/i),
    findColumn(/^type of gun - general$/i),
    findColumn(/^place type$/i)
  ].filter(Boolean);
  const categoryFindings = [];
  for (const column of categoryFields) {
    const name = quoteIdentifier(column.name);
    const values = database.exec(
      `SELECT COUNT(DISTINCT ${name}), COUNT(DISTINCT CASE WHEN ${name} IS NOT NULL AND trim(CAST(${name} AS TEXT)) <> '' THEN lower(trim(CAST(${name} AS TEXT))) END) FROM ${tableName}`
    )[0]?.values[0] ?? [0, 0];
    const raw = Number(values[0] ?? 0);
    const normalized = Number(values[1] ?? 0);
    if (raw > normalized) categoryFindings.push(`${column.name}: ${raw} raw labels → ${normalized} after case/space normalization`);
  }
  const schoolRelated = findColumn(/^school related$/i);
  let schoolOutOfDomain = 0;
  if (schoolRelated) {
    const name = quoteIdentifier(schoolRelated.name);
    schoolOutOfDomain = Number(database.exec(
      `SELECT COUNT(*) FROM ${tableName} WHERE ${name} IS NOT NULL AND trim(CAST(${name} AS TEXT)) <> '' AND lower(trim(CAST(${name} AS TEXT))) NOT IN ('yes', 'no', 'unknown')`
    )[0]?.values[0]?.[0] ?? 0);
  }
  if (categoryFindings.length || schoolOutOfDomain) {
    addCheck("review", "Category coding", `${categoryFindings.length} fields have case/space variants`, `${categoryFindings.join("; ") || "No case/space variants found."}${schoolOutOfDomain ? ` “School Related” has ${formatAuditCount(schoolOutOfDomain)} value outside Yes/No/Unknown.` : ""} Keep raw values and document any recoding.`);
  }

  const ageColumn = findColumn(/^average shooter age$/i);
  if (ageColumn && /TEXT/i.test(ageColumn.type)) {
    const ageName = quoteIdentifier(ageColumn.name);
    const values = database.exec(
      `SELECT CAST(${ageName} AS TEXT) FROM ${tableName} WHERE ${ageName} IS NOT NULL AND trim(CAST(${ageName} AS TEXT)) <> '' LIMIT ?`,
      [PROFILE_SAMPLE_SIZE]
    )[0]?.values.map(([value]) => String(value).trim()) ?? [];
    const numeric = values.filter((value) => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value));
    const nonNumeric = values.length - numeric.length;
    if (nonNumeric) {
      addCheck("review", "Numeric values stored as text", `${formatAuditCount(nonNumeric)} average-age entries are nonnumeric`, `“${ageColumn.name}” is declared TEXT; ${formatAuditCount(numeric.length)} sampled values are numeric and ${formatAuditCount(nonNumeric)} are not. SQLite can silently coerce text during AVG; clean and report exclusions before calculating an average.`);
    }
  }

  const textCountFields = columns.filter((column) =>
    /(number of (shotguns|rifles|handguns|automatic guns|semi-automatic guns)|total number of guns)/i.test(column.name) &&
    /TEXT/i.test(column.type)
  );
  const textCountFindings = [];
  for (const column of textCountFields) {
    const name = quoteIdentifier(column.name);
    const values = database.exec(
      `SELECT CAST(${name} AS TEXT) FROM ${tableName} WHERE ${name} IS NOT NULL AND trim(CAST(${name} AS TEXT)) <> '' LIMIT ?`,
      [PROFILE_SAMPLE_SIZE]
    )[0]?.values.map(([value]) => String(value).trim()) ?? [];
    const nonNumeric = values.filter((value) => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)).length;
    if (nonNumeric) textCountFindings.push(`${column.name}: ${formatAuditCount(nonNumeric)} nonnumeric or mixed-format`);
  }
  if (textCountFindings.length) {
    addCheck("review", "Count fields stored as text", `${textCountFields.length} firearm count fields need parsing`, `${textCountFindings.join("; ")}. These values cannot be safely summed until unknown and mixed-format entries are reviewed and a parsing rule is documented.`);
  }

  const classColumn = findColumn(/^class$/i);
  if (classColumn) {
    const codes = database.exec(
      `SELECT CAST(${quoteIdentifier(classColumn.name)} AS TEXT), COUNT(*) FROM ${tableName} GROUP BY ${quoteIdentifier(classColumn.name)} ORDER BY COUNT(*) DESC`
    )[0]?.values ?? [];
    if (codes.length) {
      addCheck("review", "Undocumented classification", `${formatAuditCount(codes.length)} “Class” codes`, `The stored codes are ${codes.map(([code, count]) => `${String(code)} (${formatAuditCount(Number(count))})`).join(", ")}. No codebook is documented in the repository; do not infer their meanings.`);
    }
  }

  const motiveColumn = findColumn(/^possible motive - general$/i);
  if (motiveColumn) {
    const motive = quoteIdentifier(motiveColumn.name);
    const unknown = Number(database.exec(
      `SELECT COUNT(*) FROM ${tableName} WHERE lower(trim(CAST(${motive} AS TEXT))) = 'unknown'`
    )[0]?.values[0]?.[0] ?? 0);
    if (unknown) {
      addCheck("review", "Motive interpretation", `${formatAuditCount(unknown)} records coded “Unknown”`, `The source’s “Possible Motive” field is unknown for ${formatAuditCount(unknown)} records. These descriptive labels are not clinical diagnoses or causal evidence.`);
    }
  }

  return {
    rowCount,
    columnCount: columns.length,
    missingCells,
    sourceMissingCells,
    cellCount: rowCount * columns.length,
    timeSummary,
    topStates: topValues(stateColumn),
    topPlaces: topValues(placeColumn),
    idSummary,
    idColumn: idColumn?.name ?? null,
    sourceColumns: sourceColumns.length,
    sourceCoverage,
    countFields,
    qualityChecks
  };
}

function formatAuditCount(value) {
  return Number(value).toLocaleString();
}

function csvCell(value) {
  let text = value === null || value === undefined
    ? "NULL"
    : value instanceof Uint8Array
      ? `[binary data · ${value.byteLength} bytes]`
      : String(value);
  if (typeof value === "string" && /^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function exportCsv({ table, query, sortColumn, sortDirection, maxRows }) {
  const columns = getColumns(table);
  const { where, orderBy, tableName } = getOrderedQuery(table, columns, query, sortColumn, sortDirection);
  const count = Number(database.exec(
    `SELECT COUNT(*) FROM ${tableName}${where.sql}`,
    where.parameters
  )[0]?.values[0]?.[0] ?? 0);
  if (count > maxRows) {
    throw new Error(`This export contains ${count.toLocaleString()} rows. Narrow your search to ${maxRows.toLocaleString()} rows or fewer before exporting.`);
  }

  const statement = database.prepare(`SELECT * FROM ${tableName}${where.sql}${orderBy}`);
  const lines = [columns.map((column) => csvCell(column.name)).join(",")];
  try {
    statement.bind(where.parameters);
    while (statement.step()) lines.push(statement.get().map(csvCell).join(","));
  } finally {
    statement.free();
  }
  return { csv: `\uFEFF${lines.join("\r\n")}`, count };
}

self.onmessage = async (event) => {
  const { id, type, payload = {} } = event.data;
  try {
    let result;
    switch (type) {
      case "load":
        result = { tables: await loadDatabase(payload.buffer) };
        break;
      case "table":
        result = { columns: getColumns(payload.table) };
        break;
      case "query":
        result = queryTable(payload);
        break;
      case "profile":
        result = getProfile(payload);
        break;
      case "story":
        result = getStory(payload);
        break;
      case "integrity":
        result = { result: database.exec("PRAGMA quick_check")[0]?.values[0]?.[0] ?? "no result" };
        break;
      case "export":
        result = exportCsv(payload);
        break;
      case "close":
        if (database) database.close();
        database = null;
        result = {};
        break;
      default:
        throw new Error("Unsupported database operation.");
    }
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : "The database operation failed." });
  }
};
