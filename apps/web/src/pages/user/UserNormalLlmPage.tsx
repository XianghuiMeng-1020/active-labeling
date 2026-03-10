import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAttemptTracker } from "../../hooks/useAttemptTracker";
import { api, type LlmMode } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { DeadLetterBanner } from "../../components/DeadLetterBanner";
import { EssayDisplay } from "../../components/EssayDisplay";
import { ProgressRing } from "../../components/ProgressRing";
import { ToastContainer, useToast } from "../../components/Toast";
import { enqueueLlmAccept, flushOfflineQueue } from "../../lib/offlineQueue";
import { getSessionId } from "../../lib/storage";
import { getEssaySentenceMeta } from "../../lib/unitUtils";
import { getEssayByUnitId } from "../../lib/essayData";

const CUSTOM_MAX = 5;
const LLM_ATTEMPTS_PER_UNIT = 2;

function OverrideSheet({
  labels,
  onSelect,
  onClose,
  title
}: {
  labels: Array<{ label: string }>;
  onSelect: (l: string) => void;
  onClose: () => void;
  title: string;
}) {
  const { labelText } = useI18n();
  return (
    <>
      <div className="bottom-sheet-overlay" onClick={onClose} />
      <div className="bottom-sheet">
        <div className="bottom-sheet-handle" />
        <div className="bottom-sheet-title">{title}</div>
        <div className="label-grid">
          {labels.map((l) => (
            <button key={l.label} className="label-btn" onClick={() => onSelect(l.label)}>
              {labelText(l.label)}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function LlmSkeleton({ elapsed, label }: { elapsed: number; label: string }) {
  return (
    <div style={{ padding: "4px 0" }}>
      <div className="skeleton skeleton-text wide" />
      <div className="skeleton skeleton-text medium" style={{ marginTop: 8 }} />
      <div className="skeleton skeleton-badge" style={{ marginTop: 12 }} />
      <div style={{ marginTop: 8, fontSize: 12, color: "var(--color-text-muted)" }}>
        {label} {elapsed}s
      </div>
    </div>
  );
}

export function UserNormalLlmPage() {
  const nav = useNavigate();
  const location = useLocation();
  const { t, labelText } = useI18n();
  const sessionId = getSessionId();
  const lastRankedEssayIndex = (location.state as { lastRankedEssayIndex?: number } | null)?.lastRankedEssayIndex;

  const [labels, setLabels] = useState<Array<{ label: string }>>([]);
  const [prompt1Text, setPrompt1Text] = useState("");
  const [prompt2Text, setPrompt2Text] = useState("");
  const [customPrompt, setCustomPrompt] = useState(t("flow.customPromptDefault"));
  const [unit, setUnit] = useState<{ unit_id: string; text: string } | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [predicted, setPredicted] = useState("");
  const [activeMode, setActiveMode] = useState<LlmMode>("prompt1");
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmElapsed, setLlmElapsed] = useState(0);
  const [done, setDone] = useState(false);
  const [customAttemptsUsed, setCustomAttemptsUsed] = useState(0);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [showOverride, setShowOverride] = useState(false);
  const [showPromptPreview, setShowPromptPreview] = useState<null | "prompt1" | "prompt2">(null);
  const [accepting, setAccepting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runsThisUnit, setRunsThisUnit] = useState(0);
  const [acceptedLabel, setAcceptedLabel] = useState<string | null>(null);
  const [undoRankingInProgress, setUndoRankingInProgress] = useState(false);
  const [llmLabelsByUnitId, setLlmLabelsByUnitId] = useState<Record<string, string>>({});
  const [essaySentences, setEssaySentences] = useState<Array<{ unit_id: string; text: string; manual_label: string; llm_label: string | null }>>([]);
  const [runEssayLoading, setRunEssayLoading] = useState(false);
  const [overrideUnitId, setOverrideUnitId] = useState<string | null>(null);

  const { toasts, showToast } = useToast();
  const tracker = useAttemptTracker(unit?.unit_id ?? "empty");
  const elapsedTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const acceptingRef = useRef(false);

  const unitMeta = useMemo(() => (unit ? getEssaySentenceMeta(unit.unit_id) : null), [unit]);
  const currentEssay = useMemo(() => (unit ? getEssayByUnitId(unit.unit_id) : null), [unit]);

  const essayIndexForLlmLabels = currentEssay?.essayIndex ?? null;
  useEffect(() => {
    if (!sessionId || essayIndexForLlmLabels == null) {
      setLlmLabelsByUnitId({});
      setEssaySentences([]);
      return;
    }
    let cancelled = false;
    api.getEssayLabels(sessionId, essayIndexForLlmLabels).then((res) => {
      if (cancelled) return;
      const map: Record<string, string> = {};
      for (const s of res.sentences) {
        if (s.llm_label) map[s.unit_id] = s.llm_label;
      }
      setLlmLabelsByUnitId(map);
      setEssaySentences(res.sentences);
    }).catch(() => {
      if (!cancelled) {
        setLlmLabelsByUnitId({});
        setEssaySentences([]);
      }
    });
    return () => { cancelled = true; };
  }, [sessionId, essayIndexForLlmLabels]);

  const essayDisplayLlmLabels = useMemo(() => {
    const base = { ...llmLabelsByUnitId };
    if (unit && (acceptedLabel || predicted)) {
      base[unit.unit_id] = acceptedLabel ?? predicted;
    }
    return base;
  }, [llmLabelsByUnitId, unit?.unit_id, acceptedLabel, predicted]);

  useEffect(() => {
    return () => {
      if (elapsedTimer.current) clearInterval(elapsedTimer.current);
    };
  }, []);

  const customExhausted = customAttemptsUsed >= CUSTOM_MAX;

  const load = useCallback(async () => {
    if (!sessionId) { nav("/user/start"); return; }
    setLoadError(null);
    try {
      const status = await api.getSessionStatus(sessionId);
      if (!status.gates.can_enter_normal_llm) { nav("/user/normal/manual"); return; }
      const prog = status.normal_llm;
      setProgress({ done: prog?.done ?? 0, total: prog?.total ?? 0 });

      const needsStaticData = labels.length === 0;
      const [tax, prompts, next] = await Promise.all([
        needsStaticData ? api.getTaxonomy() : { labels },
        needsStaticData ? api.getPrompts() : { prompt1: prompt1Text, prompt2: prompt2Text },
        api.getNextUnit(sessionId, "normal", "llm")
      ]);
      const HIDDEN = new Set(["CODE", "UNKNOWN"]);
      if (tax.labels.length > 0) setLabels(tax.labels.filter((l: { label: string }) => !HIDDEN.has(l.label)));
      if (prompts.prompt1) setPrompt1Text(prompts.prompt1);
      if (prompts.prompt2) setPrompt2Text(prompts.prompt2);
      setUnit(next.unit);
      setPredicted("");
      setLlmError(null);
      setCustomAttemptsUsed(0);
      setShowOverride(false);
      setRunsThisUnit(0);
      setAcceptedLabel(null);

      if (next.unit) {
        try {
          const cnt = await api.getCustomCount(sessionId, next.unit.unit_id, "normal");
          setCustomAttemptsUsed(cnt.count);
        } catch { /* ignore */ }
      }
      if (!next.unit) setDone(true);
    } catch (err: any) {
      console.error("LLM load() failed:", err);
      setLoadError(err?.message ?? "Loading failed");
    }
  }, [sessionId, nav]);

  useEffect(() => {
    flushOfflineQueue().catch(() => undefined);
    load();
  }, [load]);
  useEffect(() => {
    const onOnline = () => { flushOfflineQueue().catch(() => undefined); };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  const startLlmTimer = () => {
    setLlmElapsed(0);
    elapsedTimer.current = setInterval(() => setLlmElapsed((e) => e + 1), 1000);
  };
  const stopLlmTimer = () => {
    if (elapsedTimer.current) { clearInterval(elapsedTimer.current); elapsedTimer.current = null; }
  };

  const runLlm = async (m: LlmMode) => {
    if (!unit) return;
    if (m === "custom" && customExhausted) return;
    setActiveMode(m);
    setLlmLoading(true);
    setLlmError(null);
    setPredicted("");
    startLlmTimer();
    try {
      const data: any = await api.runLlm({
        session_id: sessionId,
        unit_id: unit.unit_id,
        phase: "normal",
        mode: m,
        custom_prompt_text: m === "custom" ? customPrompt : undefined
      });
      setPredicted(data.predicted_label ?? "");
      setRunsThisUnit((prev) => prev + 1);
      if (m === "custom" && data.custom_attempts_used !== undefined) {
        setCustomAttemptsUsed(data.custom_attempts_used);
      }
      showToast(`✓ ${t("flow.modelReturned")}: ${data.predicted_label}`, "success");
    } catch (err: any) {
      if (err?.status === 429 && err?.data?.error === "custom_attempt_limit_reached") {
        setCustomAttemptsUsed(err.data.attempts_used ?? CUSTOM_MAX);
        setLlmError(t("flow.customLimitReached", { max: CUSTOM_MAX }));
      } else if (err?.status === 429) {
        showToast(t("common.networkError"), "warn");
        setLlmError(t("common.networkError"));
      } else {
        setLlmError(err?.message ?? t("flow.llmError"));
        showToast(t("flow.llmError"), "error");
      }
    } finally {
      setLlmLoading(false);
      stopLlmTimer();
    }
  };

  const applyAcceptResponse = useCallback((res: any) => {
    if (res.progress) setProgress(res.progress);
    setPredicted("");
    setLlmError(null);
    setShowOverride(false);
    setAcceptedLabel(null);
    setRunsThisUnit(0);
    setCustomAttemptsUsed(res.custom_attempts_used ?? 0);
    if (!res.next_unit) {
      setDone(true);
      setUnit(null);
    } else {
      setUnit(res.next_unit);
    }
  }, []);

  const submitAcceptAndAdvance = async () => {
    const label = acceptedLabel;
    if (!unit || acceptingRef.current || !label) return;
    acceptingRef.current = true;
    setAccepting(true);
    const attemptPayload = tracker.finalize();
    try {
      const res = await api.acceptLlm({
        session_id: sessionId,
        unit_id: unit.unit_id,
        phase: "normal",
        mode: activeMode,
        accepted_label: label,
        attempt: attemptPayload
      });
      showToast(`✓ ${t("flow.submittedAs", { label: labelText(label) })}`, "success");
      setLlmLabelsByUnitId((prev) => ({ ...prev, [unit.unit_id]: label }));
      applyAcceptResponse(res);
    } catch (error: any) {
      const status = error?.status;
      const retryable =
        error?.code === "NETWORK_OFFLINE" ||
        error?.code === "NETWORK_ERROR" ||
        error?.code === "REQUEST_TIMEOUT" ||
        status === 429 ||
        (typeof status === "number" && status >= 500 && status < 600);
      if (retryable) {
        enqueueLlmAccept({
          session_id: sessionId,
          unit_id: unit.unit_id,
          phase: "normal",
          mode: activeMode,
          accepted_label: label,
          attempt: attemptPayload
        });
        showToast(t("flow.queuedForRetry"), "warn");
        if (error?.code === "REQUEST_TIMEOUT") showToast(t("common.requestTimeout"), "error");
        else if (status !== 429) showToast(t("common.networkError"), "error");
      } else {
        showToast(t("flow.submitFailed"), "error");
      }
      await load().catch(() => undefined);
    } finally {
      acceptingRef.current = false;
      setAccepting(false);
    }
  };

  const accept = (label: string) => {
    setAcceptedLabel(label);
  };

  const handleRunEssay = async () => {
    if (!sessionId || !currentEssay || runEssayLoading) return;
    setRunEssayLoading(true);
    try {
      const res = await api.runLlmEssay({
        session_id: sessionId,
        essay_index: currentEssay.essayIndex,
        mode: "prompt1"
      });
      setLlmLabelsByUnitId((prev) => {
        const next = { ...prev };
        for (const r of res.results) next[r.unit_id] = r.predicted_label;
        return next;
      });
      showToast(t("flow.modelReturned"), "success");
    } catch (err: any) {
      showToast(err?.message ?? t("flow.llmError"), "error");
    } finally {
      setRunEssayLoading(false);
    }
  };

  const handleAcceptForUnit = async (unitId: string, label: string) => {
    if (!sessionId || acceptingRef.current) return;
    acceptingRef.current = true;
    setAccepting(true);
    const attemptPayload = tracker.finalize();
    try {
      const res = await api.acceptLlm({
        session_id: sessionId,
        unit_id: unitId,
        phase: "normal",
        mode: "prompt1",
        accepted_label: label,
        attempt: attemptPayload
      });
      setLlmLabelsByUnitId((prev) => ({ ...prev, [unitId]: label }));
      if (res.progress) setProgress(res.progress);
      showToast(`✓ ${t("flow.submittedAs", { label: labelText(label) })}`, "success");
      if (essayIndexForLlmLabels != null) {
        const res2 = await api.getEssayLabels(sessionId, essayIndexForLlmLabels);
        setEssaySentences(res2.sentences);
        const map: Record<string, string> = {};
        for (const s of res2.sentences) {
          if (s.llm_label) map[s.unit_id] = s.llm_label;
        }
        setLlmLabelsByUnitId((prev) => ({ ...prev, ...map }));
      }
      if (res.next_unit == null) setDone(true);
    } catch (err: any) {
      showToast(err?.message ?? t("flow.submitFailed"), "error");
    } finally {
      acceptingRef.current = false;
      setAccepting(false);
    }
  };

  const allEssayAccepted = essaySentences.length > 0 && essaySentences.every((s) => s.llm_label != null && s.llm_label !== "");

  const goToNextSentence = () => {
    if (acceptedLabel) {
      submitAcceptAndAdvance();
    }
  };

  if (!sessionId) return null;

  if (loadError) {
    return (
      <div className="page">
        <div className="card error-box" style={{ textAlign: "center", padding: "32px 24px" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
          <h3 style={{ marginBottom: 8 }}>{t("common.error")}</h3>
          <p style={{ fontSize: 13, marginBottom: 16, color: "var(--color-text-muted)" }}>{loadError}</p>
          <button className="btn primary" onClick={() => load()}>{t("common.retry")}</button>
        </div>
      </div>
    );
  }

  const handleUndoRanking = async () => {
    if (sessionId == null || lastRankedEssayIndex == null || undoRankingInProgress) return;
    setUndoRankingInProgress(true);
    try {
      await api.undoRanking({ session_id: sessionId, essay_index: lastRankedEssayIndex });
      showToast(t("flow.undone"), "warn");
      nav("/user/normal/manual", { state: { showRankingForEssay: lastRankedEssayIndex } });
    } catch {
      showToast(t("flow.undoFailed"), "error");
    } finally {
      setUndoRankingInProgress(false);
    }
  };

  if (done) {
    return (
      <div className="page" style={{ justifyContent: "center" }}>
        <div className="card" style={{ textAlign: "center", padding: "40px 24px" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
          <h2>{t("flow.doneNormal")}</h2>
          <p style={{ margin: "12px 0 24px" }}>{t("flow.canContinueActive")}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {lastRankedEssayIndex != null && (
              <button
                type="button"
                className="btn lg full-width"
                onClick={handleUndoRanking}
                disabled={undoRankingInProgress}
              >
                {undoRankingInProgress ? "..." : t("flow.undoBackToRanking")}
              </button>
            )}
            <button className="btn primary lg full-width" onClick={() => nav("/user/visualization")}>
              {t("viz.title")} →
            </button>
            <button type="button" className="btn lg full-width" onClick={() => nav("/user/normal/manual")}>
              {t("ranking.backToRanking")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const currentPromptText = activeMode === "prompt1" ? prompt1Text : activeMode === "prompt2" ? prompt2Text : customPrompt;

  const modeLabels: Record<LlmMode, string> = {
    prompt1: t("flow.modePrompt1"),
    prompt2: t("flow.modePrompt2"),
    custom: t("flow.modeCustom")
  };

  return (
    <div className="page">
      <div className="progress-header">
        <ProgressRing done={progress.done} total={progress.total} />
        <div className="progress-info">
          <div className="progress-title">{t("flow.u2Title")}</div>
          <div className="progress-subtitle">{t("flow.runModelHint")}</div>
        </div>
      </div>

      <DeadLetterBanner />

      {unit && currentEssay && essaySentences.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 8 }}>{t("flow.essayLlmTitle", { n: currentEssay.essayIndex })}</h3>
          <button
            type="button"
            className="btn primary full-width"
            onClick={handleRunEssay}
            disabled={runEssayLoading}
          >
            {runEssayLoading ? (
              <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> {t("flow.runningEllipsis")}</>
            ) : (
              <>▶ {t("flow.runEssayLabelAll")}</>
            )}
          </button>
          <div style={{ marginTop: 16 }}>
            {essaySentences.map((s) => {
              const displayLabel = llmLabelsByUnitId[s.unit_id];
              return (
                <div
                  key={s.unit_id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 0",
                    borderBottom: "1px solid var(--color-border)"
                  }}
                >
                  <span style={{ flex: 1, fontSize: 13 }}>{s.text.slice(0, 60)}{s.text.length > 60 ? "…" : ""}</span>
                  <span style={{ fontSize: 12, color: "var(--color-text-muted)", minWidth: 80 }}>
                    {displayLabel ? labelText(displayLabel) : "—"}
                  </span>
                  {displayLabel && (
                    <>
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: "4px 10px", fontSize: 12 }}
                        onClick={() => handleAcceptForUnit(s.unit_id, displayLabel)}
                        disabled={accepting}
                      >
                        ✓ {t("flow.accept")}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: "4px 10px", fontSize: 12 }}
                        onClick={() => setOverrideUnitId(s.unit_id)}
                        disabled={accepting}
                      >
                        ✎ {t("flow.override").replace(/:?\s*$/, "")}
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {allEssayAccepted && (
            <button type="button" className="btn primary full-width" style={{ marginTop: 12 }} onClick={() => load()}>
              {t("flow.nextEssay")} →
            </button>
          )}
        </div>
      )}

      {unit && (
        <>
          {currentEssay && (
            <EssayDisplay essay={currentEssay} currentUnitId={unit.unit_id} labelsByUnitId={essayDisplayLlmLabels} />
          )}

          <div className="card unit-card-enter">
            {unitMeta ? (
              <span className="unit-chip">{t("flow.essay")} {unitMeta.essay} · S{unitMeta.sentence}</span>
            ) : null}

            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 10, marginTop: 8 }}>
              {t("flow.selectPromptMode")}
            </div>
            {!acceptedLabel && (
              <div
                style={{
                  fontSize: 12,
                  color: Math.max(0, LLM_ATTEMPTS_PER_UNIT - runsThisUnit) === 0 ? "var(--color-error, #dc2626)" : "var(--color-text-muted)",
                  marginBottom: 8
                }}
              >
                {t("flow.attemptsLeft", { n: Math.max(0, LLM_ATTEMPTS_PER_UNIT - runsThisUnit) })}
              </div>
            )}
            <div className="segmented" style={{ marginBottom: 12 }}>
              {(["prompt1", "prompt2", "custom"] as LlmMode[]).map((m) => (
                <button
                  key={m}
                  className={`segmented-btn ${activeMode === m ? "active" : ""}`}
                  onClick={() => setActiveMode(m)}
                  disabled={m === "custom" && customExhausted}
                >
                  {modeLabels[m]}
                  {m === "custom" && customAttemptsUsed > 0 && (
                    <span className={`attempt-counter ${customExhausted ? "exhausted" : ""}`} style={{ marginLeft: 6 }}>
                      {customAttemptsUsed}/{CUSTOM_MAX}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {(activeMode === "prompt1" || activeMode === "prompt2") && (
              <div style={{ marginBottom: 12 }}>
                <button
                  style={{ background: "none", border: "none", color: "var(--color-text-secondary)", fontSize: 12, cursor: "pointer", padding: 0, fontWeight: 600 }}
                  onClick={() => setShowPromptPreview(showPromptPreview === activeMode ? null : activeMode)}
                >
                  {showPromptPreview === activeMode ? `▲ ${t("flow.collapsePrompt")}` : `▼ ${t("flow.expandPrompt")}`}
                </button>
                {showPromptPreview === activeMode && (
                  <div className="prompt-preview" style={{ marginTop: 8 }}>
                    {currentPromptText || t("flow.empty")}
                  </div>
                )}
              </div>
            )}

            {activeMode === "custom" && (
              <div style={{ marginBottom: 12 }}>
                <textarea
                  rows={4}
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  disabled={customExhausted}
                  placeholder={t("flow.customPromptPlaceholder")}
                />
                <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 4, fontStyle: "italic" }}>
                  {t("flow.customHint")}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                  <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                    {customPrompt.length} {t("flow.chars")}
                  </span>
                  {customExhausted && (
                    <span className="attempt-counter exhausted">{t("flow.limitReached")} {CUSTOM_MAX}/{CUSTOM_MAX}</span>
                  )}
                </div>
                {customExhausted && (
                  <div className="error-box" style={{ marginTop: 8 }}>
                    {t("flow.customLimitReached", { max: CUSTOM_MAX })}
                  </div>
                )}
              </div>
            )}

            <button
              className="btn primary full-width"
              onClick={() => runLlm(activeMode)}
              disabled={llmLoading || (activeMode === "custom" && customExhausted) || (acceptedLabel ? false : runsThisUnit >= LLM_ATTEMPTS_PER_UNIT)}
            >
              {llmLoading ? (
                <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> {t("flow.runningEllipsis")}</>
              ) : (
                <>▶ {t("flow.runBtn")} {modeLabels[activeMode]}</>
              )}
            </button>
          </div>

          <div className="card">
            {llmLoading ? (
              <LlmSkeleton elapsed={llmElapsed} label={t("flow.modelRunning")} />
            ) : llmError ? (
              <div className="error-box">{llmError}</div>
            ) : acceptedLabel ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-success)", marginBottom: 8 }}>
                  ✓ {t("flow.acceptedTryOther")}
                </div>
                <div className="btn-group" style={{ marginTop: 16 }}>
                  <button className="btn" style={{ flex: 1 }} onClick={() => { setActiveMode("prompt2"); setAcceptedLabel(null); setPredicted(""); setRunsThisUnit(0); }}>
                    {t("flow.tryPrompt2")}
                  </button>
                  <button className="btn primary" style={{ flex: 1 }} onClick={goToNextSentence} disabled={accepting}>
                    {accepting ? <span className="spinner" /> : <>{t("flow.nextSentence")} →</>}
                  </button>
                </div>
              </>
            ) : predicted ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 8 }}>
                  {t("flow.predictionResult")}
                </div>
                <div className="predicted-badge">
                  🤖 {labelText(predicted)}
                </div>
                <div className="btn-group" style={{ marginTop: 16 }}>
                  <button className="btn primary" style={{ flex: 1 }} disabled={accepting} onClick={() => accept(predicted)}>
                    {accepting ? <span className="spinner" /> : <>✓ {t("flow.accept")}</>}
                  </button>
                  <button className="btn" style={{ flex: 1 }} disabled={accepting} onClick={() => setShowOverride(true)}>
                    ✎ {t("flow.override")}
                  </button>
                </div>
              </>
            ) : (
              <div style={{ color: "var(--color-text-muted)", fontSize: 14, textAlign: "center", padding: "16px 0" }}>
                {t("flow.clickRunHint")}
              </div>
            )}
          </div>
        </>
      )}

      {showOverride && (
        <OverrideSheet
          labels={labels}
          onSelect={accept}
          onClose={() => setShowOverride(false)}
          title={t("flow.overrideTitle")}
        />
      )}
      {overrideUnitId && (
        <OverrideSheet
          labels={labels}
          onSelect={(label) => {
            handleAcceptForUnit(overrideUnitId, label);
            setOverrideUnitId(null);
          }}
          onClose={() => setOverrideUnitId(null)}
          title={t("flow.overrideTitle")}
        />
      )}

      <ToastContainer toasts={toasts} />
    </div>
  );
}
