export type Phase = "normal" | "active";
export type Task = "manual" | "llm";
export type LlmMode = "prompt1" | "prompt2" | "custom";

export interface Env {
  DB: D1Database;
  STATS_HUB: DurableObjectNamespace;
  QWEN_LIMITER?: DurableObjectNamespace;
  QWEN_BASE_URL: string;
  QWEN_API_KEY: string;
  ADMIN_TOKEN: string;
  ADMIN_SESSION_TTL_SEC?: string;
  IDLE_THRESHOLD_MS?: string;
  MIN_ACTIVE_MS?: string;
  QWEN_MAX_CONCURRENT?: string;
  /** Comma-separated origins for CORS (e.g. https://app.example.com). If unset, allows "*". */
  ALLOWED_ORIGINS?: string;
}

export interface AttemptPayload {
  shown_at_epoch_ms: number;
  answered_at_epoch_ms: number;
  active_ms: number;
  hidden_ms: number;
  idle_ms: number;
  hidden_count: number;
  blur_count: number;
  had_background: number;
  events?: Array<{
    t_perf_ms: number;
    t_epoch_ms: number;
    type: string;
    payload_json?: string;
  }>;
}

export interface TaxonomyLabel {
  label: string;
  description?: string;
  ordering: number;
}
