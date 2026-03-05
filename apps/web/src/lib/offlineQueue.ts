import { api, type AttemptPayload, type LlmMode, type Phase } from "./api";

type ManualQueueEntry = {
  kind: "manual";
  payload: {
    session_id: string;
    unit_id: string;
    phase: Phase;
    label: string;
    attempt: AttemptPayload;
    idempotency_key: string;
  };
};

type LlmQueueEntry = {
  kind: "llm_accept";
  payload: {
    session_id: string;
    unit_id: string;
    phase: "normal";
    mode: LlmMode;
    accepted_label: string;
    attempt: AttemptPayload;
    idempotency_key: string;
  };
};

type QueueEntry = ManualQueueEntry | LlmQueueEntry;
const OFFLINE_QUEUE_KEY = "labeling_offline_queue_v1";
const DEAD_LETTER_KEY = "labeling_offline_dead_letter_v1";

function readQueue(): QueueEntry[] {
  if (typeof localStorage === "undefined") return [];
  const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? (data as QueueEntry[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(entries: QueueEntry[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(entries));
  } catch {
    console.error("Failed to write offline queue (storage full?)");
  }
}

export type DeadLetterEntry = { at: string; kind: string; error?: string };
function readDeadLetter(): DeadLetterEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(DEAD_LETTER_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? (data as DeadLetterEntry[]) : [];
  } catch {
    return [];
  }
}
function appendDeadLetter(entry: DeadLetterEntry) {
  if (typeof localStorage === "undefined") return;
  try {
    const list = readDeadLetter();
    list.push(entry);
    localStorage.setItem(DEAD_LETTER_KEY, JSON.stringify(list.slice(-100)));
  } catch { /* storage full */ }
  if (typeof window !== "undefined") window.dispatchEvent(new Event("deadLetterChange"));
}
export function getDeadLetterCount(): number {
  return readDeadLetter().length;
}
export function clearDeadLetter(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(DEAD_LETTER_KEY);
}

function makeIdempotencyKey() {
  return `offline-${crypto.randomUUID()}`;
}

const MAX_QUEUE_SIZE = 200;

export function enqueueManualSubmission(payload: {
  session_id: string;
  unit_id: string;
  phase: Phase;
  label: string;
  attempt: AttemptPayload;
}) {
  const entries = readQueue();
  const dup = entries.some(
    (e) => e.kind === "manual" && e.payload.unit_id === payload.unit_id && e.payload.session_id === payload.session_id && e.payload.phase === payload.phase
  );
  if (dup || entries.length >= MAX_QUEUE_SIZE) return;
  entries.push({
    kind: "manual",
    payload: { ...payload, idempotency_key: makeIdempotencyKey() }
  });
  writeQueue(entries);
}

export function enqueueLlmAccept(payload: {
  session_id: string;
  unit_id: string;
  phase: "normal";
  mode: LlmMode;
  accepted_label: string;
  attempt: AttemptPayload;
}) {
  const entries = readQueue();
  const dup = entries.some(
    (e) => e.kind === "llm_accept" && e.payload.unit_id === payload.unit_id && e.payload.session_id === payload.session_id
  );
  if (dup || entries.length >= MAX_QUEUE_SIZE) return;
  entries.push({
    kind: "llm_accept",
    payload: { ...payload, idempotency_key: makeIdempotencyKey() }
  });
  writeQueue(entries);
}

const LOCK_KEY = "labeling_offline_flush_lock";
const LOCK_TTL_MS = 30_000;

function tryAcquireLock(): boolean {
  if (typeof localStorage === "undefined") return true;
  const now = Date.now();
  const raw = localStorage.getItem(LOCK_KEY);
  if (raw) {
    const t = parseInt(raw, 10);
    if (!Number.isNaN(t) && now - t < LOCK_TTL_MS) return false;
  }
  localStorage.setItem(LOCK_KEY, String(now));
  return true;
}

function releaseLock() {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(LOCK_KEY);
}

function isRetryableError(error: any): boolean {
  if (error?.code === "NETWORK_OFFLINE" || error?.code === "NETWORK_ERROR" || error?.code === "REQUEST_TIMEOUT")
    return true;
  const status = error?.status;
  if (status === 429) return true;
  if (typeof status === "number" && status >= 500 && status < 600) return true;
  return false;
}

export async function flushOfflineQueue() {
  if (!tryAcquireLock()) return { synced: 0, pending: readQueue().length };
  try {
    const entries = readQueue();
    if (!entries.length) return { synced: 0, pending: 0 };
    const remain: QueueEntry[] = [];
    let synced = 0;
    for (const item of entries) {
      try {
        if (item.kind === "manual") {
          await api.submitManual(item.payload);
        } else {
          await api.acceptLlm(item.payload);
        }
        synced += 1;
      } catch (error: any) {
        if (isRetryableError(error)) {
          remain.push(item);
        } else {
          appendDeadLetter({
            at: new Date().toISOString(),
            kind: item.kind,
            error: error?.message ?? String(error?.status ?? "unknown")
          });
        }
      }
    }
    writeQueue(remain);
    return { synced, pending: remain.length };
  } finally {
    releaseLock();
  }
}

