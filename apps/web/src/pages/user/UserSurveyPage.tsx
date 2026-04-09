import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../../lib/i18n";
import { ENABLE_ACTIVE_LEARNING } from "../../lib/featureFlags";
import { api } from "../../lib/api";
import { getSessionId, getConsent } from "../../lib/storage";

type LikertValue = 1 | 2 | 3 | 4 | 5 | null;

const LIKERT_OPTIONS = [1, 2, 3, 4, 5] as const;

const LIKERT_QUESTIONS = ENABLE_ACTIVE_LEARNING
  ? (["survey.q1", "survey.q2", "survey.q4", "survey.q5", "survey.q6", "survey.q7", "survey.q9", "survey.q10"] as const)
  : (["survey.q1", "survey.q2", "survey.q4", "survey.q7", "survey.q10"] as const);

const LIKERT_SECTIONS: { titleKey: string; questions: readonly string[] }[] = ENABLE_ACTIVE_LEARNING
  ? [
      { titleKey: "survey.sectionA", questions: ["survey.q1", "survey.q2", "survey.q4", "survey.q5", "survey.q6"] },
      { titleKey: "survey.sectionB", questions: ["survey.q7", "survey.q9", "survey.q10"] },
    ]
  : [
      { titleKey: "survey.sectionA", questions: ["survey.q1", "survey.q2", "survey.q4"] },
      { titleKey: "survey.sectionB", questions: ["survey.q7", "survey.q10"] },
    ];

const MC_OPTIONS = ["survey.mc_a", "survey.mc_b", "survey.mc_c", "survey.mc_d"] as const;

const OPEN_QUESTIONS = ENABLE_ACTIVE_LEARNING
  ? ["survey.q12", "survey.q13", "survey.q14"]
  : ["survey.q12", "survey.q14"];

export function UserSurveyPage() {
  const { t } = useI18n();
  const nav = useNavigate();
  const sessionId = getSessionId();
  const [phaseLocked, setPhaseLocked] = useState(false);
  const [lockChecked, setLockChecked] = useState(false);

  useEffect(() => {
    if (!sessionId) { nav("/user/start"); return; }
    api.getPhaseLocks().then((locks) => {
      setPhaseLocked(locks.lock_survey);
      setLockChecked(true);
    }).catch(() => setLockChecked(true));
  }, [sessionId, nav]);

  const [likert, setLikert] = useState<Record<string, LikertValue>>(
    () => Object.fromEntries(LIKERT_QUESTIONS.map((q) => [q, null]))
  );
  const [mcAnswer, setMcAnswer] = useState<string | null>(null);
  const [open12, setOpen12] = useState("");
  const [open13, setOpen13] = useState("");
  const [open14, setOpen14] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const allLikertAnswered = LIKERT_QUESTIONS.every((q) => likert[q] !== null);
  const canSubmit = allLikertAnswered && (ENABLE_ACTIVE_LEARNING ? mcAnswer !== null : true);

  const openState: Record<string, [string, (v: string) => void]> = {
    "survey.q12": [open12, setOpen12],
    "survey.q13": [open13, setOpen13],
    "survey.q14": [open14, setOpen14],
  };

  const handleSubmit = async () => {
    if (!sessionId || !canSubmit || submitting) return;
    setSubmitting(true);
    try {
      if (getConsent()) {
        await api.submitSurvey({
          session_id: sessionId ?? "",
          likert: Object.fromEntries(
            LIKERT_QUESTIONS.map((q) => [q, likert[q]!])
          ),
          mc_q11: mcAnswer ?? "",
          open_q12: open12.trim(),
          open_q13: open13.trim(),
          open_q14: open14.trim(),
        });
      }
      setSubmitted(true);
    } catch {
      alert(t("common.error"));
    } finally {
      setSubmitting(false);
    }
  };

  if (!sessionId) return null;

  if (!lockChecked) {
    return (
      <div className="page">
        <div className="card"><div className="skeleton skeleton-text wide" /></div>
      </div>
    );
  }

  if (phaseLocked) {
    return (
      <div className="page" style={{ justifyContent: "center" }}>
        <div className="card" style={{ textAlign: "center", padding: "48px 24px" }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>🔒</div>
          <h2>{t("lock.taskLocked")}</h2>
          <p style={{ color: "var(--color-text-muted)", margin: "12px 0 24px" }}>{t("lock.taskLockedDesc")}</p>
          <button className="btn primary" onClick={() => window.location.reload()}>{t("lock.refresh")}</button>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="page" style={{ justifyContent: "center", minHeight: "100dvh" }}>
        <div className="welcome-card" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-success)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
            {t("survey.complete")}
          </div>
          <h2>{t("survey.thankYou")}</h2>
          <p style={{ color: "var(--color-text-muted)", marginTop: 8 }}>{t("survey.thankYouDesc")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="hero-banner">
        <h1>{t("survey.title")}</h1>
        <p>{t("survey.subtitle")}</p>
      </div>

      <div className="card survey-scale-legend">
        <div className="survey-scale-row">
          {LIKERT_OPTIONS.map((v) => (
            <div key={v} className="survey-scale-item">
              <span className="survey-scale-num">{v}</span>
              <span className="survey-scale-label">{t(`survey.scale_${v}`)}</span>
            </div>
          ))}
        </div>
      </div>

      {LIKERT_SECTIONS.map((section) => (
        <div className="card" key={section.titleKey}>
          <h3 className="survey-section-title">{t(section.titleKey)}</h3>
          {section.questions.map((qKey, qIdx) => (
            <div className="survey-question" key={qKey}>
              <p className="survey-question-text">
                <span className="survey-question-num">{qIdx + 1}.</span>
                {t(qKey)}
              </p>
              <div className="survey-likert-group">
                {LIKERT_OPTIONS.map((v) => (
                  <label key={v} className={`survey-likert-option ${likert[qKey] === v ? "selected" : ""}`}>
                    <input
                      type="radio"
                      name={qKey}
                      value={v}
                      checked={likert[qKey] === v}
                      onChange={() => setLikert((prev) => ({ ...prev, [qKey]: v }))}
                    />
                    <span className="survey-likert-circle">{v}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}

      {ENABLE_ACTIVE_LEARNING && (
        <div className="card">
          <h3 className="survey-section-title">{t("survey.sectionC")}</h3>
          <div className="survey-question">
            <p className="survey-question-text">
              <span className="survey-question-num">1.</span>
              {t("survey.q11")}
            </p>
            <div className="survey-mc-group">
              {MC_OPTIONS.map((optKey) => (
                <label key={optKey} className={`survey-mc-option ${mcAnswer === optKey ? "selected" : ""}`}>
                  <input
                    type="radio"
                    name="mc_q11"
                    value={optKey}
                    checked={mcAnswer === optKey}
                    onChange={() => setMcAnswer(optKey)}
                  />
                  <span className="survey-mc-indicator" />
                  <span>{t(optKey)}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <h3 className="survey-section-title">{t("survey.sectionD")}</h3>
        {OPEN_QUESTIONS.map((qKey, qIdx) => {
          const [value, setValue] = openState[qKey];
          return (
            <div className="survey-question" key={qKey}>
              <p className="survey-question-text">
                <span className="survey-question-num">{qIdx + 1}.</span>
                {t(qKey)}
              </p>
              <textarea
                className="survey-textarea"
                rows={3}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={t("survey.openPlaceholder")}
              />
            </div>
          );
        })}
      </div>

      <button
        className="btn primary full-width lg"
        style={{ marginTop: 8, marginBottom: 32 }}
        onClick={handleSubmit}
        disabled={!canSubmit || submitting || !sessionId}
      >
        {submitting ? (
          <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
        ) : (
          <>{t("survey.submit")} →</>
        )}
      </button>
    </div>
  );
}
