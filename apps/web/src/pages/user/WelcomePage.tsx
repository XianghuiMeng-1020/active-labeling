import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../../lib/i18n";
import { ENABLE_ACTIVE_LEARNING } from "../../lib/featureFlags";
import { getSessionId } from "../../lib/storage";

export function WelcomePage() {
  const nav = useNavigate();
  const { t } = useI18n();
  const [hasExistingSession, setHasExistingSession] = useState(false);

  useEffect(() => {
    setHasExistingSession(Boolean(getSessionId()));
  }, []);

  return (
    <div className="page" style={{ justifyContent: "center", minHeight: "100dvh" }}>
      <div className="welcome-card">
        <div className="welcome-icon">🏷️</div>
        <h1 className="welcome-title">{t("welcome.title")}</h1>
        <p className="welcome-subtitle">{t(ENABLE_ACTIVE_LEARNING ? "welcome.subtitle" : "welcome.subtitleNoAL")}</p>

        <div className="welcome-steps">
          <div className="welcome-step">
            <span className="welcome-step-num">1</span>
            <span>{t("welcome.step1")}</span>
          </div>
          <div className="welcome-step">
            <span className="welcome-step-num">2</span>
            <span>{t("welcome.step2")}</span>
          </div>
          {ENABLE_ACTIVE_LEARNING && (
            <div className="welcome-step">
              <span className="welcome-step-num">3</span>
              <span>{t("welcome.step3")}</span>
            </div>
          )}
        </div>

        <p className="welcome-note">{t("welcome.note")}</p>

        {hasExistingSession ? (
          <>
            <div
              style={{
                marginTop: 12,
                padding: "10px 12px",
                background: "rgba(99,102,241,0.08)",
                border: "1px solid rgba(99,102,241,0.3)",
                borderRadius: 8,
                fontSize: 13,
                color: "var(--color-text-secondary)",
                display: "flex",
                alignItems: "center",
                gap: 8
              }}
            >
              <span style={{ fontSize: 16 }}>↩</span>
              <span style={{ flex: 1 }}>{t("welcome.resumeAvailable")}</span>
            </div>
            <button
              className="btn primary full-width lg"
              onClick={() => nav("/user/start", { state: { autoResume: true } })}
              style={{ marginTop: 10 }}
            >
              {t("welcome.continuePrev")} →
            </button>
            <button
              className="btn full-width"
              onClick={() => nav("/user/start")}
              style={{ marginTop: 8 }}
            >
              {t("welcome.startNew")}
            </button>
          </>
        ) : (
          <button
            className="btn primary full-width lg"
            onClick={() => nav("/user/start")}
            style={{ marginTop: 8 }}
          >
            {t("welcome.letsGo")} →
          </button>
        )}
      </div>
    </div>
  );
}
