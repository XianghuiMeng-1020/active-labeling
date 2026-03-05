import type { Env, LlmMode } from "./types";
import { buildLlmInstruction, extractLabel } from "./utils";

type LlmResult = {
  predictedLabel: string;
  rawText: string;
  provider: "qwen";
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

export async function runLlm(
  env: Env,
  input: { text: string; prompt: string; taxonomy: string[]; requestId?: string }
): Promise<LlmResult> {
  const requestId = input.requestId ?? crypto.randomUUID();
  const system = buildLlmInstruction(input.taxonomy);
  const messages = [
    { role: "system", content: `${system}\n\nPrompt:\n${input.prompt}` },
    { role: "user", content: input.text }
  ];

  const result = await callQwenWithRetry(env, messages, requestId, 2);
  const rawText: string = result.data?.choices?.[0]?.message?.content ?? "";
  return {
    predictedLabel: extractLabel(rawText, input.taxonomy),
    rawText,
    provider: "qwen",
    model: result.data?.model ?? "qwen-plus",
    requestId
  };
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
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 8000);
    }
  }
  throw new Error("unreachable");
}

export async function pingLlm(env: Env, requestId: string): Promise<{
  provider: "qwen" | "none";
  status: number | string;
  errorDetail?: string;
}> {
  const messages = [{ role: "user", content: "Hello" }];
  try {
    const result = await callQwenWithRetry(env, messages, requestId, 2);
    return { provider: "qwen", status: result.status };
  } catch (error: any) {
    return {
      provider: "none",
      status: error.status ?? "error",
      errorDetail: error.message?.slice(0, 150)
    };
  }
}
