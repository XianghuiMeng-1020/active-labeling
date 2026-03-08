import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  getNextUnit,
  getPrompt,
  getTaxonomy,
  getTaxonomyValues,
  countProgress,
  getSessionProgressAll,
  runManualLabelBatch,
  runLlmAcceptBatch,
  runActiveLlmBatch,
  saveLlmPrediction,
  updateSessionDoneAt
} from "./db";
import { runLlm, runLlmWithRetry, pingLlm } from "./llm";
import { getOverallStats, getSessionsProgress } from "./stats";
import { json, nowIso, validateAttempt, extractLabel, buildLlmInstruction } from "./utils";
import type { AttemptPayload, Env, LlmMode, Phase } from "./types";
import { StatsHub } from "./statsHub";
import { QwenRateLimiter } from "./qwenRateLimiter";

const BUILD_ID = "2026-03-01-v2";
const CUSTOM_PROMPT_MAX = 5;

// Limits for input validation and rate limiting
const SESSION_NORMAL_MAX = 500;
const SESSION_ACTIVE_MAX = 200;
const UNITS_IMPORT_BATCH_MAX = 500;
const ATTEMPT_EVENTS_MAX = 200;
const EXPORT_PAGE_SIZE = 10000;
const SHARE_TOKEN_TTL_DAYS = 7;
const IDEMPOTENCY_TTL_HOURS = 24;

const app = new Hono<{ Bindings: Env }>();

// CORS: restrict to ALLOWED_ORIGINS if set, else allow * (cached by env value)
const corsCache = new Map<string, { origin: string[] | "*"; credentials: boolean }>();
const corsOptions = (env: Env) => {
  const key = env.ALLOWED_ORIGINS?.trim() ?? "";
  let opts = corsCache.get(key);
  if (!opts) {
    if (key) {
      const list = key.split(",").map((o) => o.trim()).filter(Boolean);
      opts = { origin: list, credentials: true };
    } else {
      opts = { origin: "*", credentials: false };
    }
    corsCache.set(key, opts);
  }
  return opts as { origin: string[] | "*"; credentials: boolean };
};
app.use("*", (c, next) => {
  const opts = corsOptions(c.env);
  return cors(opts)(c, next);
});
app.options("*", (c) => c.text("ok"));

// Rate limiting for public API (per IP + path + 1-min window)
const RATE_LIMIT_CLEANUP_PROB = 1 / 20; // ~5% of requests run cleanup to avoid DB write on every request

async function checkRateLimit(env: Env, c: any, pathKey: string, limitPerMin: number): Promise<boolean> {
  try {
    const ip = c.req.header("CF-Connecting-IP") ?? c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ?? "unknown";
    const window = Math.floor(Date.now() / 60000);
    const key = `${ip}:${pathKey}:${window}`;
    const windowEnd = new Date((window + 1) * 60000).toISOString();
    const row = await env.DB.prepare(
      "INSERT INTO rate_limits(key, count, window_end) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1, window_end = excluded.window_end RETURNING count"
    )
      .bind(key, windowEnd)
      .first<{ count: number }>();
    const count = row?.count ?? 0;
    if (count > limitPerMin) return true;
    // Probabilistic cleanup: run DELETE only ~5% of the time to reduce DB load; expired rows are ignored by SELECT
    if (Math.random() < RATE_LIMIT_CLEANUP_PROB) {
      const cutoff = new Date((window - 2) * 60000).toISOString();
      await env.DB.prepare("DELETE FROM rate_limits WHERE window_end < ?").bind(cutoff).run();
    }
    return false;
  } catch {
    return false;
  }
}

app.use("/api/*", async (c, next) => {
  const path = c.req.path;
  let pathKey = "";
  let limit = 0;
  if (path.includes("session/start")) {
    pathKey = "session_start";
    limit = 15;
  } else if (path.includes("labels/manual") || path.includes("labels/undo")) {
    pathKey = "labels";
    limit = 120;
  } else if (path.includes("llm/run")) {
    pathKey = "llm_run";
    limit = 60;
  } else if (path.includes("llm/accept")) {
    pathKey = "llm_accept";
    limit = 120;
  } else if (path.includes("client/errors")) {
    pathKey = "client_errors";
    limit = 30;
  } else if (path.includes("share/stats") || path.includes("share/stream")) {
    pathKey = "share";
    limit = 60;
  } else if (path.includes("session/reset")) {
    pathKey = "session_reset";
    limit = 20;
  } else if (path.includes("ranking/submit") || path.includes("ranking/reopen")) {
    pathKey = "ranking";
    limit = 30;
  } else if (path.includes("survey/submit")) {
    pathKey = "survey";
    limit = 10;
  } else if (path.includes("stats/visualization")) {
    pathKey = "read";
    limit = 60;
  } else if (path.includes("session/status") || path.includes("units/next") || path.includes("taxonomy") || path.includes("prompts") || path.includes("ranking/status") || path.includes("session/labeled-essays")) {
    pathKey = "read";
    limit = 300;
  }
  if (pathKey && limit) {
    const over = await checkRateLimit(c.env, c, pathKey, limit);
    if (over) return json({ error: "rate_limit_exceeded" }, 429);
  }
  const start = Date.now();
  try {
    await next();
  } catch (error) {
    console.error("[api_error]", c.req.method, c.req.path, error);
    throw error;
  } finally {
    if (c.res.status >= 400) {
      console.warn("[api_warn]", c.req.method, c.req.path, "status=", c.res.status, "latency_ms=", Date.now() - start);
    }
  }
});

// ─── Qwen rate limiter (DO) ──────────────────────────────────────────────────

async function qwenAcquire(env: Env): Promise<void> {
  if (!env.QWEN_LIMITER) return;
  const id = env.QWEN_LIMITER.idFromName("global");
  await env.QWEN_LIMITER.get(id).fetch("https://qwen/acquire", { method: "POST" });
}

async function qwenRelease(
  env: Env,
  status?: number,
  latencyMs?: number,
  retries?: number
): Promise<void> {
  if (!env.QWEN_LIMITER) return;
  const id = env.QWEN_LIMITER.idFromName("global");
  await env.QWEN_LIMITER.get(id).fetch("https://qwen/release", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, latency_ms: latencyMs, retries })
  });
}

// ─── Auth helpers ────────────────────────────────────────────────────────────

type AdminSessionPayload = {
  kind: "admin_session";
  iat: number;
  exp: number;
};

function toBase64Url(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  return atob(padded);
}

async function signWithAdminKey(env: Env, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.ADMIN_TOKEN),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toBase64Url(String.fromCharCode(...new Uint8Array(signature)));
}

async function issueAdminSessionToken(env: Env): Promise<{ token: string; expires_at_epoch_ms: number }> {
  const ttlSec = Number(env.ADMIN_SESSION_TTL_SEC ?? "28800");
  const nowSec = Math.floor(Date.now() / 1000);
  const payload: AdminSessionPayload = { kind: "admin_session", iat: nowSec, exp: nowSec + ttlSec };
  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const sig = await signWithAdminKey(env, payloadB64);
  return { token: `${payloadB64}.${sig}`, expires_at_epoch_ms: payload.exp * 1000 };
}

function timingSafeEqual(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  let result = a.length ^ b.length;
  for (let i = 0; i < maxLen; i++) {
    result |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return result === 0;
}

async function verifyAdminSessionToken(env: Env, token: string): Promise<boolean> {
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return false;
  const expected = await signWithAdminKey(env, payloadB64);
  if (!timingSafeEqual(expected, sig)) return false;
  try {
    const payload = JSON.parse(fromBase64Url(payloadB64)) as AdminSessionPayload;
    if (payload.kind !== "admin_session") return false;
    return payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

async function checkAdmin(c: any): Promise<boolean> {
  const auth = c.req.header("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  // Backward compatibility: raw ADMIN_TOKEN compared with timing-safe equality
  if (c.env.ADMIN_TOKEN && timingSafeEqual(token, c.env.ADMIN_TOKEN)) return true;
  return verifyAdminSessionToken(c.env as Env, token);
}

// ─── SSE broadcast ───────────────────────────────────────────────────────────

async function broadcastStats(env: Env) {
  try {
    const id = env.STATS_HUB.idFromName("global");
    const stub = env.STATS_HUB.get(id);
    const overall = await getOverallStats(env);
    const payload = {
      normal: {
        normal_manual: overall.breakdown.normal_manual,
        normal_llm: overall.breakdown.normal_llm
      },
      overall
    };
    await stub.fetch("https://stats/broadcast", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.error("[broadcast] error", e);
  }
}

// ─── Unit assignment ─────────────────────────────────────────────────────────

async function assignUnits(env: Env, sessionId: string, normalN: number, activeM: number) {
  const normalRows = await env.DB.prepare(
    "SELECT unit_id FROM units ORDER BY unit_id ASC LIMIT ?"
  )
    .bind(normalN)
    .all<{ unit_id: string }>();

  const normalIds = (normalRows.results ?? []).map((x) => x.unit_id);
  const stmts: ReturnType<Env["DB"]["prepare"]>[] = [];
  normalIds.forEach((unitId, idx) => {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO assignments(session_id, unit_id, phase, task, status, ordering) VALUES (?, ?, 'normal', 'manual', 'todo', ?)"
      ).bind(sessionId, unitId, idx),
      env.DB.prepare(
        "INSERT INTO assignments(session_id, unit_id, phase, task, status, ordering) VALUES (?, ?, 'normal', 'llm', 'todo', ?)"
      ).bind(sessionId, unitId, idx)
    );
  });
  if (stmts.length > 0) await env.DB.batch(stmts);

  // Active phase: use AL scores to reorder the same units (or fetch remaining ones)
  const activeRows = await env.DB.prepare(
    `SELECT u.unit_id
     FROM units u
     LEFT JOIN al_scores s ON s.unit_id = u.unit_id
     ORDER BY COALESCE(s.score, 0) DESC, u.unit_id ASC
     LIMIT ?`
  )
    .bind(activeM)
    .all<{ unit_id: string }>();

  const activeStmts = (activeRows.results ?? []).map((row, idx) =>
    env.DB.prepare(
      "INSERT INTO assignments(session_id, unit_id, phase, task, status, ordering) VALUES (?, ?, 'active', 'manual', 'todo', ?)"
    ).bind(sessionId, row.unit_id, idx)
  );
  if (activeStmts.length > 0) await env.DB.batch(activeStmts);
}

// ─── Custom prompt attempt counter ───────────────────────────────────────────

async function getCustomRunCount(
  env: Env,
  sessionId: string,
  unitId: string,
  phase: string
): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT run_count FROM llm_run_counts WHERE session_id=? AND unit_id=? AND phase=? AND mode='custom'"
  )
    .bind(sessionId, unitId, phase)
    .first<{ run_count: number }>();
  return row?.run_count ?? 0;
}

async function incrementCustomRunCount(
  env: Env,
  sessionId: string,
  unitId: string,
  phase: string
): Promise<number> {
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO llm_run_counts(session_id, unit_id, phase, mode, run_count, created_at, updated_at)
     VALUES (?, ?, ?, 'custom', 1, ?, ?)
     ON CONFLICT(session_id, unit_id, phase, mode)
     DO UPDATE SET run_count = run_count + 1, updated_at = excluded.updated_at`
  )
    .bind(sessionId, unitId, phase, now, now)
    .run();
  return getCustomRunCount(env, sessionId, unitId, phase);
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get("/", (c) =>
  json({
    message: "Service is running",
    service: "sentence-labeling-api",
    status: "ok",
    time: nowIso(),
    docs: { health: "/api/health", session_start: "POST /api/session/start" }
  })
);

app.get("/api/health", (c) => {
  return json({ status: "ok", build: BUILD_ID, time: nowIso() });
});

app.post("/api/client/errors", async (c) => {
  const body: { message?: string; stack?: string; page?: string; extra?: unknown } = (await c.req
    .json<{ message?: string; stack?: string; page?: string; extra?: unknown }>()
    .catch(() => null)) ?? {};
  const page = body.page?.slice(0, 300) ?? "";
  const safePage = page.replace(/\?.*$/, "").replace(/token=[^&\s]+/gi, "token=***");
  console.error("[client_error]", {
    message: body.message?.slice(0, 300),
    stack: body.stack?.slice(0, 1200),
    page: safePage,
    userAgent: c.req.header("User-Agent") ?? "unknown"
  });
  return json({ ok: true });
});

app.post("/api/admin/auth/login", async (c) => {
  const body: { admin_token?: string } = (await c.req.json<{ admin_token?: string }>().catch(() => null)) ?? {};
  if (!body.admin_token || !c.env.ADMIN_TOKEN) {
    return json({ error: "invalid_admin_token" }, 401);
  }
  if (body.admin_token.length !== c.env.ADMIN_TOKEN.length || !timingSafeEqual(body.admin_token, c.env.ADMIN_TOKEN)) {
    return json({ error: "invalid_admin_token" }, 401);
  }
  const session = await issueAdminSessionToken(c.env);
  return json(session);
});

app.get("/api/admin/auth/verify", async (c) => {
  if (!(await checkAdmin(c))) return json({ error: "unauthorized" }, 401);
  return json({ ok: true });
});

app.post("/api/llm/ping", async (c) => {
  const requestId = crypto.randomUUID();
  const start = Date.now();
  const result = await pingLlm(c.env, requestId);
  return json({
    request_id: requestId,
    provider: result.provider,
    status: result.status,
    latency_ms: Date.now() - start,
    error_detail: result.errorDetail
  });
});

app.post("/api/session/start", async (c) => {
  const body = (await c.req.json<{ user_id?: string }>().catch(() => null)) ?? {};
  const cfgRows = await c.env.DB.prepare(
    "SELECT key, value FROM config WHERE key IN ('normal_n', 'active_m')"
  ).all<{ key: string; value: string }>();
  const cfgMap: Record<string, number> = { normal_n: 6, active_m: 4 };
  for (const r of cfgRows.results ?? []) cfgMap[r.key] = Number(r.value) || cfgMap[r.key];
  const normalN = Math.min(SESSION_NORMAL_MAX, Math.max(1, cfgMap.normal_n));
  const activeM = Math.min(SESSION_ACTIVE_MAX, Math.max(0, cfgMap.active_m));
  const userId = (body.user_id?.trim() ?? "").slice(0, 128) || `user_${crypto.randomUUID().slice(0, 8)}`;
  const sessionId = crypto.randomUUID();
  const resetToken = crypto.randomUUID();
  const now = nowIso();
  // Requires migration 0005 (reset_token column). Deploy migration before this code.
  await c.env.DB.prepare(
    "INSERT INTO sessions(session_id, user_id, created_at, reset_token) VALUES (?, ?, ?, ?)"
  )
    .bind(sessionId, userId, now, resetToken)
    .run();
  await assignUnits(c.env, sessionId, normalN, activeM);
  return json({ session_id: sessionId, reset_token: resetToken });
});

app.post("/api/session/reset", async (c) => {
  const body = (await c.req.json<{ session_id?: string; reset_token?: string }>().catch(() => null)) ?? {};
  const sessionId = body.session_id?.trim();
  const resetToken = body.reset_token?.trim();
  if (!sessionId) return json({ error: "session_id required" }, 400);

  const row = await c.env.DB.prepare(
    "SELECT session_id, reset_token FROM sessions WHERE session_id = ?"
  )
    .bind(sessionId)
    .first<{ session_id: string; reset_token: string | null }>();
  if (!row) return json({ error: "session not found" }, 404);
  if (row.reset_token != null) {
    if (!resetToken) return json({ error: "reset_token required" }, 400);
    if (row.reset_token.length !== resetToken.length || !timingSafeEqual(row.reset_token, resetToken))
      return json({ error: "invalid reset_token" }, 403);
  }

  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM interaction_events WHERE attempt_id IN (SELECT attempt_id FROM label_attempts WHERE session_id = ?)"
    ).bind(sessionId),
    c.env.DB.prepare("DELETE FROM label_attempts WHERE session_id = ?").bind(sessionId),
    c.env.DB.prepare("DELETE FROM manual_labels WHERE session_id = ?").bind(sessionId),
    c.env.DB.prepare("DELETE FROM llm_labels WHERE session_id = ?").bind(sessionId),
    c.env.DB.prepare("DELETE FROM llm_run_counts WHERE session_id = ?").bind(sessionId),
    c.env.DB.prepare("DELETE FROM ranking_submissions WHERE session_id = ?").bind(sessionId),
    c.env.DB.prepare("UPDATE assignments SET status='todo' WHERE session_id = ?").bind(sessionId),
    c.env.DB.prepare(
      "UPDATE sessions SET normal_manual_done_at=NULL, normal_llm_done_at=NULL, active_manual_done_at=NULL WHERE session_id = ?"
    ).bind(sessionId)
  ]);

  await broadcastStats(c.env);
  return json({ ok: true, session_id: sessionId });
});

app.get("/api/session/status", async (c) => {
  const sessionId = c.req.query("session_id");
  if (!sessionId) return json({ error: "session_id required" }, 400);
  const { normal_manual: normalManual, normal_llm: normalLlm, active_manual: activeManual } = await getSessionProgressAll(c.env, sessionId);
  return json({
    normal_manual: normalManual,
    normal_llm: normalLlm,
    active_manual: activeManual,
    gates: {
      can_enter_normal_llm: normalManual.total > 0 && normalManual.done === normalManual.total,
      can_enter_active_manual: normalLlm.total > 0 && normalLlm.done === normalLlm.total
    }
  });
});

const VALID_PHASES: Phase[] = ["normal", "active"];
const VALID_TASKS = ["manual", "llm"] as const;

app.get("/api/units/next", async (c) => {
  const sessionId = c.req.query("session_id");
  const phase = c.req.query("phase");
  const task = c.req.query("task");
  if (!sessionId || !VALID_PHASES.includes(phase as Phase) || !VALID_TASKS.includes(task as any)) {
    return json({ error: "missing or invalid query: session_id, phase (normal|active), task (manual|llm)" }, 400);
  }
  const row = await getNextUnit(c.env, sessionId, phase as Phase, task as "manual" | "llm");
  return json({ unit: row ?? null });
});

app.get("/api/taxonomy", async (c) => json({ labels: await getTaxonomy(c.env) }));

app.get("/api/prompts", async (c) => {
  const prompt1 = await getPrompt(c.env, "prompt1");
  const prompt2 = await getPrompt(c.env, "prompt2");
  return json({ prompt1, prompt2 });
});

// ─── Idempotency (claim-first to avoid TOCTOU) ─────────────────────────────────

const IDEMPOTENCY_CLAIMED = 202;

async function claimIdempotency(env: Env, key: string): Promise<"claimed" | { body: string; status: number } | "conflict"> {
  try {
    await env.DB.prepare(
      "INSERT INTO idempotency_keys(idempotency_key, response_json, response_status, created_at) VALUES (?, ?, ?, ?)"
    )
      .bind(key, "", IDEMPOTENCY_CLAIMED, nowIso())
      .run();
    return "claimed";
  } catch {
    const row = await env.DB.prepare(
      "SELECT response_json, response_status FROM idempotency_keys WHERE idempotency_key = ?"
    )
      .bind(key)
      .first<{ response_json: string; response_status: number }>();
    if (!row) return "conflict";
    if (row.response_status !== IDEMPOTENCY_CLAIMED) return { body: row.response_json, status: row.response_status };
    return "conflict";
  }
}

const IDEMPOTENCY_CLEANUP_PROB = 1 / 20;

async function setIdempotency(env: Env, key: string, body: string, status: number): Promise<void> {
  await env.DB.prepare(
    "UPDATE idempotency_keys SET response_json = ?, response_status = ? WHERE idempotency_key = ? AND response_status = ?"
  )
    .bind(body, status, key, IDEMPOTENCY_CLAIMED)
    .run();
  if (Math.random() < IDEMPOTENCY_CLEANUP_PROB) {
    await env.DB.prepare(
      "DELETE FROM idempotency_keys WHERE created_at < datetime('now', ?)"
    )
      .bind(`-${IDEMPOTENCY_TTL_HOURS} hours`)
      .run();
  }
}

// ─── Manual label submit ──────────────────────────────────────────────────────

app.post("/api/labels/manual", async (c) => {
  const body = (await c.req.json<{
    session_id?: string;
    unit_id?: string;
    phase?: Phase;
    label?: string;
    attempt?: AttemptPayload;
    idempotency_key?: string;
  }>().catch(() => null)) ?? {};
  if (!body.session_id?.trim() || !body.unit_id?.trim()) {
    return json({ error: "session_id, unit_id required" }, 400);
  }
  if (!body.phase || !VALID_PHASES.includes(body.phase as Phase)) {
    return json({ error: "phase required and must be normal or active" }, 400);
  }
  const taxonomy = await getTaxonomyValues(c.env);
  const label = (body.label ?? "").trim();
  if (!taxonomy.includes(label)) return json({ error: "invalid_label" }, 400);

  if (body.idempotency_key) {
    const claim = await claimIdempotency(c.env, body.idempotency_key);
    if (claim !== "claimed") {
      if (claim === "conflict") return json({ error: "request_in_progress" }, 409);
      return new Response(claim.body, {
        status: claim.status,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
  const asgn = await c.env.DB.prepare(
    "SELECT status FROM assignments WHERE session_id=? AND unit_id=? AND phase=? AND task='manual'"
  ).bind(body.session_id.trim(), body.unit_id.trim(), body.phase).first<{ status: string }>();
  if (!asgn) return json({ error: "assignment_not_found" }, 404);
  if (asgn.status === "done") return json({ ok: true, already_done: true });

  const valid = validateAttempt(body.attempt, c.env);
  const attemptId = crypto.randomUUID();
  await runManualLabelBatch(c.env, {
    sessionId: body.session_id.trim(),
    unitId: body.unit_id.trim(),
    phase: body.phase,
    label,
    attemptId,
    attempt: body.attempt ?? {
      shown_at_epoch_ms: 0,
      answered_at_epoch_ms: 0,
      active_ms: 0,
      hidden_ms: 0,
      idle_ms: 0,
      hidden_count: 0,
      blur_count: 0,
      had_background: 0,
      events: []
    },
    isValid: valid.isValid,
    invalidReason: valid.reason
  });
  const progress = await countProgress(c.env, body.session_id, body.phase, "manual");
  if (body.phase === "normal" && progress.done === progress.total) {
    await updateSessionDoneAt(c.env, body.session_id, "normal_manual_done_at");
  }
  if (body.phase === "active" && progress.done === progress.total) {
    await updateSessionDoneAt(c.env, body.session_id, "active_manual_done_at");
  }
  broadcastStats(c.env).catch(() => {});

  const sessionId = body.session_id.trim();
  const phase = body.phase;

  const nextUnit = await getNextUnit(c.env, sessionId, phase, "manual");

  let fullyLabeledEssays: number[] = [];
  let rankedEssays: number[] = [];
  if (phase === "normal") {
    const [labeledRows, rankRows] = await Promise.all([
      c.env.DB.prepare(
        "SELECT unit_id FROM assignments WHERE session_id=? AND phase=? AND task='manual' AND status='done'"
      ).bind(sessionId, phase).all<{ unit_id: string }>(),
      c.env.DB.prepare(
        "SELECT essay_index FROM ranking_submissions WHERE session_id=?"
      ).bind(sessionId).all<{ essay_index: number }>()
    ]);
    const essayCounts: Record<number, number> = {};
    for (const r of labeledRows.results ?? []) {
      const m = r.unit_id.match(/^essay(\d+)_sentence/);
      if (m) {
        const idx = parseInt(m[1], 10);
        essayCounts[idx] = (essayCounts[idx] ?? 0) + 1;
      }
    }
    fullyLabeledEssays = Object.entries(essayCounts)
      .filter(([, count]) => count >= 5)
      .map(([idx]) => parseInt(idx, 10))
      .sort((a, b) => a - b);
    rankedEssays = (rankRows.results ?? []).map((r) => r.essay_index);
  }

  const payload = {
    ok: true,
    is_valid: valid.isValid,
    invalid_reason: valid.reason,
    next_unit: nextUnit ?? null,
    progress,
    fully_labeled_essays: fullyLabeledEssays,
    ranked_essays: rankedEssays
  };
  if (body.idempotency_key) {
    await setIdempotency(c.env, body.idempotency_key, JSON.stringify(payload), 200);
  }
  return json(payload);
});

// ─── Undo last manual label ───────────────────────────────────────────────────

app.post("/api/labels/undo", async (c) => {
  const body = (await c.req.json<{
    session_id?: string;
    unit_id?: string;
    phase?: Phase;
    idempotency_key?: string;
  }>().catch(() => null)) ?? {};
  if (!body.session_id?.trim() || !body.unit_id?.trim()) {
    return json({ error: "session_id, unit_id required" }, 400);
  }
  if (!body.phase || !VALID_PHASES.includes(body.phase as Phase)) {
    return json({ error: "phase required and must be normal or active" }, 400);
  }
  if (body.idempotency_key) {
    const claim = await claimIdempotency(c.env, body.idempotency_key);
    if (claim !== "claimed") {
      if (claim === "conflict") return json({ error: "request_in_progress" }, 409);
      return new Response(claim.body, {
        status: claim.status,
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  // Check that the assignment exists and is currently 'done'
  const asgn = await c.env.DB.prepare(
    "SELECT status FROM assignments WHERE session_id=? AND unit_id=? AND phase=? AND task='manual'"
  )
    .bind(body.session_id, body.unit_id, body.phase)
    .first<{ status: string }>();
  if (!asgn) return json({ error: "assignment not found" }, 404);
  if (asgn.status !== "done") return json({ error: "assignment is not done, nothing to undo" }, 409);

  // Roll back: delete attempts/events, label, and mark assignment todo (atomic)
  await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM interaction_events WHERE attempt_id IN (SELECT attempt_id FROM label_attempts WHERE session_id=? AND unit_id=? AND phase=? AND task='manual')"
    ).bind(body.session_id, body.unit_id, body.phase),
    c.env.DB.prepare(
      "DELETE FROM label_attempts WHERE session_id=? AND unit_id=? AND phase=? AND task='manual'"
    ).bind(body.session_id, body.unit_id, body.phase),
    c.env.DB.prepare(
      "DELETE FROM manual_labels WHERE session_id=? AND unit_id=? AND phase=?"
    ).bind(body.session_id, body.unit_id, body.phase),
    c.env.DB.prepare(
      "UPDATE assignments SET status='todo' WHERE session_id=? AND unit_id=? AND phase=? AND task='manual'"
    ).bind(body.session_id, body.unit_id, body.phase)
  ]);

  // If we rolled back the last unit in a phase, also clear the phase done timestamp
  const progress = await countProgress(c.env, body.session_id, body.phase, "manual");
  if (body.phase === "normal" && progress.done < progress.total) {
    await c.env.DB.prepare(
      "UPDATE sessions SET normal_manual_done_at=NULL WHERE session_id=?"
    )
      .bind(body.session_id)
      .run();
  }
  if (body.phase === "active" && progress.done < progress.total) {
    await c.env.DB.prepare(
      "UPDATE sessions SET active_manual_done_at=NULL WHERE session_id=?"
    )
      .bind(body.session_id)
      .run();
  }

  await broadcastStats(c.env);
  const payload = { ok: true };
  if (body.idempotency_key) {
    await setIdempotency(c.env, body.idempotency_key, JSON.stringify(payload), 200);
  }
  return json(payload);
});

// ─── LLM run (with custom 5-attempt server gate) ─────────────────────────────

type LlmRunBody = { session_id?: string; unit_id?: string; phase?: "normal"; mode?: LlmMode; custom_prompt_text?: string };

app.post("/api/llm/run", async (c) => {
  const requestId = crypto.randomUUID();
  const raw = (await c.req.json<LlmRunBody>().catch(() => null)) ?? ({} as LlmRunBody);
  const body = raw;
  if (!body.session_id?.trim() || !body.unit_id?.trim()) {
    return json({ error: "session_id and unit_id required" }, 400);
  }
  const sessionId = body.session_id.trim();
  const unitId = body.unit_id.trim();
  const mode: LlmMode = ["prompt1", "prompt2", "custom"].includes(body.mode ?? "") ? body.mode! : "prompt1";
  const phase = "normal" as const;

  // Custom prompt: enforce 5-attempt limit server-side
  if (mode === "custom") {
    const count = await getCustomRunCount(c.env, sessionId, unitId, phase);
    if (count >= CUSTOM_PROMPT_MAX) {
      return json(
        {
          error: "custom_attempt_limit_reached",
          detail: `Custom prompt is limited to ${CUSTOM_PROMPT_MAX} attempts per unit. You have used all ${CUSTOM_PROMPT_MAX}.`,
          attempts_used: count,
          attempts_max: CUSTOM_PROMPT_MAX
        },
        429
      );
    }
  }

  try {
    const taxonomy = await getTaxonomyValues(c.env);
    const unit = await c.env.DB.prepare("SELECT text FROM units WHERE unit_id = ?")
      .bind(unitId)
      .first<{ text: string }>();
    if (!unit) return json({ error: "unit not found", request_id: requestId }, 404);

    const prompt =
      mode === "custom"
        ? (body?.custom_prompt_text ?? "")
        : await getPrompt(c.env, mode);

    await qwenAcquire(c.env);
    const startMs = Date.now();
    let llm: Awaited<ReturnType<typeof runLlm>>;
    try {
      llm = await runLlm(c.env, { text: unit.text, prompt, taxonomy, requestId });
      await qwenRelease(c.env, 200, Date.now() - startMs, 0);
    } catch (llmErr: any) {
      await qwenRelease(c.env, llmErr?.status ?? 500, Date.now() - startMs, llmErr?.retryCount ?? 0);
      throw llmErr;
    }

    if (mode === "custom") {
      await incrementCustomRunCount(c.env, sessionId, unitId, phase);
    }

    await saveLlmPrediction(c.env, {
      sessionId,
      unitId,
      phase,
      mode,
      predictedLabel: llm.predictedLabel,
      rawJson: JSON.stringify({ raw_text: llm.rawText, provider: llm.provider, request_id: requestId }),
      model: llm.model
    });

    // Return current custom attempt count for UI feedback
    const attemptsUsed =
      mode === "custom"
        ? await getCustomRunCount(c.env, sessionId, unitId, phase)
        : undefined;

    return json({
      predicted_label: llm.predictedLabel,
      raw_text: llm.rawText,
      provider: llm.provider,
      request_id: requestId,
      custom_attempts_used: attemptsUsed,
      custom_attempts_max: mode === "custom" ? CUSTOM_PROMPT_MAX : undefined
    });
  } catch (error: any) {
    console.error(`[LLM] ${requestId} /api/llm/run error:`, error.message);
    return json(
      {
        error: "LLM call failed",
        detail: error.message?.slice(0, 200) || "Unknown error",
        request_id: requestId
      },
      500
    );
  }
});

// ─── LLM accept (user confirms or overrides) ─────────────────────────────────

app.post("/api/llm/accept", async (c) => {
  const body = (await c.req.json<{
    session_id?: string;
    unit_id?: string;
    phase?: "normal";
    mode?: LlmMode;
    accepted_label?: string;
    attempt?: AttemptPayload;
    idempotency_key?: string;
  }>().catch(() => null)) ?? {};
  if (!body.session_id?.trim() || !body.unit_id?.trim() || body.phase !== "normal" || !body.accepted_label?.trim()) {
    return json({ error: "session_id, unit_id, phase, accepted_label required" }, 400);
  }
  const taxonomy = await getTaxonomyValues(c.env);
  if (!taxonomy.includes(body.accepted_label.trim())) return json({ error: "invalid_label" }, 400);
  const mode: LlmMode = ["prompt1", "prompt2", "custom"].includes(body.mode ?? "") ? body.mode! : "prompt1";
  const attemptPayload: AttemptPayload = body.attempt ?? {
    shown_at_epoch_ms: 0,
    answered_at_epoch_ms: 0,
    active_ms: 0,
    hidden_ms: 0,
    idle_ms: 0,
    hidden_count: 0,
    blur_count: 0,
    had_background: 0,
    events: []
  };
  if (body.idempotency_key) {
    const claim = await claimIdempotency(c.env, body.idempotency_key);
    if (claim !== "claimed") {
      if (claim === "conflict") return json({ error: "request_in_progress" }, 409);
      return new Response(claim.body, {
        status: claim.status,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
  const asgn = await c.env.DB.prepare(
    "SELECT status FROM assignments WHERE session_id=? AND unit_id=? AND phase='normal' AND task='llm'"
  ).bind(body.session_id.trim(), body.unit_id.trim()).first<{ status: string }>();
  if (!asgn) return json({ error: "assignment_not_found" }, 404);
  if (asgn.status === "done") return json({ ok: true, already_done: true });

  const valid = validateAttempt(attemptPayload, c.env);
  await runLlmAcceptBatch(c.env, {
    sessionId: body.session_id.trim(),
    unitId: body.unit_id.trim(),
    phase: "normal",
    mode,
    acceptedLabel: body.accepted_label.trim(),
    attemptId: crypto.randomUUID(),
    attempt: attemptPayload,
    isValid: valid.isValid,
    invalidReason: valid.reason
  });
  const sessionId = body.session_id.trim();
  const progress = await countProgress(c.env, sessionId, "normal", "llm");
  if (progress.done === progress.total) {
    await updateSessionDoneAt(c.env, sessionId, "normal_llm_done_at");
  }
  broadcastStats(c.env).catch(() => {});

  const nextUnit = await getNextUnit(c.env, sessionId, "normal", "llm");
  let customCount = 0;
  if (nextUnit) {
    const row = await c.env.DB.prepare(
      "SELECT run_count FROM llm_run_counts WHERE session_id=? AND unit_id=? AND phase='normal' AND mode='custom'"
    ).bind(sessionId, nextUnit.unit_id).first<{ run_count: number }>();
    customCount = row?.run_count ?? 0;
  }

  const payload = {
    ok: true,
    is_valid: valid.isValid,
    invalid_reason: valid.reason,
    next_unit: nextUnit ?? null,
    progress,
    custom_attempts_used: customCount
  };
  if (body.idempotency_key) {
    await setIdempotency(c.env, body.idempotency_key, JSON.stringify(payload), 200);
  }
  return json(payload);
});

// ─── Active LLM results (for user view) ──────────────────────────────────────

app.get("/api/active/llm/results", async (c) => {
  const sessionId = c.req.query("session_id");
  if (!sessionId) return json({ error: "session_id required" }, 400);

  const rows = await c.env.DB.prepare(
    `SELECT
       a.ordering as ordering,
       u.unit_id as unit_id,
       u.text as text,
       COALESCE(l.accepted_label, l.predicted_label) as label,
       s.score as score,
       s.reason as reason
     FROM assignments a
     JOIN units u ON u.unit_id = a.unit_id
     LEFT JOIN llm_labels l
       ON l.session_id = 'system_active'
      AND l.phase = 'active'
      AND l.mode = 'prompt2'
      AND l.unit_id = a.unit_id
     LEFT JOIN al_scores s ON s.unit_id = a.unit_id
     WHERE a.session_id = ?
       AND a.phase = 'active'
       AND a.task = 'manual'
     ORDER BY a.ordering ASC`
  )
    .bind(sessionId)
    .all<{
      ordering: number;
      unit_id: string;
      text: string;
      label: string | null;
      score: number | null;
      reason: string | null;
    }>();

  return json({ items: rows.results ?? [] });
});

// ─── Custom attempt count query ───────────────────────────────────────────────

app.get("/api/llm/custom/count", async (c) => {
  const sessionId = c.req.query("session_id");
  const unitId = c.req.query("unit_id");
  const phase = c.req.query("phase") ?? "normal";
  if (!sessionId || !unitId) return json({ error: "session_id and unit_id required" }, 400);
  const count = await getCustomRunCount(c.env, sessionId, unitId, phase);
  return json({ count, max: CUSTOM_PROMPT_MAX, exhausted: count >= CUSTOM_PROMPT_MAX });
});

// ─── Public: ranking submissions ──────────────────────────────────────────────

app.post("/api/ranking/submit", async (c) => {
  const body = await c.req.json<{
    session_id?: string;
    essay_index?: number;
    ordering?: string[];
  }>().catch(() => ({}));
  const sessionId = (body as any).session_id?.trim();
  const essayIndex = (body as any).essay_index;
  const ordering = (body as any).ordering;
  if (!sessionId || typeof essayIndex !== "number" || !Array.isArray(ordering) || ordering.length === 0) {
    return json({ error: "session_id, essay_index, ordering required" }, 400);
  }
  if (essayIndex < 1 || essayIndex > 100) {
    return json({ error: "essay_index out of range" }, 400);
  }
  if (ordering.length > 50 || !ordering.every((v: unknown) => typeof v === "string" && v.length < 100)) {
    return json({ error: "invalid ordering data" }, 400);
  }
  await c.env.DB.prepare(
    `INSERT INTO ranking_submissions(session_id, essay_index, ordering, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(session_id, essay_index) DO UPDATE SET ordering=excluded.ordering, created_at=excluded.created_at`
  ).bind(sessionId, essayIndex, JSON.stringify(ordering), nowIso()).run();
  return json({ ok: true });
});

app.get("/api/ranking/status", async (c) => {
  const sessionId = c.req.query("session_id");
  if (!sessionId) return json({ error: "session_id required" }, 400);
  const rows = await c.env.DB.prepare(
    "SELECT essay_index FROM ranking_submissions WHERE session_id = ?"
  ).bind(sessionId).all<{ essay_index: number }>();
  const ranked = (rows.results ?? []).map((r) => r.essay_index);
  return json({ ranked_essays: ranked });
});

// ─── Reopen essay for re-labeling (from ranking page: back to edit labels) ───
app.post("/api/ranking/reopen", async (c) => {
  const body = (await c.req.json<{ session_id?: string; essay_index?: number }>().catch(() => ({}))) ?? {};
  const sessionId = String(body.session_id ?? "").trim();
  const essayIndex = typeof body.essay_index === "number" ? body.essay_index : undefined;
  if (!sessionId || essayIndex == null || essayIndex < 1 || essayIndex > 100) {
    return json({ error: "session_id and essay_index (1–100) required" }, 400);
  }
  const pattern = `essay${String(essayIndex).padStart(4, "0")}_%`;
  await c.env.DB.prepare(
    "DELETE FROM ranking_submissions WHERE session_id = ? AND essay_index = ?"
  ).bind(sessionId, essayIndex).run();
  await c.env.DB.prepare(
    "DELETE FROM interaction_events WHERE attempt_id IN (SELECT attempt_id FROM label_attempts WHERE session_id = ? AND phase = 'normal' AND task = 'manual' AND unit_id LIKE ?)"
  ).bind(sessionId, pattern).run();
  await c.env.DB.prepare(
    "DELETE FROM label_attempts WHERE session_id = ? AND phase = 'normal' AND task = 'manual' AND unit_id LIKE ?"
  ).bind(sessionId, pattern).run();
  await c.env.DB.prepare(
    "DELETE FROM manual_labels WHERE session_id = ? AND phase = 'normal' AND unit_id LIKE ?"
  ).bind(sessionId, pattern).run();
  await c.env.DB.prepare(
    "UPDATE assignments SET status = 'todo' WHERE session_id = ? AND phase = 'normal' AND task = 'manual' AND unit_id LIKE ?"
  ).bind(sessionId, pattern).run();
  await c.env.DB.prepare(
    "UPDATE sessions SET normal_manual_done_at = NULL WHERE session_id = ?"
  ).bind(sessionId).run();
  return json({ ok: true });
});

// ─── Public: survey submissions ───────────────────────────────────────────────

app.post("/api/survey/submit", async (c) => {
  const body = await c.req.json<{
    session_id?: string;
    likert?: Record<string, number>;
    mc_q11?: string;
    open_q12?: string;
    open_q13?: string;
    open_q14?: string;
  }>().catch(() => ({}));
  const sessionId = (body as any).session_id?.trim();
  if (!sessionId) {
    return json({ error: "session_id required" }, 400);
  }
  const responseJson = JSON.stringify({
    likert: (body as any).likert ?? {},
    mc_q11: (body as any).mc_q11 ?? "",
    open_q12: (body as any).open_q12 ?? "",
    open_q13: (body as any).open_q13 ?? "",
    open_q14: (body as any).open_q14 ?? "",
  });
  await c.env.DB.prepare(
    `INSERT INTO survey_responses(session_id, response_json, created_at)
     VALUES (?, ?, ?)`
  ).bind(sessionId, responseJson, nowIso()).run();
  return json({ ok: true });
});

app.get("/api/session/labeled-essays", async (c) => {
  const sessionId = c.req.query("session_id");
  const phase = (c.req.query("phase") ?? "normal") as string;
  if (!sessionId) return json({ error: "session_id required" }, 400);

  const rows = await c.env.DB.prepare(
    `SELECT a.unit_id
     FROM assignments a
     WHERE a.session_id = ? AND a.phase = ? AND a.task = 'manual' AND a.status = 'done'`
  ).bind(sessionId, phase).all<{ unit_id: string }>();

  const essayCounts: Record<number, number> = {};
  for (const r of rows.results ?? []) {
    const m = r.unit_id.match(/^essay(\d+)_sentence/);
    if (m) {
      const idx = parseInt(m[1], 10);
      essayCounts[idx] = (essayCounts[idx] ?? 0) + 1;
    }
  }

  const sentencesPerEssay = 5;
  const fullyLabeled = Object.entries(essayCounts)
    .filter(([, count]) => count >= sentencesPerEssay)
    .map(([idx]) => parseInt(idx, 10))
    .sort((a, b) => a - b);

  return json({ fully_labeled_essays: fullyLabeled });
});

// ─── Public: visualization data (for users after Stage 2) ─────────────────────

app.get("/api/stats/visualization", async (c) => {
  const overall = await getOverallStats(c.env);

  const timeByTask = await c.env.DB.prepare(
    `SELECT
       phase, task,
       COUNT(*) AS attempt_count,
       AVG(active_ms) AS avg_active_ms,
       SUM(active_ms) AS total_active_ms
     FROM label_attempts
     WHERE phase = 'normal'
     GROUP BY phase, task`
  ).all<{
    phase: string;
    task: string;
    attempt_count: number;
    avg_active_ms: number;
    total_active_ms: number;
  }>();

  const sessionCount = await c.env.DB.prepare(
    `SELECT COUNT(DISTINCT session_id) AS cnt FROM label_attempts WHERE phase = 'normal'`
  ).first<{ cnt: number }>();

  const manualRow = (timeByTask.results ?? []).find((r) => r.task === "manual");
  const llmRow = (timeByTask.results ?? []).find((r) => r.task === "llm");
  const sessions = sessionCount?.cnt ?? 1;

  const SENTENCES_PER_ESSAY = 5;
  const TOTAL_ESSAYS = 3;

  const manualSentenceAvg = Math.round(manualRow?.avg_active_ms ?? 0);
  const llmSentenceAvg = Math.round(llmRow?.avg_active_ms ?? 0);

  const manualEssayAvg = Math.round(manualSentenceAvg * SENTENCES_PER_ESSAY);
  const llmEssayAvg = Math.round(llmSentenceAvg * SENTENCES_PER_ESSAY);

  const manualTotalAvg = Math.round((manualRow?.total_active_ms ?? 0) / Math.max(sessions, 1));
  const llmTotalAvg = Math.round((llmRow?.total_active_ms ?? 0) / Math.max(sessions, 1));

  return json({
    label_distribution: {
      normal_manual: overall.breakdown.normal_manual,
      normal_llm: overall.breakdown.normal_llm
    },
    time_comparison: {
      sentence_avg: { manual_ms: manualSentenceAvg, llm_ms: llmSentenceAvg },
      essay_avg: { manual_ms: manualEssayAvg, llm_ms: llmEssayAvg },
      total_avg: { manual_ms: manualTotalAvg, llm_ms: llmTotalAvg }
    },
    meta: { sessions, sentences_per_essay: SENTENCES_PER_ESSAY, total_essays: TOTAL_ESSAYS }
  });
});

// ─── Admin: stats ─────────────────────────────────────────────────────────────

app.get("/api/admin/stats/normal", async (c) => {
  if (!(await checkAdmin(c))) return json({ error: "unauthorized" }, 401);
  const overall = await getOverallStats(c.env);
  return json({ normal_manual: overall.breakdown.normal_manual, normal_llm: overall.breakdown.normal_llm });
});

app.get("/api/admin/stats/overall", async (c) => {
  if (!(await checkAdmin(c))) return json({ error: "unauthorized" }, 401);
  return json(await getOverallStats(c.env));
});

app.get("/api/admin/stats/sync", async (c) => {
  if (!(await checkAdmin(c))) return json({ error: "unauthorized" }, 401);
  const id = c.env.STATS_HUB.idFromName("global");
  const stub = c.env.STATS_HUB.get(id);
  const revRes = await stub.fetch("https://stats/revision");
  const { revision } = (await revRes.json()) as { revision: number };
  const overall = await getOverallStats(c.env);
  return json({
    revision: revision ?? 0,
    normal: { normal_manual: overall.breakdown.normal_manual, normal_llm: overall.breakdown.normal_llm },
    overall
  });
});

app.get("/api/admin/sessions", async (c) => {
  if (!(await checkAdmin(c))) return json({ error: "unauthorized" }, 401);
  return json({ sessions: await getSessionsProgress(c.env) });
});

// ─── Admin: behavior analytics ────────────────────────────────────────────────

app.get("/api/admin/behavior", async (c) => {
  if (!(await checkAdmin(c))) return json({ error: "unauthorized" }, 401);

  const overall = await c.env.DB.prepare(
    `SELECT
       COUNT(*) AS total_attempts,
       AVG(active_ms) AS avg_active_ms,
       AVG(hidden_ms) AS avg_hidden_ms,
       AVG(idle_ms) AS avg_idle_ms,
       SUM(CASE WHEN had_background = 1 THEN 1 ELSE 0 END) AS background_attempts,
       SUM(CASE WHEN is_valid = 0 THEN 1 ELSE 0 END) AS invalid_attempts
     FROM label_attempts`
  ).first<{
    total_attempts: number | null;
    avg_active_ms: number | null;
    avg_hidden_ms: number | null;
    avg_idle_ms: number | null;
    background_attempts: number | null;
    invalid_attempts: number | null;
  }>();

  const byTaskRows = await c.env.DB.prepare(
    `SELECT
       task,
       COUNT(*) AS total_attempts,
       AVG(active_ms) AS avg_active_ms,
       AVG(hidden_ms) AS avg_hidden_ms,
       AVG(idle_ms) AS avg_idle_ms,
       SUM(CASE WHEN had_background = 1 THEN 1 ELSE 0 END) AS background_attempts,
       SUM(CASE WHEN is_valid = 0 THEN 1 ELSE 0 END) AS invalid_attempts
     FROM label_attempts
     GROUP BY task`
  ).all<{
    task: string;
    total_attempts: number;
    avg_active_ms: number;
    avg_hidden_ms: number;
    avg_idle_ms: number;
    background_attempts: number;
    invalid_attempts: number;
  }>();

  const bySessionRows = await c.env.DB.prepare(
    `SELECT
       a.session_id AS session_id,
       s.user_id AS user_id,
       COUNT(*) AS total_attempts,
       AVG(a.active_ms) AS avg_active_ms,
       AVG(a.hidden_ms) AS avg_hidden_ms,
       AVG(a.idle_ms) AS avg_idle_ms,
       SUM(CASE WHEN a.had_background = 1 THEN 1 ELSE 0 END) AS background_attempts,
       SUM(CASE WHEN a.is_valid = 0 THEN 1 ELSE 0 END) AS invalid_attempts,
       MAX(a.created_at) AS last_attempt_at
     FROM label_attempts a
     LEFT JOIN sessions s ON s.session_id = a.session_id
     GROUP BY a.session_id, s.user_id
     ORDER BY last_attempt_at DESC
     LIMIT 50`
  ).all<{
    session_id: string;
    user_id: string | null;
    total_attempts: number;
    avg_active_ms: number;
    avg_hidden_ms: number;
    avg_idle_ms: number;
    background_attempts: number;
    invalid_attempts: number;
    last_attempt_at: string;
  }>();

  const total = overall?.total_attempts ?? 0;
  const backgroundRate = total > 0 ? (overall?.background_attempts ?? 0) / total : 0;
  const invalidRate = total > 0 ? (overall?.invalid_attempts ?? 0) / total : 0;

  const byTask = Object.fromEntries(
    (byTaskRows.results ?? []).map((row) => {
      const taskTotal = row.total_attempts ?? 0;
      return [
        row.task,
        {
          total_attempts: taskTotal,
          avg_active_ms: Math.round(row.avg_active_ms ?? 0),
          avg_hidden_ms: Math.round(row.avg_hidden_ms ?? 0),
          avg_idle_ms: Math.round(row.avg_idle_ms ?? 0),
          background_rate: taskTotal > 0 ? Number(((row.background_attempts ?? 0) / taskTotal).toFixed(4)) : 0,
          invalid_rate: taskTotal > 0 ? Number(((row.invalid_attempts ?? 0) / taskTotal).toFixed(4)) : 0
        }
      ];
    })
  );

  return json({
    overall: {
      total_attempts: total,
      avg_active_ms: Math.round(overall?.avg_active_ms ?? 0),
      avg_hidden_ms: Math.round(overall?.avg_hidden_ms ?? 0),
      avg_idle_ms: Math.round(overall?.avg_idle_ms ?? 0),
      background_rate: Number(backgroundRate.toFixed(4)),
      invalid_rate: Number(invalidRate.toFixed(4))
    },
    by_task: byTask,
    by_session: (bySessionRows.results ?? []).map((row) => {
      const sessionTotal = row.total_attempts ?? 0;
      return {
        session_id: row.session_id,
        user_id: row.user_id ?? "unknown",
        total_attempts: sessionTotal,
        avg_active_ms: Math.round(row.avg_active_ms ?? 0),
        avg_hidden_ms: Math.round(row.avg_hidden_ms ?? 0),
        avg_idle_ms: Math.round(row.avg_idle_ms ?? 0),
        background_rate: sessionTotal > 0 ? Number(((row.background_attempts ?? 0) / sessionTotal).toFixed(4)) : 0,
        invalid_rate: sessionTotal > 0 ? Number(((row.invalid_attempts ?? 0) / sessionTotal).toFixed(4)) : 0,
        last_attempt_at: row.last_attempt_at
      };
    })
  });
});

// ─── Admin: ops / Qwen metrics (rate limiter) ───────────────────────────────────

app.get("/api/admin/ops/qwen_metrics", async (c) => {
  if (!(await checkAdmin(c))) return json({ error: "unauthorized" }, 401);
  if (!c.env.QWEN_LIMITER) {
    return json({ qwen_calls_total: 0, qwen_429_total: 0, retries_total: 0, avg_latency_ms: 0 });
  }
  const id = c.env.QWEN_LIMITER.idFromName("global");
  const r = await c.env.QWEN_LIMITER.get(id).fetch("https://qwen/metrics");
  const data = await r.json();
  return json(data);
});

app.get("/api/admin/ops/recent", async (c) => {
  if (!(await checkAdmin(c))) return json({ error: "unauthorized" }, 401);
  const limit = Math.min(Number(c.req.query("limit")) || 50, 100);
  const rows = await c.env.DB.prepare(
    `SELECT attempt_id, session_id, unit_id, phase, task, llm_mode, created_at
     FROM label_attempts ORDER BY created_at DESC LIMIT ?`
  )
    .bind(limit)
    .all<{ attempt_id: string; session_id: string; unit_id: string; phase: string; task: string; llm_mode: string | null; created_at: string }>();
  return json({ events: rows.results ?? [] });
});

app.get("/api/admin/ops/session/:id", async (c) => {
  if (!(await checkAdmin(c))) return json({ error: "unauthorized" }, 401);
  const sessionId = c.req.param("id");
  const session = await c.env.DB.prepare(
    "SELECT session_id, user_id, created_at, normal_manual_done_at, normal_llm_done_at, active_manual_done_at FROM sessions WHERE session_id = ?"
  )
    .bind(sessionId)
    .first<{ session_id: string; user_id: string; created_at: string; normal_manual_done_at: string | null; normal_llm_done_at: string | null; active_manual_done_at: string | null }>();
  if (!session) return json({ error: "session not found" }, 404);
  const counts = await c.env.DB.prepare(
    `SELECT phase, task, SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) as done, COUNT(*) as total
     FROM assignments WHERE session_id = ? GROUP BY phase, task`
  )
    .bind(sessionId)
    .all<{ phase: string; task: string; done: number; total: number }>();
  const attempts = await c.env.DB.prepare(
    `SELECT attempt_id, unit_id, phase, task, llm_mode, created_at FROM label_attempts
     WHERE session_id = ? ORDER BY created_at DESC LIMIT 10`
  )
    .bind(sessionId)
    .all<{ attempt_id: string; unit_id: string; phase: string; task: string; llm_mode: string | null; created_at: string }>();
  return json({
    session_id: session.session_id,
    user_id: session.user_id,
    created_at: session.created_at,
    progress: counts.results ?? [],
    recent_attempts: (attempts.results ?? []).map((a) => ({ attempt_id: a.attempt_id.slice(0, 8), unit_id: a.unit_id?.slice(0, 8), phase: a.phase, task: a.task, llm_mode: a.llm_mode, created_at: a.created_at }))
  });
});

app.get("/api/admin/audit/consistency", async (c) => {
  if (!(await checkAdmin(c))) return json({ error: "unauthorized" }, 401);
  const mismatches: string[] = [];
  const batchResults = await c.env.DB.batch([
    c.env.DB.prepare("SELECT COUNT(*) as c FROM assignments WHERE phase='normal' AND task='manual' AND status='done'"),
    c.env.DB.prepare("SELECT COUNT(*) as c FROM manual_labels WHERE phase='normal'"),
    c.env.DB.prepare("SELECT COUNT(*) as c FROM label_attempts WHERE phase='normal' AND task='manual'"),
    c.env.DB.prepare("SELECT COUNT(*) as c FROM assignments WHERE phase='normal' AND task='llm' AND status='done'"),
    c.env.DB.prepare("SELECT COUNT(*) as c FROM llm_labels WHERE phase='normal' AND accepted_label IS NOT NULL"),
    c.env.DB.prepare("SELECT session_id, unit_id, phase, run_count FROM llm_run_counts WHERE mode='custom' AND run_count > 5")
  ]);
  const normalManualDone = (batchResults[0].results as { c: number }[])?.[0]?.c ?? 0;
  const manualLabelsNormal = (batchResults[1].results as { c: number }[])?.[0]?.c ?? 0;
  const manualAttemptsNormal = (batchResults[2].results as { c: number }[])?.[0]?.c ?? 0;
  const normalLlmDone = (batchResults[3].results as { c: number }[])?.[0]?.c ?? 0;
  const llmLabelsNormal = (batchResults[4].results as { c: number }[])?.[0]?.c ?? 0;
  const customRuns = (batchResults[5].results ?? []) as { session_id: string; unit_id: string; phase: string; run_count: number }[];
  if (normalManualDone !== manualLabelsNormal) {
    mismatches.push(`normal_manual: assignments_done=${normalManualDone} vs manual_labels=${manualLabelsNormal}`);
  }
  if (normalLlmDone !== llmLabelsNormal) {
    mismatches.push(`normal_llm: assignments_done=${normalLlmDone} vs llm_labels_accepted=${llmLabelsNormal}`);
  }
  for (const row of customRuns) {
    mismatches.push(`custom_run_count>5: session=${row.session_id} unit=${row.unit_id} phase=${row.phase} count=${row.run_count}`);
  }
  return json({
    ok: mismatches.length === 0,
    normal_manual: { assignments_done: normalManualDone, manual_labels: manualLabelsNormal, attempts: manualAttemptsNormal },
    normal_llm: { assignments_done: normalLlmDone, llm_labels_accepted: llmLabelsNormal },
    custom_run_violations: customRuns.length,
    mismatches: mismatches.slice(0, 50)
  });
});

// ─── Admin: data export (full dataset JSONL) ──────────────────────────────────

app.get("/api/admin/export", async (c) => {
  if (!(await checkAdmin(c))) return json({ error: "unauthorized" }, 401);

  const format = (c.req.query("format") ?? "jsonl") as "jsonl" | "csv";
  const offset = Math.max(0, parseInt(c.req.query("offset") ?? "0", 10) || 0);
  const limit = Math.min(EXPORT_PAGE_SIZE, Math.max(1, parseInt(c.req.query("limit") ?? String(EXPORT_PAGE_SIZE), 10) || EXPORT_PAGE_SIZE));

  // One row per (session, unit, phase); drive from all assignments so manual- and llm-only units are included
  const rows = await c.env.DB.prepare(
    `SELECT
       s.session_id,
       s.user_id,
       u.unit_id,
       u.text,
       a.phase AS manual_phase,
       ml.label AS manual_label,
       ml.updated_at AS manual_labeled_at,
       l1.predicted_label AS llm_p1_predicted,
       l1.accepted_label AS llm_p1_accepted,
       l2.predicted_label AS llm_p2_predicted,
       l2.accepted_label AS llm_p2_accepted,
       lc.predicted_label AS llm_custom_predicted,
       lc.accepted_label AS llm_custom_accepted,
       la_m.active_ms  AS manual_active_ms,
       la_m.hidden_ms  AS manual_hidden_ms,
       la_m.idle_ms    AS manual_idle_ms,
       la_m.hidden_count AS manual_hidden_count,
       la_m.blur_count AS manual_blur_count,
       la_m.had_background AS manual_had_background,
       la_m.is_valid   AS manual_is_valid,
       la_m.invalid_reason AS manual_invalid_reason,
       la_m.shown_at_epoch_ms AS manual_shown_at,
       la_m.answered_at_epoch_ms AS manual_answered_at,
       CASE WHEN (la_m.answered_at_epoch_ms - la_m.shown_at_epoch_ms) > 0
            THEN (la_m.answered_at_epoch_ms - la_m.shown_at_epoch_ms) ELSE NULL END AS manual_duration_ms,
       la_l.active_ms  AS llm_active_ms,
       la_l.hidden_ms  AS llm_hidden_ms,
       la_l.idle_ms    AS llm_idle_ms,
       la_l.hidden_count AS llm_hidden_count,
       la_l.blur_count AS llm_blur_count,
       la_l.had_background AS llm_had_background,
       la_l.is_valid   AS llm_is_valid,
       la_l.invalid_reason AS llm_invalid_reason,
       la_l.shown_at_epoch_ms AS llm_shown_at,
       la_l.answered_at_epoch_ms AS llm_answered_at,
       CASE WHEN (la_l.answered_at_epoch_ms - la_l.shown_at_epoch_ms) > 0
            THEN (la_l.answered_at_epoch_ms - la_l.shown_at_epoch_ms) ELSE NULL END AS llm_duration_ms,
       rs.ordering AS ranking_ordering,
       rs.created_at AS ranking_created_at
     FROM (SELECT session_id, unit_id, phase, MIN(ordering) AS ordering FROM assignments GROUP BY session_id, unit_id, phase) a
     JOIN sessions s ON s.session_id = a.session_id
     JOIN units u ON u.unit_id = a.unit_id
     LEFT JOIN manual_labels ml ON ml.session_id = s.session_id AND ml.unit_id = a.unit_id AND ml.phase = a.phase
     LEFT JOIN llm_labels l1 ON l1.session_id = s.session_id AND l1.unit_id = a.unit_id AND l1.phase = a.phase AND l1.mode = 'prompt1'
     LEFT JOIN llm_labels l2 ON l2.session_id = s.session_id AND l2.unit_id = a.unit_id AND l2.phase = a.phase AND l2.mode = 'prompt2'
     LEFT JOIN llm_labels lc ON lc.session_id = s.session_id AND lc.unit_id = a.unit_id AND lc.phase = a.phase AND lc.mode = 'custom'
     LEFT JOIN label_attempts la_m ON la_m.session_id = s.session_id AND la_m.unit_id = a.unit_id AND la_m.phase = a.phase AND la_m.task = 'manual'
     LEFT JOIN label_attempts la_l ON la_l.session_id = s.session_id AND la_l.unit_id = a.unit_id AND la_l.phase = a.phase AND la_l.task = 'llm'
     LEFT JOIN ranking_submissions rs ON rs.session_id = s.session_id AND rs.essay_index = CAST(SUBSTR(u.unit_id, 6, 4) AS INTEGER)
     ORDER BY s.session_id, a.phase, a.ordering ASC
     LIMIT ? OFFSET ?`
  )
    .bind(limit, offset)
    .all<Record<string, any>>();

  const records = rows.results ?? [];
  const truncated = records.length >= limit;
  const meta = { offset, limit, count: records.length, truncated, hint: truncated ? "Use query params offset/limit to fetch more (e.g. ?offset=10000&limit=10000)" : undefined };

  if (format === "csv") {
    const headers = [
      "session_id","user_id","unit_id","text","manual_phase","manual_label","manual_labeled_at",
      "llm_p1_predicted","llm_p1_accepted","llm_p2_predicted","llm_p2_accepted",
      "llm_custom_predicted","llm_custom_accepted",
      "manual_active_ms","manual_hidden_ms","manual_idle_ms","manual_hidden_count","manual_blur_count","manual_had_background",
      "manual_is_valid","manual_invalid_reason","manual_shown_at","manual_answered_at","manual_duration_ms",
      "llm_active_ms","llm_hidden_ms","llm_idle_ms","llm_hidden_count","llm_blur_count","llm_had_background",
      "llm_is_valid","llm_invalid_reason","llm_shown_at","llm_answered_at","llm_duration_ms",
      "ranking_ordering","ranking_created_at"
    ];
    const escape = (v: any) => {
      const s = String(v ?? "");
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };
    const lines = [
      headers.join(","),
      ...records.map((r) => headers.map((h) => escape(r[h])).join(","))
    ];
    return new Response(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="labeling_export_${Date.now()}.csv"`,
        "X-Export-Meta": JSON.stringify(meta)
      }
    });
  }

  // JSONL (default); X-Export-Meta header indicates truncation and pagination
  const jsonlBody = records.map((r) => JSON.stringify(r)).join("\n");
  return new Response(jsonlBody, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Content-Disposition": `attachment; filename="labeling_export_${Date.now()}.jsonl"`,
      "X-Export-Meta": JSON.stringify(meta)
    }
  });
});

// ─── Admin: ranking export ────────────────────────────────────────────────────

app.get("/api/admin/export/rankings", async (c) => {
  if (!(await checkAdmin(c))) return json({ error: "unauthorized" }, 401);

  const rows = await c.env.DB.prepare(
    `SELECT rs.session_id, s.user_id, rs.essay_index, rs.ordering, rs.created_at
     FROM ranking_submissions rs
     JOIN sessions s ON s.session_id = rs.session_id
     ORDER BY rs.session_id, rs.essay_index`
  ).all<Record<string, any>>();

  const records = rows.results ?? [];
  const format = (c.req.query("format") ?? "jsonl") as "jsonl" | "csv";

  if (format === "csv") {
    const headers = ["session_id", "user_id", "essay_index", "ordering", "created_at"];
    const escape = (v: any) => {
      const s = String(v ?? "");
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(","), ...records.map((r) => headers.map((h) => escape(r[h])).join(","))];
    return new Response(lines.join("\n"), {
      headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="ranking_export_${Date.now()}.csv"` }
    });
  }

  const jsonlBody = records.map((r) => JSON.stringify(r)).join("\n");
  return new Response(jsonlBody, {
    headers: { "Content-Type": "application/x-ndjson", "Content-Disposition": `attachment; filename="ranking_export_${Date.now()}.jsonl"` }
  });
});

// ─── Admin: units management ──────────────────────────────────────────────────

app.post("/api/admin/units/clear", async (c) => {
  if (!(await checkAdmin(c))) return json({ error: "unauthorized" }, 401);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM idempotency_keys"),
    c.env.DB.prepare("DELETE FROM interaction_events"),
    c.env.DB.prepare("DELETE FROM label_attempts"),
    c.env.DB.prepare("DELETE FROM manual_labels"),
    c.env.DB.prepare("DELETE FROM llm_labels"),
    c.env.DB.prepare("DELETE FROM llm_run_counts"),
    c.env.DB.prepare("DELETE FROM assignments"),
    c.env.DB.prepare("DELETE FROM al_scores"),
    c.env.DB.prepare("DELETE FROM units"),
    c.env.DB.prepare("DELETE FROM sessions"),
    c.env.DB.prepare("DELETE FROM rate_limits"),
    c.env.DB.prepare("DELETE FROM ranking_submissions")
  ]);
  return json({ ok: true, message: "units cleared" });
});

app.post("/api/admin/units/import", async (c) => {
  if (!(await checkAdmin(c))) return json({ error: "unauthorized" }, 401);
  const body = (await c.req.json<{ units?: Array<{ unit_id?: string; text?: string; meta_json?: string }> }>().catch(() => null)) ?? {};
  const units = Array.isArray(body.units) ? body.units.slice(0, UNITS_IMPORT_BATCH_MAX) : [];
  if (units.length === 0) return json({ error: "units array required (max " + UNITS_IMPORT_BATCH_MAX + " per request)" }, 400);
  const toInsert: { uid: string; text: string; meta: string | null }[] = [];
  for (const unit of units) {
    const uid = (unit.unit_id ?? "").toString().slice(0, 256);
    if (!uid) continue;
    const text = (unit.text ?? "").toString().slice(0, 100_000);
    const meta = (unit.meta_json ?? null) != null ? String(unit.meta_json).slice(0, 5000) : null;
    toInsert.push({ uid, text, meta });
  }
  if (toInsert.length > 0) {
    const stmts = toInsert.map(({ uid, text, meta }) =>
      c.env.DB.prepare(
        "INSERT INTO units(unit_id, text, meta_json) VALUES (?, ?, ?) ON CONFLICT(unit_id) DO UPDATE SET text = excluded.text, meta_json = excluded.meta_json"
      ).bind(uid, text, meta)
    );
    await c.env.DB.batch(stmts);
  }
  return json({ ok: true, imported: toInsert.length, skipped: units.length - toInsert.length });
});

// ─── Admin: taxonomy / prompts ────────────────────────────────────────────────

app.post("/api/admin/taxonomy/set", async (c) => {
  if (!(await checkAdmin(c))) return json({ error: "unauthorized" }, 401);
  const body = (await c.req.json<{ labels?: Array<{ label: string; description?: string }> }>().catch(() => null)) ?? {};
  const labels = Array.isArray(body.labels) ? body.labels : [];
  const stmts = [c.env.DB.prepare("DELETE FROM taxonomy_labels")];
  labels.forEach((item, i) => {
    stmts.push(
      c.env.DB.prepare(
        "INSERT INTO taxonomy_labels(label, description, ordering) VALUES (?, ?, ?)"
      ).bind(item.label, item.description ?? null, i)
    );
  });
  await c.env.DB.batch(stmts);
  return json({ ok: true });
});

app.post("/api/admin/prompts/set", async (c) => {
  if (!(await checkAdmin(c))) return json({ error: "unauthorized" }, 401);
  const body = (await c.req.json<{ prompt1?: string; prompt2?: string }>().catch(() => null)) ?? {};
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE prompts SET prompt_text = ?, version = version + 1, updated_at = ? WHERE prompt_key = 'prompt1'"
    ).bind(body.prompt1 ?? "", now),
    c.env.DB.prepare(
      "UPDATE prompts SET prompt_text = ?, version = version + 1, updated_at = ? WHERE prompt_key = 'prompt2'"
    ).bind(body.prompt2 ?? "", now)
  ]);
  return json({ ok: true });
});

// ─── Admin: session config (normal_n / active_m) ─────────────────────────────

app.get("/api/admin/config/session", async (c) => {
  if (!(await checkAdmin(c))) return json({ error: "unauthorized" }, 401);
  const rows = await c.env.DB.prepare(
    "SELECT key, value FROM config WHERE key IN ('normal_n', 'active_m')"
  ).all<{ key: string; value: string }>();
  const map: Record<string, number> = { normal_n: 6, active_m: 4 };
  for (const r of rows.results ?? []) map[r.key] = Number(r.value) || map[r.key];
  return json(map);
});

app.post("/api/admin/config/session", async (c) => {
  if (!(await checkAdmin(c))) return json({ error: "unauthorized" }, 401);
  const body = (await c.req.json<{ normal_n?: number; active_m?: number }>().catch(() => null)) ?? {};
  const now = nowIso();
  const stmts: ReturnType<typeof c.env.DB.prepare>[] = [];
  if (typeof body.normal_n === "number" && Number.isFinite(body.normal_n)) {
    const v = Math.min(SESSION_NORMAL_MAX, Math.max(1, Math.floor(body.normal_n)));
    stmts.push(
      c.env.DB.prepare("INSERT INTO config(key, value, updated_at) VALUES ('normal_n', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(String(v), now)
    );
  }
  if (typeof body.active_m === "number" && Number.isFinite(body.active_m)) {
    const v = Math.min(SESSION_ACTIVE_MAX, Math.max(0, Math.floor(body.active_m)));
    stmts.push(
      c.env.DB.prepare("INSERT INTO config(key, value, updated_at) VALUES ('active_m', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(String(v), now)
    );
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  return json({ ok: true });
});

// ─── ED-AL v1: TF-IDF + k-center greedy (Entropy + Diversity) ─────────────────

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((t) => t.length > 1);
}

function buildTfIdfVectors(texts: string[]): Map<string, number>[] {
  const tokenized = texts.map(tokenize);
  const df = new Map<string, number>();
  for (const tokens of tokenized) {
    for (const term of new Set(tokens)) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  const N = texts.length;
  return tokenized.map((tokens) => {
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    const vec = new Map<string, number>();
    for (const [term, freq] of tf) {
      const idf = Math.log((N + 1) / ((df.get(term) ?? 0) + 1));
      vec.set(term, (freq / Math.max(tokens.length, 1)) * idf);
    }
    return vec;
  });
}

function cosineDistance(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, normA = 0, normB = 0;
  for (const [term, val] of a) {
    dot += val * (b.get(term) ?? 0);
    normA += val * val;
  }
  for (const val of b.values()) normB += val * val;
  if (normA === 0 || normB === 0) return 1;
  return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function kCenterGreedy(
  items: { id: string; vec: Map<string, number> }[],
  m: number,
  seedIdx: number
): string[] {
  if (items.length <= m) return items.map((x) => x.id);
  const startIdx = Math.abs(seedIdx) % items.length;
  const selected = new Set<number>([startIdx]);
  const minDist = items.map((_, i) =>
    i === startIdx ? 0 : cosineDistance(items[startIdx].vec, items[i].vec)
  );
  while (selected.size < Math.min(m, items.length)) {
    let best = -1;
    let bestDist = -1;
    for (let i = 0; i < items.length; i++) {
      if (selected.has(i)) continue;
      if (minDist[i] > bestDist) { bestDist = minDist[i]; best = i; }
    }
    if (best === -1) break;
    selected.add(best);
    for (let i = 0; i < items.length; i++) {
      if (selected.has(i)) continue;
      const d = cosineDistance(items[best].vec, items[i].vec);
      if (d < minDist[i]) minDist[i] = d;
    }
  }
  return [...selected].map((i) => items[i].id);
}

function shannonEntropy(labels: string[], numClasses: number): number {
  const freq = new Map<string, number>();
  for (const l of labels) freq.set(l, (freq.get(l) ?? 0) + 1);
  const n = labels.length;
  let H = 0;
  for (const count of freq.values()) {
    const p = count / n;
    if (p > 0) H -= p * Math.log2(p);
  }
  const maxH = Math.log2(Math.max(numClasses, 2));
  return maxH > 0 ? H / maxH : 0;
}

async function callQwenSampling(
  env: Env,
  text: string,
  prompt: string,
  taxonomy: string[],
  temperature: number,
  requestId: string
): Promise<string> {
  const base = (env.QWEN_BASE_URL ?? "").replace(/\/$/, "");
  const system = buildLlmInstruction(taxonomy);
  const messages = [
    { role: "system", content: `${system}\n\nPrompt:\n${prompt}` },
    { role: "user", content: text }
  ];
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 20000);
    const resp = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.QWEN_API_KEY}` },
      body: JSON.stringify({ model: "qwen-plus", messages, temperature, max_tokens: 60 }),
      signal: controller.signal
    });
    clearTimeout(t);
    if (!resp.ok) {
      console.warn(`[AL-Sampling] ${requestId} Qwen HTTP ${resp.status}`);
      return "UNKNOWN";
    }
    const data: any = await resp.json();
    const raw: string = data?.choices?.[0]?.message?.content ?? "";
    return extractLabel(raw, taxonomy);
  } catch (err: any) {
    console.warn(`[AL-Sampling] ${requestId} error: ${err?.message?.slice(0, 120) ?? "unknown"}`);
    return "UNKNOWN";
  }
}

type EdAlParams = {
  candidateK: number;
  topH: number;
  sampleN: number;
  activeM: number;
  temperature: number;
  seed: number;
};

async function executeEdAlRun(env: Env, runId: string, params: EdAlParams) {
  const { candidateK, topH, sampleN, activeM, temperature, seed } = params;
  await env.DB.prepare("UPDATE al_runs SET status='running' WHERE run_id=?").bind(runId).run();
  const log = (msg: string) => console.log(`[ED-AL v1] ${runId.slice(0, 8)} ${msg}`);

  try {
    const taxonomy = await getTaxonomyValues(env);
    const prompt2 = await getPrompt(env, "prompt2");
    const prompt1 = await getPrompt(env, "prompt1");

    log(`candidateK=${candidateK}, topH=${topH}, sampleN=${sampleN}, activeM=${activeM}, temp=${temperature}`);

    // Step 1: Sample candidate pool
    const candidates = await env.DB.prepare(
      "SELECT unit_id, text, meta_json FROM units ORDER BY RANDOM() LIMIT ?"
    ).bind(candidateK).all<{ unit_id: string; text: string; meta_json: string | null }>();

    const candidateList = candidates.results ?? [];
    log(`Got ${candidateList.length} candidates`);

    // Step 2: Compute entropy via n samples at given temperature (few-shot prompt2)
    type ScoredUnit = { unit_id: string; text: string; entropy: number; topLabels: Record<string, number> };
    const scored: ScoredUnit[] = [];

    for (const unit of candidateList) {
      const labels: string[] = [];
      for (let i = 0; i < sampleN; i++) {
        const rid = `${runId.slice(0, 8)}-s${i}-${unit.unit_id.slice(0, 6)}`;
        await qwenAcquire(env);
        const t0 = Date.now();
        let label: string;
        try {
          label = await callQwenSampling(env, unit.text, prompt2, taxonomy, temperature, rid);
          await qwenRelease(env, 200, Date.now() - t0, 0);
        } catch (e: any) {
          await qwenRelease(env, e?.status ?? 500, Date.now() - t0, e?.retryCount ?? 0);
          throw e;
        }
        labels.push(label);
        if (i < sampleN - 1) await new Promise((r) => setTimeout(r, 600));
      }
      const entropy = shannonEntropy(labels, taxonomy.length);
      const freq: Record<string, number> = {};
      for (const l of labels) freq[l] = (freq[l] ?? 0) + 1;
      scored.push({ unit_id: unit.unit_id, text: unit.text, entropy, topLabels: freq });
      log(`  ${unit.unit_id.slice(0, 12)}: entropy=${entropy.toFixed(4)} labels=[${labels.join(",")}]`);
      await new Promise((r) => setTimeout(r, 500));
    }

    // Step 3: Take top_h by entropy for diversity selection
    scored.sort((a, b) => b.entropy - a.entropy);
    const topCandidates = scored.slice(0, Math.min(topH, scored.length));
    log(`Top ${topCandidates.length} by entropy selected for diversity pass`);

    // Step 4: Build TF-IDF + k-center greedy to choose activeM diverse units
    const vectors = buildTfIdfVectors(topCandidates.map((u) => u.text));
    const items = topCandidates.map((u, i) => ({ id: u.unit_id, vec: vectors[i] }));
    const selectedIds = new Set(kCenterGreedy(items, activeM, seed));
    log(`k-center greedy selected ${selectedIds.size} diverse units`);

    // Step 5: Write al_scores for all top candidates (batch)
    const now = nowIso();
    const alScoreStmts = topCandidates.map((unit, i) => {
      const diversityRank = selectedIds.has(unit.unit_id) ? i + 1 : null;
      const reason = JSON.stringify({
        method: "ed_al_v1",
        entropy: Number(unit.entropy.toFixed(6)),
        top_labels: unit.topLabels,
        diversity_rank: diversityRank,
        selected: selectedIds.has(unit.unit_id)
      });
      return env.DB.prepare(
        `INSERT INTO al_scores(unit_id, score, reason, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(unit_id) DO UPDATE SET score=excluded.score, reason=excluded.reason, updated_at=excluded.updated_at`
      ).bind(unit.unit_id, Number(unit.entropy.toFixed(6)), reason, now);
    });
    if (alScoreStmts.length > 0) await env.DB.batch(alScoreStmts);
    log("al_scores written");

    // Step 6: Run Active LLM (Prompt1 + Prompt2) on selected diverse units; persist in one batch per unit
    const activeUnits = candidateList.filter((u) => selectedIds.has(u.unit_id));
    for (const unit of activeUnits) {
      await qwenAcquire(env);
      const t1 = Date.now();
      let r1: Awaited<ReturnType<typeof runLlmWithRetry>>;
      try {
        r1 = await runLlmWithRetry(env, { text: unit.text, prompt: prompt1, taxonomy, mode: "prompt1" });
        await qwenRelease(env, 200, Date.now() - t1, 0);
      } catch (e: any) {
        await qwenRelease(env, e?.status ?? 500, Date.now() - t1, e?.retryCount ?? 0);
        throw e;
      }
      await new Promise((r) => setTimeout(r, 900));

      await qwenAcquire(env);
      const t2 = Date.now();
      let r2: Awaited<ReturnType<typeof runLlmWithRetry>>;
      try {
        r2 = await runLlmWithRetry(env, { text: unit.text, prompt: prompt2, taxonomy, mode: "prompt2" });
        await qwenRelease(env, 200, Date.now() - t2, 0);
      } catch (e: any) {
        await qwenRelease(env, e?.status ?? 500, Date.now() - t2, e?.retryCount ?? 0);
        throw e;
      }
      await runActiveLlmBatch(env, unit.unit_id, r1, r2);
      await new Promise((r) => setTimeout(r, 900));
    }

    await env.DB.prepare("UPDATE al_runs SET status='done', detail_json=? WHERE run_id=?")
      .bind(JSON.stringify({ strategy: "ed_al_v1", candidateK, topH, sampleN, activeM, temperature, seed, scored: scored.length, selected: activeUnits.length }), runId)
      .run();
    await broadcastStats(env);
    log(`Done! selected=${activeUnits.length}`);
  } catch (error: any) {
    console.error("[ED-AL v1] run error", error);
    await env.DB.prepare("UPDATE al_runs SET status='error', detail_json=? WHERE run_id=?")
      .bind(JSON.stringify({ error: String(error) }), runId).run();
  }
}

app.post("/api/admin/al/run", async (c) => {
  if (!(await checkAdmin(c))) return json({ error: "unauthorized" }, 401);
  const body = await c.req.json<{
    candidate_k?: number;
    top_h?: number;
    sample_n?: number;
    active_m?: number;
    active_llm_n?: number;
    temperature?: number;
    seed?: number;
  }>().catch(() => ({}));
  const clamp = (v: unknown, min: number, max: number, def: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : def;
  };
  const clampF = (v: unknown, min: number, max: number, def: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def;
  };
  const candidateK = clamp((body as any).candidate_k, 10, 500, 80);
  const topH = clamp((body as any).top_h, 5, 200, 40);
  const sampleN = clamp((body as any).sample_n, 1, 10, 3);
  const activeM = clamp((body as any).active_m ?? (body as any).active_llm_n, 1, 200, 20);
  const temperature = clampF((body as any).temperature, 0, 2, 0.7);
  const seed = clamp((body as any).seed, 0, 99999, Math.floor(Math.random() * 9999));
  const runId = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO al_runs(run_id, created_at, status, detail_json) VALUES (?, ?, 'running', ?)"
  ).bind(runId, nowIso(), "{}").run();
  c.executionCtx.waitUntil(executeEdAlRun(c.env, runId, { candidateK, topH, sampleN, activeM, temperature, seed }));
  return json({ ok: true, run_id: runId, status: "running", params: { candidateK, topH, sampleN, activeM, temperature, seed } });
});

app.get("/api/admin/al/status", async (c) => {
  if (!(await checkAdmin(c))) return json({ error: "unauthorized" }, 401);
  const runId = c.req.query("run_id");
  if (!runId) return json({ error: "run_id required" }, 400);
  const row = await c.env.DB.prepare(
    "SELECT status, detail_json, created_at FROM al_runs WHERE run_id = ?"
  )
    .bind(runId)
    .first<{ status: string; detail_json: string; created_at: string }>();
  return json({ run_id: runId, status: row?.status ?? "not_found", detail: row?.detail_json, created_at: row?.created_at });
});

// ─── Admin: share link ────────────────────────────────────────────────────────

app.post("/api/admin/share/create", async (c) => {
  if (!(await checkAdmin(c))) return json({ error: "unauthorized" }, 401);
  const token = crypto.randomUUID().replaceAll("-", "");
  const now = nowIso();
  const expiresAt = new Date(Date.now() + SHARE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await c.env.DB.prepare(
    "INSERT INTO share_tokens(token, created_at, expires_at, revoked) VALUES (?, ?, ?, 0)"
  )
    .bind(token, now, expiresAt)
    .run();
  return json({ share_token: token, expires_at: expiresAt });
});

app.post("/api/admin/share/revoke", async (c) => {
  if (!(await checkAdmin(c))) return json({ error: "unauthorized" }, 401);
  const body = (await c.req.json<{ token?: string }>().catch(() => null)) ?? {};
  const token = body.token?.trim();
  if (!token) return json({ error: "token required" }, 400);
  await c.env.DB.prepare("UPDATE share_tokens SET revoked = 1 WHERE token = ?").bind(token).run();
  return json({ ok: true });
});

// ─── SSE streams ──────────────────────────────────────────────────────────────

app.get("/api/stream/stats", async (c) => {
  if (!(await checkAdmin(c))) return json({ error: "unauthorized" }, 401);
  const id = c.env.STATS_HUB.idFromName("global");
  const stub = c.env.STATS_HUB.get(id);
  return stub.fetch("https://stats/stream");
});

app.get("/api/share/stats", async (c) => {
  const token = c.req.query("token");
  if (!token) return json({ error: "token required" }, 400);
  const row = await c.env.DB.prepare(
    "SELECT token FROM share_tokens WHERE token = ? AND revoked = 0 AND (expires_at IS NULL OR expires_at > datetime('now'))"
  )
    .bind(token)
    .first();
  if (!row) return json({ error: "invalid token" }, 401);
  return json(await getOverallStats(c.env));
});

app.get("/api/share/stream/stats", async (c) => {
  const token = c.req.query("token");
  if (!token) return json({ error: "token required" }, 400);
  const row = await c.env.DB.prepare(
    "SELECT token FROM share_tokens WHERE token = ? AND revoked = 0 AND (expires_at IS NULL OR expires_at > datetime('now'))"
  )
    .bind(token)
    .first();
  if (!row) return json({ error: "invalid token" }, 401);
  const id = c.env.STATS_HUB.idFromName("global");
  const stub = c.env.STATS_HUB.get(id);
  return stub.fetch("https://stats/stream");
});

export default app;
export { StatsHub, QwenRateLimiter };
