const SESSION_KEY = "labeling_session_id";
const RESET_TOKEN_KEY = "labeling_reset_token";
const ADMIN_SESSION_KEY = "labeling_admin_session";
const ADMIN_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

type AdminSession = {
  token: string;
  expiresAtEpochMs: number;
  lastActiveEpochMs: number;
};

export function getSessionId() {
  return localStorage.getItem(SESSION_KEY) ?? "";
}

export function setSessionId(sessionId: string, resetToken?: string) {
  localStorage.setItem(SESSION_KEY, sessionId);
  if (resetToken !== undefined) localStorage.setItem(RESET_TOKEN_KEY, resetToken);
}

export function getResetToken() {
  return localStorage.getItem(RESET_TOKEN_KEY) ?? "";
}

export function clearSessionId() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(RESET_TOKEN_KEY);
}

function readAdminSession(): AdminSession | null {
  const raw = localStorage.getItem(ADMIN_SESSION_KEY);
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
  localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(next));
}

export function clearAdminSession() {
  localStorage.removeItem(ADMIN_SESSION_KEY);
}

export function touchAdminSession() {
  const current = readAdminSession();
  if (!current) return;
  localStorage.setItem(
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
