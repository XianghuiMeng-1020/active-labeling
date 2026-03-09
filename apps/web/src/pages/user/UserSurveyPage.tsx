import { useState } from "react";
import { useI18n } from "../../lib/i18n";
import { api } from "../../lib/api";
import { getSessionId } from "../../lib/storage";

type LikertValue = 1 | 2 | 3 | 4 | 5 | null;

const LIKERT_OPTIONS = [1, 2, 3, 4, 5] as const;

const LIKERT_QUESTIONS = [
  "survey.q1",
  "survey.q2",
  "survey.q4",
  "survey.q5",
  "survey.q6",
  "survey.q7",
  "survey.q9",
  "survey.q10",
] as const;

const LIKERT_SECTIONS: { titleKey: string; questions: readonly string[] }[] = [
  {
    titleKey: "survey.sectionA",
    questions: ["survey.q1", "survey.q2", "survey.q4", "survey.q5", "survey.q6"],
  },
  {
    titleKey: "survey.sectionB",
    questions: ["survey.q7", "survey.q9", "survey.q10"],
  },
];

const MC_OPTIONS = ["survey.mc_a", "survey.mc_b", "survey.mc_c", "survey.mc_d"] as const;

export function UserSurveyPage() {
  const { t } = useI18n();
  const sessionId = getSessionId();

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
  const canSubmit = allLikertAnswered && mcAnswer !== null;

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      await api.submitSurvey({
        session_id: sessionId ?? "",
        likert: Object.fromEntries(
          LIKERT_QUESTIONS.map((q) => [q, likert[q]!])
        ),
        mc_q11: mcAnswer!,
        open_q12: open12.trim(),
        open_q13: open13.trim(),
        open_q14: open14.trim(),
      });
      setSubmitted(true);
    } catch {
      alert(t("common.error"));
    } finally {
      setSubmitting(false);
    }
  };

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

      <div className="card">
        <h3 className="survey-section-title">{t("survey.sectionC")}</h3>
        <div className="survey-question">
          <p className="survey-question-text">
            <span className="survey-question-num">11.</span>
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

      <div className="card">
        <h3 className="survey-section-title">{t("survey.sectionD")}</h3>

        <div className="survey-question">
          <p className="survey-question-text">
            <span className="survey-question-num">12.</span>
            {t("survey.q12")}
          </p>
          <textarea
            className="survey-textarea"
            rows={3}
            value={open12}
            onChange={(e) => setOpen12(e.target.value)}
            placeholder={t("survey.openPlaceholder")}
          />
        </div>

        <div className="survey-question">
          <p className="survey-question-text">
            <span className="survey-question-num">13.</span>
            {t("survey.q13")}
          </p>
          <textarea
            className="survey-textarea"
            rows={3}
            value={open13}
            onChange={(e) => setOpen13(e.target.value)}
            placeholder={t("survey.openPlaceholder")}
          />
        </div>

        <div className="survey-question">
          <p className="survey-question-text">
            <span className="survey-question-num">14.</span>
            {t("survey.q14")}
          </p>
          <textarea
            className="survey-textarea"
            rows={3}
            value={open14}
            onChange={(e) => setOpen14(e.target.value)}
            placeholder={t("survey.openPlaceholder")}
          />
        </div>
      </div>

      <button
        className="btn primary full-width lg"
        style={{ marginTop: 8, marginBottom: 32 }}
        onClick={handleSubmit}
        disabled={!canSubmit || submitting}
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
