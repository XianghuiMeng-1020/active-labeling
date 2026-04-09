#!/usr/bin/env node
/**
 * Export ONLY real user data from March 24, 2026 (workshop day).
 * Filters all tables by session_id belonging to 2026-03-24 sessions.
 * Output: data_export/real_0324/<table>.json and <table>.csv
 */
import { execSync } from "child_process";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const DB_NAME = "labeling_db";
const OUT_DIR = join(process.cwd(), "data_export", "real_0324");
mkdirSync(OUT_DIR, { recursive: true });

const PAGE_SIZE = 5000;

const SESSION_FILTER = `s.created_at >= '2026-03-24T00:00:00' AND s.created_at < '2026-03-25T00:00:00'`;
const SESSION_IDS_SUBQUERY = `(SELECT session_id FROM sessions WHERE created_at >= '2026-03-24T00:00:00' AND created_at < '2026-03-25T00:00:00')`;

const TABLES = [
  {
    name: "sessions",
    query: `SELECT * FROM sessions WHERE ${SESSION_FILTER.replace(/s\./g, '')} ORDER BY created_at`,
  },
  {
    name: "units",
    query: `SELECT * FROM units ORDER BY unit_id`,
  },
  {
    name: "assignments",
    query: `SELECT * FROM assignments WHERE session_id IN ${SESSION_IDS_SUBQUERY} ORDER BY session_id, ordering`,
    paginate: true,
  },
  {
    name: "manual_labels",
    query: `SELECT * FROM manual_labels WHERE session_id IN ${SESSION_IDS_SUBQUERY} ORDER BY session_id, unit_id`,
  },
  {
    name: "llm_labels",
    query: `SELECT * FROM llm_labels WHERE session_id IN ${SESSION_IDS_SUBQUERY} ORDER BY session_id, unit_id`,
  },
  {
    name: "label_attempts",
    query: `SELECT * FROM label_attempts WHERE session_id IN ${SESSION_IDS_SUBQUERY} ORDER BY session_id, created_at`,
    paginate: true,
  },
  {
    name: "interaction_events",
    query: `SELECT ie.* FROM interaction_events ie WHERE ie.attempt_id IN (SELECT attempt_id FROM label_attempts WHERE session_id IN ${SESSION_IDS_SUBQUERY}) ORDER BY ie.attempt_id, ie.t_epoch_ms`,
    paginate: true,
  },
  {
    name: "ranking_submissions",
    query: `SELECT * FROM ranking_submissions WHERE session_id IN ${SESSION_IDS_SUBQUERY} ORDER BY session_id, essay_index`,
  },
  {
    name: "survey_responses",
    query: `SELECT * FROM survey_responses WHERE session_id IN ${SESSION_IDS_SUBQUERY} ORDER BY session_id`,
  },
  {
    name: "page_views",
    query: `SELECT * FROM page_views WHERE session_id IN ${SESSION_IDS_SUBQUERY} ORDER BY session_id, entered_at_epoch_ms`,
  },
  {
    name: "llm_run_counts",
    query: `SELECT * FROM llm_run_counts WHERE session_id IN ${SESSION_IDS_SUBQUERY} ORDER BY session_id`,
  },
  {
    name: "taxonomy_labels",
    query: `SELECT * FROM taxonomy_labels ORDER BY ordering`,
  },
  {
    name: "prompts",
    query: `SELECT * FROM prompts`,
  },
];

const ENRICHED = [
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
    WHERE ${SESSION_FILTER}
    ORDER BY s.user_id, m.unit_id`,
    paginate: true,
  },
  {
    name: "timing_analysis",
    query: `SELECT
      la.attempt_id, la.session_id, s.user_id,
      la.unit_id, la.phase, la.task, la.llm_mode,
      la.selected_option,
      la.shown_at_epoch_ms, la.answered_at_epoch_ms,
      (la.answered_at_epoch_ms - la.shown_at_epoch_ms) as total_response_ms,
      la.active_ms, la.hidden_ms, la.idle_ms,
      la.hidden_count, la.blur_count, la.had_background,
      la.is_valid, la.invalid_reason,
      la.created_at
    FROM label_attempts la
    JOIN sessions s ON s.session_id = la.session_id
    WHERE ${SESSION_FILTER} AND la.is_valid = 1
    ORDER BY s.user_id, la.created_at`,
    paginate: true,
  },
  {
    name: "human_vs_llm",
    query: `SELECT
      s.user_id, s.session_id,
      m.unit_id, u.text as unit_text,
      m.label as human_label,
      l.predicted_label as llm_predicted,
      l.accepted_label as llm_accepted_final,
      CASE WHEN m.label = l.predicted_label THEN 1 ELSE 0 END as human_llm_agree,
      CASE WHEN l.accepted_label IS NOT NULL AND m.label = l.accepted_label THEN 1 ELSE 0 END as human_final_agree,
      l.mode as llm_mode, l.model as llm_model
    FROM manual_labels m
    JOIN sessions s ON s.session_id = m.session_id
    JOIN units u ON u.unit_id = m.unit_id
    JOIN llm_labels l ON l.session_id = m.session_id AND l.unit_id = m.unit_id AND l.phase = m.phase
    WHERE ${SESSION_FILTER} AND m.phase = 'normal'
    ORDER BY s.user_id, m.unit_id`,
    paginate: true,
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
    WHERE ${SESSION_FILTER}
    ORDER BY s.user_id, pv.entered_at_epoch_ms`,
  },
  {
    name: "per_user_summary",
    query: `SELECT
      s.user_id, s.session_id, s.created_at,
      s.normal_manual_done_at, s.normal_llm_done_at,
      s.has_consent,
      (SELECT COUNT(*) FROM manual_labels m WHERE m.session_id = s.session_id AND m.phase = 'normal') as manual_label_count,
      (SELECT COUNT(*) FROM llm_labels l WHERE l.session_id = s.session_id AND l.phase = 'normal') as llm_label_count,
      (SELECT COUNT(*) FROM label_attempts la WHERE la.session_id = s.session_id AND la.task = 'manual' AND la.is_valid = 1) as valid_manual_attempts,
      (SELECT COUNT(*) FROM label_attempts la WHERE la.session_id = s.session_id AND la.task = 'llm' AND la.is_valid = 1) as valid_llm_attempts,
      (SELECT ROUND(AVG(la.active_ms)) FROM label_attempts la WHERE la.session_id = s.session_id AND la.task = 'manual' AND la.is_valid = 1) as avg_manual_active_ms,
      (SELECT ROUND(AVG(la.active_ms)) FROM label_attempts la WHERE la.session_id = s.session_id AND la.task = 'llm' AND la.is_valid = 1) as avg_llm_active_ms,
      (SELECT COUNT(*) FROM ranking_submissions r WHERE r.session_id = s.session_id) as ranking_count,
      (SELECT COUNT(*) FROM survey_responses sv WHERE sv.session_id = s.session_id) as survey_count
    FROM sessions s
    WHERE ${SESSION_FILTER.replace(/s\./g, '')}
    ORDER BY s.created_at`,
  },
  {
    name: "label_distribution_per_unit",
    query: `SELECT
      u.unit_id, u.text as unit_text,
      m.label, COUNT(*) as annotator_count,
      ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM manual_labels m2 JOIN sessions s2 ON s2.session_id = m2.session_id WHERE m2.unit_id = u.unit_id AND m2.phase = 'normal' AND ${SESSION_FILTER.replace(/s\./g, 's2.')}), 1) as pct
    FROM manual_labels m
    JOIN sessions s ON s.session_id = m.session_id
    JOIN units u ON u.unit_id = m.unit_id
    WHERE ${SESSION_FILTER} AND m.phase = 'normal'
    GROUP BY u.unit_id, m.label
    ORDER BY u.unit_id, annotator_count DESC`,
  },
];

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
    if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
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

function exportTable({ name, query, paginate }) {
  console.log(`  Exporting ${name}...`);
  let allRows = [];

  if (paginate) {
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

console.log("=== Real User Data Export (March 24 Only) ===");
console.log(`Output directory: ${OUT_DIR}\n`);

let summary = [];

console.log("--- Raw Tables (filtered to 2026-03-24) ---");
for (const t of TABLES) {
  try {
    const count = exportTable(t);
    summary.push({ table: t.name, rows: count });
  } catch (e) {
    console.error(`  ERROR exporting ${t.name}: ${e.message}`);
    summary.push({ table: t.name, rows: "ERROR" });
  }
}

console.log("\n--- Enriched Analysis Views ---");
for (const t of ENRICHED) {
  try {
    const count = exportTable(t);
    summary.push({ table: `[enriched] ${t.name}`, rows: count });
  } catch (e) {
    console.error(`  ERROR exporting ${t.name}: ${e.message}`);
    summary.push({ table: `[enriched] ${t.name}`, rows: "ERROR" });
  }
}

console.log("\n=== Export Summary ===");
console.table(summary);

writeFileSync(
  join(OUT_DIR, "_export_metadata.json"),
  JSON.stringify(
    {
      exported_at: new Date().toISOString(),
      data_date: "2026-03-24",
      filter: "sessions.created_at between 2026-03-24T00:00:00 and 2026-03-25T00:00:00",
      description: "Real workshop user data collected on March 24, 2026. AI Literacy sentence-level thematic coding task.",
      tables: summary,
      database: DB_NAME,
    },
    null,
    2
  )
);

console.log(`\nAll files saved to: ${OUT_DIR}`);
