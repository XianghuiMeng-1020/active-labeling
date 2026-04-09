const SESSION_KEY = "labeling_session_id";
const RESET_TOKEN_KEY = "labeling_reset_token";
const CONSENT_KEY = "labeling_consent";
const ADMIN_SESSION_KEY = "labeling_admin_session";
const ADMIN_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch { /* quota exceeded or security error */ }
}

function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch { /* ignore */ }
}

type AdminSession = {
  token: string;
  expiresAtEpochMs: number;
  lastActiveEpochMs: number;
};

export function getSessionId() {
  return safeGetItem(SESSION_KEY) ?? "";
}

export function setSessionId(sessionId: string, resetToken?: string) {
  safeSetItem(SESSION_KEY, sessionId);
  if (resetToken !== undefined) safeSetItem(RESET_TOKEN_KEY, resetToken);
}

export function getResetToken() {
  return safeGetItem(RESET_TOKEN_KEY) ?? "";
}

export function clearSessionId() {
  safeRemoveItem(SESSION_KEY);
  safeRemoveItem(RESET_TOKEN_KEY);
  safeRemoveItem(CONSENT_KEY);
}

export function getConsent(): boolean {
  return safeGetItem(CONSENT_KEY) !== "0";
}

export function setConsent(consent: boolean) {
  safeSetItem(CONSENT_KEY, consent ? "1" : "0");
}

function readAdminSession(): AdminSession | null {
  const raw = safeGetItem(ADMIN_SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AdminSession;
    if (!parsed?.token || !parsed?.expiresAtEpochMs || !parsed?.lastActiveEpochMs) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setAdminSession(token: string, expiresAtEpochMs: number) {
  const next: AdminSession = {
    token,
    expiresAtEpochMs,
    lastActiveEpochMs: Date.now()
  };
  safeSetItem(ADMIN_SESSION_KEY, JSON.stringify(next));
}

export function clearAdminSession() {
  safeRemoveItem(ADMIN_SESSION_KEY);
}

export function touchAdminSession() {
  const current = readAdminSession();
  if (!current) return;
  safeSetItem(
    ADMIN_SESSION_KEY,
    JSON.stringify({ ...current, lastActiveEpochMs: Date.now() })
  );
}

export function getAdminToken() {
  const session = readAdminSession();
  if (!session) return "";
  const now = Date.now();
  if (session.expiresAtEpochMs <= now) {
    clearAdminSession();
    return "";
  }
  if (now - session.lastActiveEpochMs > ADMIN_IDLE_TIMEOUT_MS) {
    clearAdminSession();
    return "";
  }
  touchAdminSession();
  return session.token;
}

export function getAdminSessionStatus() {
  const session = readAdminSession();
  if (!session) return { hasSession: false, isExpired: false, isIdleExpired: false };
  const now = Date.now();
  return {
    hasSession: true,
    isExpired: session.expiresAtEpochMs <= now,
    isIdleExpired: now - session.lastActiveEpochMs > ADMIN_IDLE_TIMEOUT_MS,
    expiresAtEpochMs: session.expiresAtEpochMs,
    lastActiveEpochMs: session.lastActiveEpochMs
  };
}

export const clearAdminToken = clearAdminSession;
