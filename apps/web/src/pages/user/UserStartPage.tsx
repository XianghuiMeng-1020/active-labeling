import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EnvDebugPanel } from "../../components/EnvDebugPanel";
import { api } from "../../lib/api";
import { ENABLE_ACTIVE_LEARNING } from "../../lib/featureFlags";
import { useI18n } from "../../lib/i18n";
import { getSessionId, getResetToken, setSessionId, setConsent as storeConsent } from "../../lib/storage";

type PhaseLocks = { lock_manual: boolean; lock_llm: boolean; lock_active: boolean; lock_survey: boolean };

export function UserStartPage() {
  const nav = useNavigate();
  const { t } = useI18n();
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  const [currentSessionId, setCurrentSessionId] = useState(getSessionId());
  const [consent, setConsent] = useState(true);
  const [locks, setLocks] = useState<PhaseLocks | null>(null);

  useEffect(() => {
    api.getPhaseLocks().then(setLocks).catch(() => {});
  }, []);

  const start = async () => {
    setLoading(true);
    setMessage("");
    try {
      storeConsent(consent);
      const data = await api.startSession({
        user_id: userId || undefined,
        has_consent: consent,
      }) as { session_id: string; reset_token?: string };
      setSessionId(data.session_id, data.reset_token);
      setCurrentSessionId(data.session_id);
      nav("/user/normal/manual");
    } catch (error: any) {
      setMessageKind("error");
      if (error?.code === "NETWORK_OFFLINE" || error?.code === "NETWORK_ERROR") {
        setMessage(t("common.networkError"));
      } else if (error?.code === "REQUEST_TIMEOUT") {
        setMessage(t("common.requestTimeout"));
      } else {
        setMessage(t("common.error"));
      }
    } finally {
      setLoading(false);
    }
  };

  const resumeSession = async () => {
    const sid = getSessionId();
    if (!sid) return;
    setLoading(true);
    try {
      const status = await api.getSessionStatus(sid);
      setCurrentSessionId(sid);
      if (status.locks) setLocks(status.locks);

      // Determine which page user should go to, then check if that phase is locked
      let target: string;
      if (status.gates.can_enter_active_manual) {
        if (ENABLE_ACTIVE_LEARNING && status.active_manual.done > 0) target = "/user/active/manual";
        else target = "/user/visualization";
      } else if (status.gates.can_enter_normal_llm) {
        target = "/user/normal/llm";
      } else {
        target = "/user/normal/manual";
      }

      // Check lock: only block if the target phase itself is locked
      if (status.locks) {
        if (target === "/user/normal/manual" && status.locks.lock_manual) {
          setMessageKind("error");
          setMessage(t("lock.taskLocked"));
          setLoading(false);
          return;
        }
        if (target === "/user/normal/llm" && status.locks.lock_llm) {
          setMessageKind("error");
          setMessage(t("lock.taskLocked"));
          setLoading(false);
          return;
        }
      }

      nav(target);
    } catch (error: any) {
      setMessageKind("error");
      if (error?.code === "NETWORK_OFFLINE" || error?.code === "NETWORK_ERROR") {
        setMessage(t("common.networkError"));
      } else if (error?.code === "REQUEST_TIMEOUT") {
        setMessage(t("common.requestTimeout"));
      } else {
        setMessage(t("flow.resumeFailed"));
      }
    } finally {
      setLoading(false);
    }
  };

  const resetCurrentSession = async () => {
    if (!currentSessionId) return;
    setResetting(true);
    setMessage("");
    try {
      await api.resetSession({ session_id: currentSessionId, reset_token: getResetToken() });
      setMessageKind("success");
      setMessage(t("flow.resetDone"));
    } catch (e: any) {
      setMessageKind("error");
      if (e?.status === 400 && e?.data?.error === "reset_token required") setMessage(t("flow.resetTokenRequired"));
      else setMessage(t("flow.resetFailed"));
    } finally {
      setResetting(false);
    }
  };

  return (
    <>
      <EnvDebugPanel />
      <div className="page">
        <div className="hero-banner">
          <h1>{t("flow.userTitle")}</h1>
          <p>{t("flow.sentenceGuide")}</p>
          <p style={{ marginTop: 6, fontSize: 13, opacity: 0.8 }}>{t(ENABLE_ACTIVE_LEARNING ? "flow.path" : "flow.pathNoAL")}</p>
        </div>

        <div className="card">
          {currentSessionId ? (
            <div style={{ marginBottom: 12, fontSize: 12, color: "var(--color-text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--color-success)", display: "inline-block" }} />
              {t("flow.currentSession")}: {currentSessionId.slice(0, 8)}
            </div>
          ) : null}

          <div className="form-group">
            <label>{t("flow.userId")}</label>
            <input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder={t("flow.userIdPlaceholder")} />
          </div>

          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, margin: "12px 0 16px", cursor: "pointer", fontSize: 13, lineHeight: 1.5, color: "var(--color-text-secondary)" }}>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              style={{ marginTop: 3, accentColor: "var(--color-primary)", width: 16, height: 16, flexShrink: 0 }}
            />
            <span>I consent to my labels/annotations from this workshop's labeling system being collected and used for research/teaching, with results reported anonymously or in aggregate where possible.</span>
          </label>

          {locks && (
            <div style={{ margin: "0 0 16px", padding: "12px 14px", borderRadius: 10, border: "1px solid var(--color-border)", background: "var(--color-bg-secondary)" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {t("lock.title")}
              </div>
              {([
                { label: t("lock.task1"), locked: locks.lock_manual },
                { label: t("lock.task2"), locked: locks.lock_llm },
                ...(ENABLE_ACTIVE_LEARNING ? [{ label: t("lock.task3"), locked: locks.lock_active }] : []),
                { label: t("lock.task4"), locked: locks.lock_survey },
              ]).map(({ label, locked }, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "6px 0",
                  borderTop: i > 0 ? "1px solid var(--color-border)" : undefined
                }}>
                  <span style={{ fontSize: 16 }}>{locked ? "🔒" : "✅"}</span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{label}</span>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 4,
                    background: locked ? "rgba(239,68,68,0.1)" : "rgba(16,185,129,0.1)",
                    color: locked ? "#dc2626" : "#059669"
                  }}>
                    {locked ? t("lock.locked") : t("lock.unlocked")}
                  </span>
                </div>
              ))}
            </div>
          )}

          <button className="btn primary full-width lg" disabled={loading || (locks?.lock_manual ?? false)} onClick={start}>
            {loading ? <span className="spinner" /> : t("flow.startLabeling")}
          </button>

          {currentSessionId ? (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="btn full-width" disabled={loading} onClick={resumeSession}>
                {t("flow.resumeSession")}
              </button>
              <button className="btn full-width" disabled={resetting} onClick={resetCurrentSession}>
                {resetting ? <span className="spinner" /> : t("flow.resetCurrentSession")}
              </button>
            </div>
          ) : null}

          {message ? (
            <div className={messageKind === "error" ? "error-box" : "success-box"} style={{ marginTop: 10 }}>{message}</div>
          ) : null}
        </div>
      </div>
    </>
  );
}
