import type { Env, LlmMode, Phase, TaxonomyLabel, Task } from "./types";
import { nowIso } from "./utils";

export async function getTaxonomy(env: Env): Promise<TaxonomyLabel[]> {
  const result = await env.DB.prepare(
    "SELECT label, description, ordering FROM taxonomy_labels ORDER BY ordering ASC"
  ).all<TaxonomyLabel>();
  return result.results ?? [];
}

export async function getTaxonomyValues(env: Env): Promise<string[]> {
  const rows = await getTaxonomy(env);
  return rows.map((row) => row.label);
}

export async function getPrompt(env: Env, key: "prompt1" | "prompt2"): Promise<string> {
  const row = await env.DB.prepare("SELECT prompt_text FROM prompts WHERE prompt_key = ?").bind(key).first<{ prompt_text: string }>();
  return row?.prompt_text ?? "";
}

export async function getNextUnit(env: Env, sessionId: string, phase: Phase, task: Task) {
  return env.DB.prepare(
    `SELECT u.unit_id, u.text, s.score AS al_score, s.reason AS al_reason
     FROM assignments a
     JOIN units u ON u.unit_id = a.unit_id
     LEFT JOIN al_scores s ON s.unit_id = u.unit_id
     WHERE a.session_id = ? AND a.phase = ? AND a.task = ? AND a.status = 'todo'
     ORDER BY a.ordering ASC
     LIMIT 1`
  )
    .bind(sessionId, phase, task)
    .first<{ unit_id: string; text: string; al_score: number | null; al_reason: string | null }>();
}

export async function countProgress(env: Env, sessionId: string, phase: Phase, task: Task) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
     FROM assignments WHERE session_id = ? AND phase = ? AND task = ?`
  )
    .bind(sessionId, phase, task)
    .first<{ total: number; done: number | null }>();
  return { total: row?.total ?? 0, done: row?.done ?? 0 };
}

export type SessionProgressRow = { phase: string; task: string; total: number; done: number | null };

/** Single query: all phase/task progress for a session (normal|active × manual|llm). */
export async function getSessionProgressAll(env: Env, sessionId: string) {
  const rows = await env.DB.prepare(
    `SELECT phase, task,
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
     FROM assignments WHERE session_id = ?
     GROUP BY phase, task`
  )
    .bind(sessionId)
    .all<SessionProgressRow>();
  const map = new Map<string, { total: number; done: number }>();
  for (const r of rows?.results ?? []) {
    map.set(`${r.phase}:${r.task}`, { total: r.total, done: r.done ?? 0 });
  }
  return {
    normal_manual: map.get("normal:manual") ?? { total: 0, done: 0 },
    normal_llm: map.get("normal:llm") ?? { total: 0, done: 0 },
    active_manual: map.get("active:manual") ?? { total: 0, done: 0 }
  };
}

export async function updateSessionDoneAt(env: Env, sessionId: string, field: "normal_manual_done_at" | "normal_llm_done_at" | "active_manual_done_at") {
  await env.DB.prepare(`UPDATE sessions SET ${field} = ? WHERE session_id = ?`).bind(nowIso(), sessionId).run();
}

export async function saveLlmPrediction(
  env: Env,
  input: {
    sessionId: string;
    unitId: string;
    phase: Phase;
    mode: LlmMode;
    predictedLabel: string;
    rawJson: string;
    model: string;
  }
) {
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO llm_labels(session_id, unit_id, phase, mode, predicted_label, accepted_label, raw_json, model, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)
     ON CONFLICT(session_id, unit_id, phase, mode)
     DO UPDATE SET predicted_label = excluded.predicted_label, raw_json = excluded.raw_json, model = excluded.model`
  )
    .bind(input.sessionId, input.unitId, input.phase, input.mode, input.predictedLabel, input.rawJson, input.model, now)
    .run();
}

/** Batch: save + accept for both prompt1 and prompt2 (active phase). */
export async function runActiveLlmBatch(
  env: Env,
  unitId: string,
  r1: { predictedLabel: string; rawText: string; provider: string; model: string },
  r2: { predictedLabel: string; rawText: string; provider: string; model: string }
) {
  const now = nowIso();
  const sessionId = "system_active";
  const phase: Phase = "active";
  const raw1 = JSON.stringify({ raw_text: r1.rawText, provider: r1.provider });
  const raw2 = JSON.stringify({ raw_text: r2.rawText, provider: r2.provider });
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO llm_labels(session_id, unit_id, phase, mode, predicted_label, accepted_label, raw_json, model, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, unit_id, phase, mode)
       DO UPDATE SET predicted_label = excluded.predicted_label, accepted_label = excluded.accepted_label, raw_json = excluded.raw_json, model = excluded.model`
    ).bind(sessionId, unitId, phase, "prompt1", r1.predictedLabel, r1.predictedLabel, raw1, r1.model, now),
    env.DB.prepare(
      `INSERT INTO llm_labels(session_id, unit_id, phase, mode, predicted_label, accepted_label, raw_json, model, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, unit_id, phase, mode)
       DO UPDATE SET predicted_label = excluded.predicted_label, accepted_label = excluded.accepted_label, raw_json = excluded.raw_json, model = excluded.model`
    ).bind(sessionId, unitId, phase, "prompt2", r2.predictedLabel, r2.predictedLabel, raw2, r2.model, now)
  ]);
}

/** Atomic batch: accept LLM label + mark assignment done + insert attempt + events. */
export async function runLlmAcceptBatch(
  env: Env,
  input: {
    sessionId: string;
    unitId: string;
    phase: Phase;
    mode: LlmMode;
    acceptedLabel: string;
    attemptId: string;
    attempt: {
      shown_at_epoch_ms: number;
      answered_at_epoch_ms: number;
      active_ms: number;
      hidden_ms: number;
      idle_ms: number;
      hidden_count: number;
      blur_count: number;
      had_background: number;
      events?: Array<{ t_perf_ms: number; t_epoch_ms: number; type: string; payload_json?: string }>;
    };
    isValid: number;
    invalidReason: string | null;
  }
) {
  const now = nowIso();
  const events = (input.attempt.events ?? []).slice(0, 200);
  const stmts = [
    env.DB.prepare(
      `INSERT INTO llm_labels(session_id, unit_id, phase, mode, predicted_label, accepted_label, raw_json, model, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)
       ON CONFLICT(session_id, unit_id, phase, mode)
       DO UPDATE SET accepted_label = excluded.accepted_label`
    ).bind(input.sessionId, input.unitId, input.phase, input.mode, input.acceptedLabel, input.acceptedLabel, now),
    env.DB.prepare(
      "UPDATE assignments SET status = 'done' WHERE session_id = ? AND unit_id = ? AND phase = ? AND task = 'llm'"
    ).bind(input.sessionId, input.unitId, input.phase),
    env.DB.prepare(
      `INSERT INTO label_attempts(
        attempt_id, session_id, unit_id, phase, task, llm_mode, selected_option,
        shown_at_epoch_ms, answered_at_epoch_ms, active_ms, hidden_ms, idle_ms,
        hidden_count, blur_count, had_background, is_valid, invalid_reason, created_at
      ) VALUES (?, ?, ?, ?, 'llm', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      input.attemptId,
      input.sessionId,
      input.unitId,
      input.phase,
      input.mode,
      input.acceptedLabel,
      input.attempt.shown_at_epoch_ms,
      input.attempt.answered_at_epoch_ms,
      input.attempt.active_ms,
      input.attempt.hidden_ms,
      input.attempt.idle_ms,
      input.attempt.hidden_count,
      input.attempt.blur_count,
      input.attempt.had_background,
      input.isValid,
      input.invalidReason,
      now
    )
  ];
  for (const event of events) {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO interaction_events(event_id, attempt_id, t_perf_ms, t_epoch_ms, type, payload_json) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(crypto.randomUUID(), input.attemptId, event.t_perf_ms, event.t_epoch_ms, event.type, event.payload_json ?? null)
    );
  }
  await env.DB.batch(stmts);
}

export async function runManualLabelBatch(
  env: Env,
  params: {
    sessionId: string;
    unitId: string;
    phase: Phase;
    label: string;
    attemptId: string;
    attempt: {
      shown_at_epoch_ms: number;
      answered_at_epoch_ms: number;
      active_ms: number;
      hidden_ms: number;
      idle_ms: number;
      hidden_count: number;
      blur_count: number;
      had_background: number;
      events?: Array<{ t_perf_ms: number; t_epoch_ms: number; type: string; payload_json?: string }>;
    };
    isValid: number;
    invalidReason: string | null;
  }
) {
  const now = nowIso();
  const events = (params.attempt.events ?? []).slice(0, 200);
  const stmts = [
    env.DB.prepare(
      `INSERT INTO manual_labels(session_id, unit_id, phase, label, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, unit_id, phase)
       DO UPDATE SET label = excluded.label, updated_at = excluded.updated_at`
    ).bind(params.sessionId, params.unitId, params.phase, params.label, now, now),
    env.DB.prepare(
      "UPDATE assignments SET status = 'done' WHERE session_id = ? AND unit_id = ? AND phase = ? AND task = 'manual'"
    ).bind(params.sessionId, params.unitId, params.phase),
    env.DB.prepare(
      `INSERT INTO label_attempts(
        attempt_id, session_id, unit_id, phase, task, llm_mode, selected_option,
        shown_at_epoch_ms, answered_at_epoch_ms, active_ms, hidden_ms, idle_ms,
        hidden_count, blur_count, had_background, is_valid, invalid_reason, created_at
      ) VALUES (?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      params.attemptId,
      params.sessionId,
      params.unitId,
      params.phase,
      null,
      params.label,
      params.attempt.shown_at_epoch_ms,
      params.attempt.answered_at_epoch_ms,
      params.attempt.active_ms,
      params.attempt.hidden_ms,
      params.attempt.idle_ms,
      params.attempt.hidden_count,
      params.attempt.blur_count,
      params.attempt.had_background,
      params.isValid,
      params.invalidReason,
      now
    )
  ];
  for (const event of events) {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO interaction_events(event_id, attempt_id, t_perf_ms, t_epoch_ms, type, payload_json) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(crypto.randomUUID(), params.attemptId, event.t_perf_ms, event.t_epoch_ms, event.type, event.payload_json ?? null)
    );
  }
  await env.DB.batch(stmts);
}
