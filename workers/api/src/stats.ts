import type { Env } from "./types";

type Dict = Record<string, number>;

function rowsToMap(rows: Array<{ label: string; count: number }>): Dict {
  const map: Dict = {};
  for (const row of rows) {
    map[row.label] = row.count;
  }
  return map;
}

async function queryLabelCount(env: Env, sql: string, binds: unknown[] = []) {
  const result = await env.DB.prepare(sql)
    .bind(...binds)
    .all<{ label: string; count: number }>();
  return rowsToMap(result.results ?? []);
}

export async function getOverallStats(env: Env) {
  const rows = await env.DB.prepare(
    `SELECT source, phase, label, COUNT(*) as count FROM (
       SELECT 'manual' AS source, phase, label FROM manual_labels
       UNION ALL
       SELECT 'llm' AS source, phase, accepted_label AS label FROM llm_labels WHERE accepted_label IS NOT NULL
     ) GROUP BY source, phase, label`
  ).all<{ source: string; phase: string; label: string; count: number }>();

  const normalManual: Dict = {};
  const normalLlm: Dict = {};
  const activeManual: Dict = {};
  const activeLlm: Dict = {};
  const overall: Dict = {};

  for (const r of rows.results ?? []) {
    const bucket =
      r.phase === "normal" && r.source === "manual" ? normalManual :
      r.phase === "normal" && r.source === "llm" ? normalLlm :
      r.phase === "active" && r.source === "manual" ? activeManual : activeLlm;
    bucket[r.label] = r.count;
    overall[r.label] = (overall[r.label] ?? 0) + r.count;
  }

  return {
    overall,
    breakdown: {
      normal_manual: normalManual,
      normal_llm: normalLlm,
      active_manual: activeManual,
      active_llm: activeLlm
    }
  };
}

export async function getSessionsProgress(env: Env) {
  const rows = await env.DB.prepare(
    `SELECT s.session_id, s.user_id, s.created_at,
        a.phase, a.task,
        COUNT(*) AS total,
        SUM(CASE WHEN a.status = 'done' THEN 1 ELSE 0 END) AS done
     FROM sessions s
     LEFT JOIN assignments a ON a.session_id = s.session_id
     GROUP BY s.session_id, s.user_id, s.created_at, a.phase, a.task
     ORDER BY s.created_at DESC`
  ).all<{ session_id: string; user_id: string; created_at: string; phase: string | null; task: string | null; total: number; done: number }>();

  const bySession = new Map<string, { session_id: string; user_id: string; created_at: string; counts: Array<{ phase: string; task: string; done: number; total: number }> }>();
  for (const r of rows.results ?? []) {
    let entry = bySession.get(r.session_id);
    if (!entry) {
      entry = { session_id: r.session_id, user_id: r.user_id, created_at: r.created_at, counts: [] };
      bySession.set(r.session_id, entry);
    }
    if (r.phase != null && r.task != null) {
      entry.counts.push({ phase: r.phase, task: r.task, done: r.done, total: r.total });
    }
  }
  const userCounts = new Map<string, number>();
  for (const e of bySession.values()) {
    userCounts.set(e.user_id, (userCounts.get(e.user_id) ?? 0) + 1);
  }
  return Array.from(bySession.values()).map((e) => ({
    ...e,
    duplicate_user: (userCounts.get(e.user_id) ?? 0) > 1
  }));
}
