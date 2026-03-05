import type { AttemptPayload, Env } from "./types";

/** JSON response; CORS headers are added by Hono CORS middleware. */
export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });

export function nowIso() {
  return new Date().toISOString();
}

export function safeParseJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

export function extractLabel(rawText: string, taxonomy: string[]): string {
  const parsed = safeParseJson(rawText) as { label?: string } | null;
  if (parsed?.label && taxonomy.includes(parsed.label)) {
    return parsed.label;
  }
  // Match label after "LABEL :" — allow letters, digits, underscore, hyphen, spaces, and Unicode (e.g. Chinese)
  const regex = /LABEL\s*:\s*([\p{L}\p{N}_\-\s]+)/iu;
  const match = rawText.match(regex);
  if (match?.[1]) {
    const candidate = match[1].trim();
    if (taxonomy.includes(candidate)) return candidate;
  }
  return "UNKNOWN";
}

export function validateAttempt(attempt: AttemptPayload | null | undefined, env: Env): { isValid: number; reason: string | null } {
  if (attempt == null) return { isValid: 0, reason: "missing_attempt" };
  const minActiveMs = Number(env.MIN_ACTIVE_MS ?? 800);
  if (attempt.answered_at_epoch_ms < attempt.shown_at_epoch_ms) {
    return { isValid: 0, reason: "answered_before_shown" };
  }
  if (attempt.active_ms < minActiveMs) {
    return { isValid: 0, reason: "active_ms_too_low" };
  }
  const total = attempt.answered_at_epoch_ms - attempt.shown_at_epoch_ms;
  if (attempt.had_background === 1 && total > 0 && attempt.hidden_ms > total * 0.5) {
    return { isValid: 0, reason: "too_much_background_time" };
  }
  return { isValid: 1, reason: null };
}

export function buildLlmInstruction(taxonomy: string[]) {
  const labels = taxonomy.join(", ");
  return `You are a strict classifier. Return ONLY JSON like {"label":"<ONE_LABEL>"}.
Allowed labels: ${labels}
If uncertain, output {"label":"UNKNOWN"}.`;
}
