import { getAdminToken } from "./storage";

export const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export type Phase = "normal" | "active";
export type Task = "manual" | "llm";
export type LlmMode = "prompt1" | "prompt2" | "custom";

export type AttemptPayload = {
  shown_at_epoch_ms: number;
  answered_at_epoch_ms: number;
  active_ms: number;
  hidden_ms: number;
  idle_ms: number;
  hidden_count: number;
  blur_count: number;
  had_background: number;
  events: Array<{ t_perf_ms: number; t_epoch_ms: number; type: string; payload_json?: string }>;
};

const REQUEST_TIMEOUT_MS = 15_000;
const EXPORT_TIMEOUT_MS = 60_000;

function adminHeaders(token?: string, extra?: HeadersInit) {
  const resolved = token || getAdminToken();
  return {
    ...(extra ?? {}),
    ...(resolved ? { Authorization: `Bearer ${resolved}` } : {})
  } as HeadersInit;
}

async function req(path: string, init?: RequestInit) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    const offlineErr: any = new Error("network offline");
    offlineErr.code = "NETWORK_OFFLINE";
    throw offlineErr;
  }

  const method = (init?.method ?? "GET").toUpperCase();
  const maxNetworkAttempts = method === "GET" ? 2 : 1;

  for (let attempt = 1; attempt <= maxNetworkAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        ...init,
        signal: controller.signal
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const err: any = new Error((data as any)?.error ?? "request failed");
        err.status = response.status;
        err.data = data;
        throw err;
      }
      return response.json();
    } catch (error) {
      if (typeof error === "object" && error && ("status" in error || "data" in error)) {
        throw error;
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        const timeoutErr: any = new Error("request timeout");
        timeoutErr.code = "REQUEST_TIMEOUT";
        throw timeoutErr;
      }
      if (attempt < maxNetworkAttempts) continue;
      const networkErr: any = new Error("network unavailable");
      networkErr.code = "NETWORK_ERROR";
      throw networkErr;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("unreachable");
}

export const api = {
  getTaxonomy: () => req("/api/taxonomy"),
  getPrompts: () => req("/api/prompts"),
  startSession: (payload: { user_id?: string; normal_n?: number; active_m?: number }) =>
    req("/api/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }),
  resetSession: (payload: { session_id: string; reset_token?: string }) =>
    req("/api/session/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }),
  getSessionStatus: (sessionId: string) =>
    req(`/api/session/status?session_id=${encodeURIComponent(sessionId)}`),
  getNextUnit: (sessionId: string, phase: Phase, task: Task) =>
    req(`/api/units/next?session_id=${encodeURIComponent(sessionId)}&phase=${phase}&task=${task}`),
  getActiveLlmResults: (sessionId: string) =>
    req(`/api/active/llm/results?session_id=${encodeURIComponent(sessionId)}`),
  submitManual: (payload: {
    session_id: string;
    unit_id: string;
    phase: Phase;
    label: string;
    attempt: AttemptPayload;
    idempotency_key?: string;
  }) =>
    req("/api/labels/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }),
  undoManual: (payload: { session_id: string; unit_id: string; phase: Phase }) =>
    req("/api/labels/undo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }),
  runLlm: (payload: {
    session_id: string;
    unit_id: string;
    phase: "normal";
    mode: LlmMode;
    custom_prompt_text?: string;
  }) =>
    req("/api/llm/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }),
  acceptLlm: (payload: {
    session_id: string;
    unit_id: string;
    phase: "normal";
    mode: LlmMode;
    accepted_label: string;
    attempt: AttemptPayload;
    idempotency_key?: string;
  }) =>
    req("/api/llm/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }),
  getCustomCount: (sessionId: string, unitId: string, phase: Phase) =>
    req(
      `/api/llm/custom/count?session_id=${encodeURIComponent(sessionId)}&unit_id=${encodeURIComponent(unitId)}&phase=${phase}`
    ) as Promise<{ count: number; max: number; exhausted: boolean }>,

  submitRanking: (payload: { session_id: string; essay_index: number; ordering: string[] }) =>
    req("/api/ranking/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }),

  submitSurvey: (payload: {
    session_id: string;
    likert: Record<string, number>;
    mc_q11: string;
    open_q12: string;
    open_q13: string;
    open_q14: string;
  }) =>
    req("/api/survey/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }),
  getRankingStatus: (sessionId: string) =>
    req(`/api/ranking/status?session_id=${encodeURIComponent(sessionId)}`) as Promise<{
      ranked_essays: number[];
    }>,
  getLabeledEssays: (sessionId: string, phase: Phase = "normal") =>
    req(`/api/session/labeled-essays?session_id=${encodeURIComponent(sessionId)}&phase=${phase}`) as Promise<{
      fully_labeled_essays: number[];
    }>,

  getVisualizationStats: () =>
    req("/api/stats/visualization") as Promise<{
      label_distribution: {
        normal_manual: Record<string, number>;
        normal_llm: Record<string, number>;
      };
      time_comparison: {
        sentence_avg: { manual_ms: number; llm_ms: number };
        essay_avg: { manual_ms: number; llm_ms: number };
        total_avg: { manual_ms: number; llm_ms: number };
      };
      meta: { sessions: number; sentences_per_essay: number; total_essays: number };
    }>,

  // ─── Admin ───────────────────────────────────────────────────────────────
  adminLogin: (adminToken: string) =>
    req("/api/admin/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ admin_token: adminToken })
    }) as Promise<{ token: string; expires_at_epoch_ms: number }>,
  adminVerify: (token?: string) =>
    req("/api/admin/auth/verify", { headers: adminHeaders(token) }) as Promise<{ ok: boolean }>,
  adminGetNormalStats: (token?: string) =>
    req("/api/admin/stats/normal", { headers: adminHeaders(token) }),
  adminGetOverallStats: (token?: string) =>
    req("/api/admin/stats/overall", { headers: adminHeaders(token) }),
  adminGetStatsSync: (token?: string) =>
    req("/api/admin/stats/sync", { headers: adminHeaders(token) }) as Promise<{
      revision: number;
      normal: { normal_manual: Record<string, number>; normal_llm: Record<string, number> };
      overall: { overall: Record<string, number>; breakdown: Record<string, Record<string, number>> };
    }>,
  adminGetOpsRecent: (token?: string, limit?: number) =>
    req(`/api/admin/ops/recent?limit=${limit ?? 50}`, { headers: adminHeaders(token) }) as Promise<{ events: Array<{ attempt_id: string; session_id: string; unit_id: string; phase: string; task: string; llm_mode: string | null; created_at: string }> }>,
  adminGetOpsSession: (sessionId: string, token?: string) =>
    req(`/api/admin/ops/session/${sessionId}`, { headers: adminHeaders(token) }),
  adminGetQwenMetrics: (token?: string) =>
    req("/api/admin/ops/qwen_metrics", { headers: adminHeaders(token) }) as Promise<{ qwen_calls_total: number; qwen_429_total: number; retries_total: number; avg_latency_ms: number }>,
  adminGetAuditConsistency: (token?: string) =>
    req("/api/admin/audit/consistency", { headers: adminHeaders(token) }) as Promise<{ ok: boolean; mismatches: string[]; normal_manual?: unknown; normal_llm?: unknown; custom_run_violations?: number }>,
  adminGetBehavior: (token?: string) =>
    req("/api/admin/behavior", { headers: adminHeaders(token) }),
  adminGetSessions: (token?: string) =>
    req("/api/admin/sessions", { headers: adminHeaders(token) }),
  adminGetSessionConfig: (token?: string) =>
    req("/api/admin/config/session", { headers: adminHeaders(token) }) as Promise<{ normal_n: number; active_m: number }>,
  adminSetSessionConfig: (config: { normal_n?: number; active_m?: number }, token?: string) =>
    req("/api/admin/config/session", {
      method: "POST",
      headers: adminHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify(config)
    }),
  adminSetTaxonomy: (labels: Array<{ label: string; description?: string }>, token?: string) =>
    req("/api/admin/taxonomy/set", {
      method: "POST",
      headers: adminHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ labels })
    }),
  adminSetPrompts: (prompt1: string, prompt2: string, token?: string) =>
    req("/api/admin/prompts/set", {
      method: "POST",
      headers: adminHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ prompt1, prompt2 })
    }),
  adminImportUnits: (units: Array<{ unit_id: string; text: string; meta_json?: string }>, token?: string) =>
    req("/api/admin/units/import", {
      method: "POST",
      headers: adminHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ units })
    }),
  adminRunAl: (
    candidate_k: number,
    active_m: number,
    params?: { top_h?: number; sample_n?: number; temperature?: number; seed?: number },
    token?: string
  ) =>
    req("/api/admin/al/run", {
      method: "POST",
      headers: adminHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ candidate_k, active_m, active_llm_n: active_m, ...params })
    }),
  adminGetAlStatus: (run_id: string, token?: string) =>
    req(`/api/admin/al/status?run_id=${encodeURIComponent(run_id)}`, {
      headers: adminHeaders(token)
    }),
  adminCreateShare: (token?: string) =>
    req("/api/admin/share/create", { method: "POST", headers: adminHeaders(token) }),
  /** Returns blob and optional X-Export-Meta (count, truncated, hint for pagination). */
  adminExport: async (format: "jsonl" | "csv", token?: string): Promise<{ blob: Blob; meta?: { count: number; truncated?: boolean; hint?: string } }> => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      const err: any = new Error("network offline");
      err.code = "NETWORK_OFFLINE";
      throw err;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EXPORT_TIMEOUT_MS);
    try {
      const r = await fetch(`${API_BASE}/api/admin/export?format=${format}`, {
        headers: adminHeaders(token),
        signal: controller.signal
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        const err: any = new Error((data as any)?.error ?? "Export failed");
        err.status = r.status;
        err.data = data;
        throw err;
      }
      const metaHeader = r.headers.get("X-Export-Meta");
      let meta: { count: number; truncated?: boolean; hint?: string } | undefined;
      if (metaHeader) {
        try {
          const parsed = JSON.parse(metaHeader) as { count?: number; truncated?: boolean; hint?: string };
          if (typeof parsed.count === "number") meta = { count: parsed.count, truncated: parsed.truncated, hint: parsed.hint };
        } catch { /* ignore */ }
      }
      return { blob: await r.blob(), meta };
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        const err: any = new Error("request timeout");
        err.code = "REQUEST_TIMEOUT";
        throw err;
      }
      throw e;
    } finally {
      clearTimeout(timeout);
    }
  },
  shareStats: (token: string) => req(`/api/share/stats?token=${encodeURIComponent(token)}`),
  reportClientError: (payload: { message: string; stack?: string; page?: string; extra?: unknown }) =>
    req("/api/client/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
};
