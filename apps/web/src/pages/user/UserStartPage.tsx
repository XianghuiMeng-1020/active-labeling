import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { EnvDebugPanel } from "../../components/EnvDebugPanel";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { getSessionId, getResetToken, setSessionId } from "../../lib/storage";

export function UserStartPage() {
  const nav = useNavigate();
  const { t } = useI18n();
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  const [currentSessionId, setCurrentSessionId] = useState(getSessionId());
  const [consent, setConsent] = useState(false);

  const start = async () => {
    setLoading(true);
    setMessage("");
    try {
      const data = await api.startSession({
        user_id: userId || undefined
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
      if (status.gates.can_enter_active_manual) {
        if (status.active_manual.done > 0) nav("/user/active/manual");
        else nav("/user/visualization");
      } else if (status.gates.can_enter_normal_llm) nav("/user/normal/llm");
      else nav("/user/normal/manual");
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
          <p style={{ marginTop: 6, fontSize: 13, opacity: 0.8 }}>{t("flow.path")}</p>
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

          <button className="btn primary full-width lg" disabled={loading || !consent} onClick={start}>
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
