#!/usr/bin/env node
/**
 * Export all D1 database tables to JSON + CSV files.
 * Usage: node scripts/export_all_data.mjs
 * Output: data_export/<table>.json and data_export/<table>.csv
 */
import { execSync } from "child_process";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const DB_NAME = "labeling_db";
const OUT_DIR = join(process.cwd(), "data_export");
mkdirSync(OUT_DIR, { recursive: true });

const TABLES = [
  { name: "sessions", query: "SELECT * FROM sessions ORDER BY created_at" },
  { name: "units", query: "SELECT * FROM units" },
  { name: "assignments", query: "SELECT * FROM assignments ORDER BY session_id, ordering" },
  { name: "manual_labels", query: "SELECT * FROM manual_labels ORDER BY session_id, unit_id" },
  { name: "llm_labels", query: "SELECT * FROM llm_labels ORDER BY session_id, unit_id" },
  {
    name: "label_attempts",
    query: "SELECT * FROM label_attempts ORDER BY session_id, created_at",
  },
  {
    name: "interaction_events",
    query: "SELECT * FROM interaction_events ORDER BY attempt_id, t_epoch_ms",
  },
  { name: "ranking_submissions", query: "SELECT * FROM ranking_submissions ORDER BY session_id" },
  { name: "survey_responses", query: "SELECT * FROM survey_responses ORDER BY session_id" },
  { name: "page_views", query: "SELECT * FROM page_views ORDER BY session_id, entered_at_epoch_ms" },
  { name: "llm_run_counts", query: "SELECT * FROM llm_run_counts ORDER BY session_id" },
  { name: "al_scores", query: "SELECT * FROM al_scores ORDER BY unit_id" },
  { name: "taxonomy_labels", query: "SELECT * FROM taxonomy_labels ORDER BY ordering" },
  { name: "prompts", query: "SELECT * FROM prompts" },
  { name: "config", query: "SELECT * FROM config" },
];

const ENRICHED_QUERIES = [
  {
    name: "labels_merged",
    query: `SELECT
      s.session_id, s.user_id, s.created_at as session_created,
      m.unit_id, u.text as unit_text, u.meta_json,
      m.phase, m.label as manual_label, m.created_at as manual_created,
      l.mode as llm_mode, l.predicted_label, l.accepted_label, l.model as llm_model,
      l.created_at as llm_created
    FROM manual_labels m
    JOIN sessions s ON s.session_id = m.session_id
    JOIN units u ON u.unit_id = m.unit_id
    LEFT JOIN llm_labels l ON l.session_id = m.session_id AND l.unit_id = m.unit_id AND l.phase = m.phase
    ORDER BY s.user_id, m.unit_id`,
  },
  {
    name: "timing_analysis",
    query: `SELECT
      la.session_id, s.user_id,
      la.unit_id, la.phase, la.task, la.llm_mode,
      la.selected_option,
      la.shown_at_epoch_ms, la.answered_at_epoch_ms,
      la.active_ms, la.hidden_ms, la.idle_ms,
      la.hidden_count, la.blur_count, la.had_background,
      la.is_valid, la.invalid_reason,
      la.created_at
    FROM label_attempts la
    JOIN sessions s ON s.session_id = la.session_id
    WHERE la.is_valid = 1
    ORDER BY s.user_id, la.created_at`,
  },
  {
    name: "human_vs_llm_agreement",
    query: `SELECT
      s.user_id, s.session_id,
      m.unit_id, u.text as unit_text,
      m.label as human_label,
      l.predicted_label as llm_label,
      l.accepted_label as final_label,
      CASE WHEN m.label = l.predicted_label THEN 1 ELSE 0 END as agreed,
      l.mode as llm_mode, l.model as llm_model
    FROM manual_labels m
    JOIN sessions s ON s.session_id = m.session_id
    JOIN units u ON u.unit_id = m.unit_id
    JOIN llm_labels l ON l.session_id = m.session_id AND l.unit_id = m.unit_id AND l.phase = m.phase
    WHERE m.phase = 'normal'
    ORDER BY s.user_id, m.unit_id`,
  },
  {
    name: "page_time_per_user",
    query: `SELECT
      s.user_id, pv.session_id, pv.page_path,
      pv.entered_at_epoch_ms, pv.left_at_epoch_ms,
      CASE WHEN pv.left_at_epoch_ms IS NOT NULL
        THEN pv.left_at_epoch_ms - pv.entered_at_epoch_ms
        ELSE NULL END as duration_ms
    FROM page_views pv
    JOIN sessions s ON s.session_id = pv.session_id
    ORDER BY s.user_id, pv.entered_at_epoch_ms`,
  },
];

const PAGE_SIZE = 5000;

function queryD1(sql) {
  const escaped = sql.replace(/'/g, "'\\''");
  const cmd = `wrangler d1 execute ${DB_NAME} --remote --json --command '${escaped}'`;
  const raw = execSync(cmd, { maxBuffer: 50 * 1024 * 1024, encoding: "utf-8" });
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].results) {
    return parsed[0].results;
  }
  return [];
}

function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(","));
  }
  return lines.join("\n");
}

function exportTable({ name, query }, isPaginated = false) {
  console.log(`  Exporting ${name}...`);
  let allRows = [];

  if (isPaginated) {
    let offset = 0;
    while (true) {
      const pageQuery = `${query} LIMIT ${PAGE_SIZE} OFFSET ${offset}`;
      const rows = queryD1(pageQuery);
      allRows.push(...rows);
      console.log(`    fetched ${rows.length} rows (offset ${offset})`);
      if (rows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  } else {
    allRows = queryD1(query);
    console.log(`    fetched ${allRows.length} rows`);
  }

  writeFileSync(join(OUT_DIR, `${name}.json`), JSON.stringify(allRows, null, 2));
  writeFileSync(join(OUT_DIR, `${name}.csv`), toCsv(allRows));
  return allRows.length;
}

console.log("=== D1 Full Data Export ===");
console.log(`Output directory: ${OUT_DIR}\n`);

const LARGE_TABLES = new Set(["label_attempts", "interaction_events", "assignments"]);

let summary = [];
console.log("--- Raw Tables ---");
for (const t of TABLES) {
  try {
    const count = exportTable(t, LARGE_TABLES.has(t.name));
    summary.push({ table: t.name, rows: count });
  } catch (e) {
    console.error(`  ERROR exporting ${t.name}: ${e.message}`);
    summary.push({ table: t.name, rows: "ERROR" });
  }
}

console.log("\n--- Enriched/Joined Views ---");
for (const t of ENRICHED_QUERIES) {
  try {
    const count = exportTable(t, true);
    summary.push({ table: `${t.name} (enriched)`, rows: count });
  } catch (e) {
    console.error(`  ERROR exporting ${t.name}: ${e.message}`);
    summary.push({ table: `${t.name} (enriched)`, rows: "ERROR" });
  }
}

console.log("\n=== Export Summary ===");
console.table(summary);

writeFileSync(
  join(OUT_DIR, "_export_metadata.json"),
  JSON.stringify(
    {
      exported_at: new Date().toISOString(),
      tables: summary,
      database: DB_NAME,
      note: "Data collected from AI literacy sentence labeling system, March 2025 workshop session",
    },
    null,
    2
  )
);

console.log(`\nAll files saved to: ${OUT_DIR}`);
console.log("Files: <table>.json, <table>.csv, _export_metadata.json");
