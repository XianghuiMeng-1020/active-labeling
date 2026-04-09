import type { Env, LlmMode } from "./types";
import { buildLlmInstruction, extractLabel } from "./utils";

export type LlmProvider = "qwen" | "openai";

type LlmResult = {
  predictedLabel: string;
  rawText: string;
  provider: LlmProvider;
  model: string;
  requestId?: string;
};

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 25000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function logLlmCall(params: {
  requestId: string;
  route: string;
  status: number | string;
  retryCount?: number;
}) {
  console.log(
    `[LLM] ${params.requestId} ${params.route} status=${params.status} retry=${params.retryCount ?? 0}`
  );
}

function pickProvider(env: Env): LlmProvider {
  if (!env.OPENAI_API_KEY) return "qwen";
  const ratio = parseFloat(env.LLM_OPENAI_RATIO ?? "0");
  if (!Number.isFinite(ratio) || ratio <= 0) return "qwen";
  if (ratio >= 1) return "openai";
  return Math.random() < ratio ? "openai" : "qwen";
}

function otherProvider(p: LlmProvider): LlmProvider {
  return p === "openai" ? "qwen" : "openai";
}

function canFallback(env: Env, primary: LlmProvider): boolean {
  if (primary === "openai") return true; // always can fall back to qwen
  return !!env.OPENAI_API_KEY; // can fall back to openai only if key exists
}

// ─── Qwen ────────────────────────────────────────────────────────────────────

async function callQwen(
  env: Env,
  messages: Array<{ role: string; content: string }>,
  requestId: string
): Promise<{ data: any; status: number }> {
  const base = (env.QWEN_BASE_URL ?? "").replace(/\/$/, "");
  const resp = await fetchWithTimeout(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.QWEN_API_KEY}`
    },
    body: JSON.stringify({ model: "qwen-plus", messages, temperature: 0 })
  });

  logLlmCall({ requestId, route: "qwen", status: resp.status });

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => "");
    const err: any = new Error(`Qwen HTTP ${resp.status}: ${errorText.slice(0, 200)}`);
    err.status = resp.status;
    throw err;
  }
  return { data: await resp.json(), status: resp.status };
}

// ─── OpenAI GPT-4o-mini ──────────────────────────────────────────────────────

async function callOpenAI(
  env: Env,
  messages: Array<{ role: string; content: string }>,
  requestId: string
): Promise<{ data: any; status: number }> {
  const base = (env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const resp = await fetchWithTimeout(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({ model: "gpt-4o-mini", messages, temperature: 0 })
  });

  logLlmCall({ requestId, route: "openai", status: resp.status });

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => "");
    const err: any = new Error(`OpenAI HTTP ${resp.status}: ${errorText.slice(0, 200)}`);
    err.status = resp.status;
    throw err;
  }
  return { data: await resp.json(), status: resp.status };
}

// ─── Unified call with retry ─────────────────────────────────────────────────

async function callLlmProvider(
  env: Env,
  provider: LlmProvider,
  messages: Array<{ role: string; content: string }>,
  requestId: string
): Promise<{ data: any; status: number }> {
  return provider === "openai"
    ? callOpenAI(env, messages, requestId)
    : callQwen(env, messages, requestId);
}

export async function callQwenWithRetry(
  env: Env,
  messages: Array<{ role: string; content: string }>,
  requestId: string,
  maxAttempts = 5
): Promise<{ data: any; status: number; retryCount: number }> {
  let attempt = 1;
  let delay = 800;

  while (attempt <= maxAttempts) {
    try {
      const result = await callQwen(env, messages, requestId);
      logLlmCall({ requestId, route: "qwen_success", status: result.status, retryCount: attempt - 1 });
      return { ...result, retryCount: attempt - 1 };
    } catch (error: any) {
      const status: number = error?.status ?? 0;
      const shouldRetry =
        status === 429 ||
        status >= 500 ||
        status === 0 ||
        String(error?.message ?? "").toLowerCase().includes("timeout") ||
        String(error?.message ?? "").toLowerCase().includes("network");

      logLlmCall({
        requestId,
        route: shouldRetry ? "qwen_retryable_error" : "qwen_non_retryable_error",
        status: status || "error",
        retryCount: attempt - 1
      });

      if (!shouldRetry || attempt >= maxAttempts) {
        const err: any = new Error(
          `Qwen failed after ${attempt} attempt(s), status=${status || "unknown"}: ${error?.message ?? "unknown error"}`
        );
        err.status = status;
        err.retryCount = attempt - 1;
        throw err;
      }

      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 8000);
      attempt += 1;
    }
  }

  throw new Error("Unreachable");
}

async function callLlmWithRetry(
  env: Env,
  provider: LlmProvider,
  messages: Array<{ role: string; content: string }>,
  requestId: string,
  maxAttempts = 5
): Promise<{ data: any; status: number; retryCount: number; provider: LlmProvider }> {
  let attempt = 1;
  let delay = 800;

  while (attempt <= maxAttempts) {
    try {
      const result = await callLlmProvider(env, provider, messages, requestId);
      logLlmCall({ requestId, route: `${provider}_success`, status: result.status, retryCount: attempt - 1 });
      return { ...result, retryCount: attempt - 1, provider };
    } catch (error: any) {
      const status: number = error?.status ?? 0;
      const shouldRetry =
        status === 429 || status >= 500 || status === 0 ||
        String(error?.message ?? "").toLowerCase().includes("timeout") ||
        String(error?.message ?? "").toLowerCase().includes("network");

      logLlmCall({
        requestId,
        route: shouldRetry ? `${provider}_retryable_error` : `${provider}_non_retryable_error`,
        status: status || "error",
        retryCount: attempt - 1
      });

      if (!shouldRetry || attempt >= maxAttempts) {
        const err: any = new Error(
          `${provider} failed after ${attempt} attempt(s), status=${status || "unknown"}: ${error?.message ?? "unknown error"}`
        );
        err.status = status;
        err.retryCount = attempt - 1;
        throw err;
      }

      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 8000);
      attempt += 1;
    }
  }
  throw new Error("Unreachable");
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function runLlm(
  env: Env,
  input: { text: string; prompt: string; taxonomy: string[]; requestId?: string }
): Promise<LlmResult> {
  const requestId = input.requestId ?? crypto.randomUUID();
  const primary = pickProvider(env);
  const system = buildLlmInstruction(input.taxonomy);
  const messages = [
    { role: "system", content: `${system}\n\nPrompt:\n${input.prompt}` },
    { role: "user", content: input.text }
  ];

  try {
    const result = await callLlmWithRetry(env, primary, messages, requestId, 2);
    const rawText: string = result.data?.choices?.[0]?.message?.content ?? "";
    return {
      predictedLabel: extractLabel(rawText, input.taxonomy),
      rawText,
      provider: result.provider,
      model: result.data?.model ?? (primary === "openai" ? "gpt-4o-mini" : "qwen-plus"),
      requestId
    };
  } catch (primaryErr: any) {
    if (!canFallback(env, primary)) throw primaryErr;
    const fallback = otherProvider(primary);
    console.log(
      `[LLM] ${requestId} ${primary} failed (${primaryErr?.status ?? "unknown"}), falling back to ${fallback}`
    );
    const result = await callLlmWithRetry(env, fallback, messages, requestId, 2);
    const rawText: string = result.data?.choices?.[0]?.message?.content ?? "";
    return {
      predictedLabel: extractLabel(rawText, input.taxonomy),
      rawText,
      provider: result.provider,
      model: result.data?.model ?? (fallback === "openai" ? "gpt-4o-mini" : "qwen-plus"),
      requestId
    };
  }
}

export async function runLlmWithRetry(
  env: Env,
  input: { text: string; prompt: string; taxonomy: string[]; mode: LlmMode; requestId?: string },
  maxRetries = 2
): Promise<LlmResult> {
  const requestId = input.requestId ?? crypto.randomUUID();
  let attempt = 0;
  let delay = 1200;
  while (attempt <= maxRetries) {
    try {
      return await runLlm(env, { ...input, requestId });
    } catch (error) {
      attempt += 1;
      if (attempt > maxRetries) throw error;
      console.log(`[LLM] ${requestId} runLlmWithRetry attempt ${attempt}/${maxRetries} failed, retrying in ${delay}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 8000);
    }
  }
  throw new Error("unreachable");
}

export async function pingLlm(env: Env, requestId: string): Promise<{
  provider: LlmProvider | "none";
  status: number | string;
  errorDetail?: string;
  secondaryProvider?: LlmProvider | "none";
  secondaryStatus?: number | string;
  secondaryError?: string;
}> {
  const messages = [{ role: "user", content: "Hello" }];
  const results: any = {};

  try {
    const qwenResult = await callLlmWithRetry(env, "qwen", messages, requestId, 2);
    results.qwen = { status: qwenResult.status };
  } catch (error: any) {
    results.qwen = { status: error.status ?? "error", error: error.message?.slice(0, 150) };
  }

  if (env.OPENAI_API_KEY) {
    try {
      const openaiResult = await callLlmWithRetry(env, "openai", messages, requestId, 2);
      results.openai = { status: openaiResult.status };
    } catch (error: any) {
      results.openai = { status: error.status ?? "error", error: error.message?.slice(0, 150) };
    }
  }

  const primaryOk = results.qwen && !results.qwen.error;
  return {
    provider: primaryOk ? "qwen" : "none",
    status: results.qwen?.status ?? "error",
    errorDetail: results.qwen?.error,
    secondaryProvider: env.OPENAI_API_KEY ? (results.openai && !results.openai.error ? "openai" : "none") : undefined,
    secondaryStatus: results.openai?.status,
    secondaryError: results.openai?.error
  };
}

export async function getDifficultyFromLlm(
  env: Env,
  text: string,
  requestId?: string
): Promise<"Easy" | "Medium" | "Hard"> {
  const id = requestId ?? crypto.randomUUID();
  const primary = pickProvider(env);
  const messages = [
    {
      role: "system",
      content: "You rate how difficult it is for a human to assign a single theme label to a sentence. Reply with exactly one word: Easy, Medium, or Hard. Easy = obvious theme; Hard = ambiguous or needs context."
    },
    { role: "user", content: `Sentence to rate:\n\n${text.slice(0, 500)}` }
  ];

  const parseDifficulty = (raw: string): "Easy" | "Medium" | "Hard" => {
    const t = raw.trim().toLowerCase();
    if (t.includes("hard")) return "Hard";
    if (t.includes("medium")) return "Medium";
    if (t.includes("easy")) return "Easy";
    return "Medium";
  };

  try {
    const result = await callLlmWithRetry(env, primary, messages, id, 2);
    return parseDifficulty(result.data?.choices?.[0]?.message?.content ?? "");
  } catch (err: any) {
    if (!canFallback(env, primary)) throw err;
    const fallback = otherProvider(primary);
    console.log(`[LLM] ${id} getDifficulty ${primary} failed, falling back to ${fallback}`);
    const result = await callLlmWithRetry(env, fallback, messages, id, 2);
    return parseDifficulty(result.data?.choices?.[0]?.message?.content ?? "");
  }
}
