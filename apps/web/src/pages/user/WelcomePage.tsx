import { useNavigate } from "react-router-dom";
import { useI18n } from "../../lib/i18n";
import { ENABLE_ACTIVE_LEARNING } from "../../lib/featureFlags";

export function WelcomePage() {
  const nav = useNavigate();
  const { t } = useI18n();

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

        <button
          className="btn primary full-width lg"
          onClick={() => nav("/user/start")}
          style={{ marginTop: 8 }}
        >
          {t("welcome.letsGo")} →
        </button>
      </div>
    </div>
  );
}
