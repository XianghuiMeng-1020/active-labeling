import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, type LlmMode, type AttemptPayload } from "../../lib/api";
import { ENABLE_ACTIVE_LEARNING } from "../../lib/featureFlags";
import { useI18n } from "../../lib/i18n";
import { DeadLetterBanner } from "../../components/DeadLetterBanner";
import { EssayDisplay } from "../../components/EssayDisplay";
import { ProgressRing } from "../../components/ProgressRing";
import { ToastContainer, useToast } from "../../components/Toast";
import { flushOfflineQueue } from "../../lib/offlineQueue";
import { getSessionId } from "../../lib/storage";
import { ESSAYS } from "../../lib/essayData";

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

function getEssayIndexFromUnitId(unitId: string | null | undefined): number | null {
  if (!unitId) return null;
  const m = unitId.match(/^essay(\d+)_sentence/i);
  if (!m) return null;
  const parsed = Number.parseInt(m[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function emptyAttempt(): AttemptPayload {
  const now = Date.now();
  return {
    shown_at_epoch_ms: now,
    answered_at_epoch_ms: now,
    active_ms: 0,
    hidden_ms: 0,
    idle_ms: 0,
    hidden_count: 0,
    blur_count: 0,
    had_background: 0,
    events: []
  };
}

export function UserNormalLlmPage() {
  const nav = useNavigate();
  const location = useLocation();
  const { t, labelText } = useI18n();
  const sessionId = getSessionId();
  const [lastRankedEssayIndex, setLastRankedEssayIndex] = useState<number | null>(
    () => (location.state as { lastRankedEssayIndex?: number } | null)?.lastRankedEssayIndex ?? null
  );

  const [labels, setLabels] = useState<Array<{ label: string }>>([]);
  const [_progress, setProgress] = useState({ done: 0, total: 0 });
  const [done, setDone] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [phaseLocked, setPhaseLocked] = useState(false);
  const [undoRankingInProgress, setUndoRankingInProgress] = useState(false);
  const [runEssayLoading, setRunEssayLoading] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [activeMode, setActiveMode] = useState<LlmMode>("prompt1");
  const [customPromptText, setCustomPromptText] = useState("");

  const [currentEssayIndex, setCurrentEssayIndex] = useState<number | null>(null);
  const [currentUnitId, setCurrentUnitId] = useState<string>("");
  const [essaySentences, setEssaySentences] = useState<Array<{ unit_id: string; text: string; manual_label: string | null; llm_label: string | null }>>([]);
  const [llmLabelsByUnitId, setLlmLabelsByUnitId] = useState<Record<string, string>>({});
  const [acceptedUnitIds, setAcceptedUnitIds] = useState<Set<string>>(new Set());
  const [overrideUnitId, setOverrideUnitId] = useState<string | null>(null);

  const { toasts, showToast } = useToast();

  const currentEssay = useMemo(
    () => (currentEssayIndex != null ? ESSAYS.find((e) => e.essayIndex === currentEssayIndex) ?? null : null),
    [currentEssayIndex]
  );

  const essayTotal = ESSAYS.length;
  const essayDone = useMemo(() => {
    if (done) return essayTotal;
    if (currentEssayIndex == null) return 0;
    const sorted = ESSAYS.map((e) => e.essayIndex).sort((a, b) => a - b);
    const idx = sorted.indexOf(currentEssayIndex);
    return idx >= 0 ? idx : 0;
  }, [done, currentEssayIndex, essayTotal]);

  const allPredicted = useMemo(
    () => essaySentences.length > 0 && essaySentences.every((s) => Boolean(llmLabelsByUnitId[s.unit_id])),
    [essaySentences, llmLabelsByUnitId]
  );
  const allAccepted = useMemo(
    () => essaySentences.length > 0 && essaySentences.every((s) => acceptedUnitIds.has(s.unit_id)),
    [essaySentences, acceptedUnitIds]
  );

  const syncEssayLabels = useCallback(async (essayIndex: number) => {
    if (!sessionId) return;
    const res = await api.getEssayLabels(sessionId, essayIndex);
    setEssaySentences(res.sentences);
    const map: Record<string, string> = {};
    const accepted = new Set<string>();
    for (const s of res.sentences) {
      if (s.llm_label) {
        map[s.unit_id] = s.llm_label;
        accepted.add(s.unit_id);
      }
    }
    setLlmLabelsByUnitId((prev) => ({ ...prev, ...map }));
    setAcceptedUnitIds(accepted);
  }, [sessionId]);

  const load = useCallback(async () => {
    if (!sessionId) { nav("/user/start"); return; }
    setLoadError(null);
    try {
      const status = await api.getSessionStatus(sessionId);
      if (status.locks?.lock_llm) {
        setPhaseLocked(true);
        return;
      }
      setPhaseLocked(false);
      if (!status.gates.can_enter_normal_llm) { nav("/user/normal/manual"); return; }
      setProgress({ done: status.normal_llm?.done ?? 0, total: status.normal_llm?.total ?? 0 });

      if (labels.length === 0) {
        const tax = await api.getTaxonomy();
        const HIDDEN = new Set(["CODE", "UNKNOWN"]);
        setLabels(tax.labels.filter((l: { label: string }) => !HIDDEN.has(l.label)));
      }

      const next = await api.getNextUnit(sessionId, "normal", "llm");
      if (!next.unit) {
        setDone(true);
        setCurrentEssayIndex(null);
        setCurrentUnitId("");
        return;
      }

      const idx = getEssayIndexFromUnitId(next.unit.unit_id);
      setDone(false);
      setCurrentUnitId(next.unit.unit_id);
      setCurrentEssayIndex(idx);
      if (idx != null) {
        await syncEssayLabels(idx);
      }
    } catch (err: any) {
      console.error("LLM load() failed:", err);
      setLoadError(err?.message ?? "Loading failed");
    }
  }, [labels.length, nav, sessionId, syncEssayLabels]);

  useEffect(() => {
    flushOfflineQueue().catch(() => undefined);
    load();
  }, [load]);

  const handleRunEssay = async () => {
    if (!sessionId || !currentEssay || runEssayLoading) return;
    setLastRankedEssayIndex(null);
    setRunEssayLoading(true);
    try {
      const res = await api.runLlmEssay({
        session_id: sessionId,
        essay_index: currentEssay.essayIndex,
        mode: activeMode,
        ...(activeMode === "custom" && customPromptText.trim() ? { custom_prompt_text: customPromptText.trim() } : {})
      });
      const next = { ...llmLabelsByUnitId };
      for (const r of res.results) next[r.unit_id] = r.predicted_label;
      setLlmLabelsByUnitId(next);
      showToast(t("flow.modelReturned"), "success");
    } catch (err: any) {
      showToast(err?.message ?? t("flow.llmError"), "error");
    } finally {
      setRunEssayLoading(false);
    }
  };

  const acceptOne = async (unitId: string, label: string) => {
    if (!sessionId) return;
    const res = await api.acceptLlm({
      session_id: sessionId,
      unit_id: unitId,
      phase: "normal",
      mode: activeMode,
      accepted_label: label,
      attempt: emptyAttempt()
    });
    if (res.progress) setProgress(res.progress);
    setAcceptedUnitIds((prev) => {
      const next = new Set(prev);
      next.add(unitId);
      return next;
    });
    setLlmLabelsByUnitId((prev) => ({ ...prev, [unitId]: label }));
  };

  const handleAcceptForUnit = async (unitId: string, label: string) => {
    if (accepting) return;
    setLastRankedEssayIndex(null);
    setAccepting(true);
    try {
      await acceptOne(unitId, label);
      showToast(`✓ ${t("flow.submittedAs", { label: labelText(label) })}`, "success");
    } catch (err: any) {
      showToast(err?.message ?? t("flow.submitFailed"), "error");
    } finally {
      setAccepting(false);
    }
  };

  const handleAcceptAll = async () => {
    if (!allPredicted || accepting) return;
    setAccepting(true);
    try {
      for (const s of essaySentences) {
        if (acceptedUnitIds.has(s.unit_id)) continue;
        const label = llmLabelsByUnitId[s.unit_id];
        if (!label) continue;
        await acceptOne(s.unit_id, label);
      }
      showToast(t("flow.acceptAllDone"), "success");
    } catch (err: any) {
      showToast(err?.message ?? t("flow.submitFailed"), "error");
    } finally {
      setAccepting(false);
    }
  };

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

  if (!sessionId) return null;

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

  if (done) {
    return (
      <div className="page" style={{ justifyContent: "center" }}>
        <div className="card" style={{ textAlign: "center", padding: "40px 24px" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
          <h2>{t("flow.doneNormal")}</h2>
          <p style={{ margin: "12px 0 24px" }}>{t(ENABLE_ACTIVE_LEARNING ? "flow.canContinueActive" : "flow.canContinueToViz")}</p>
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
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="progress-header">
        <ProgressRing done={essayDone} total={essayTotal} />
        <div className="progress-info">
          <div className="progress-title">{t("flow.u2Title")}</div>
          <div className="progress-subtitle">{t("flow.runModelHint")}</div>
        </div>
      </div>

      <DeadLetterBanner />

      {currentEssay && (
        <EssayDisplay essay={currentEssay} currentUnitId={currentUnitId} labelsByUnitId={llmLabelsByUnitId} highlightAllLabeled />
      )}

      {currentEssay && essaySentences.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginBottom: 8 }}>{t("flow.essayLlmTitle", { n: currentEssay.essayIndex })}</h3>

          <div className="segmented" style={{ marginBottom: 12 }}>
            {(["prompt1", "prompt2", "custom"] as LlmMode[]).map((m) => (
              <button
                key={m}
                className={`segmented-btn ${activeMode === m ? "active" : ""}`}
                onClick={() => setActiveMode(m)}
              >
                {m === "prompt1" ? t("flow.modePrompt1") : m === "prompt2" ? t("flow.modePrompt2") : t("flow.modeCustom")}
              </button>
            ))}
          </div>

          {activeMode === "custom" && (
            <textarea
              rows={4}
              value={customPromptText}
              onChange={(e) => setCustomPromptText(e.target.value)}
              placeholder={t("flow.customPromptPlaceholder")}
              style={{ width: "100%", marginBottom: 12, fontSize: 13, resize: "vertical" }}
              disabled={runEssayLoading}
            />
          )}

          <button
            type="button"
            className="btn primary full-width"
            onClick={handleRunEssay}
            disabled={runEssayLoading || (activeMode === "custom" && !customPromptText.trim())}
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
              const rowAccepted = acceptedUnitIds.has(s.unit_id);
              return (
                <div
                  key={s.unit_id}
                  className={rowAccepted ? "llm-row-accepted" : ""}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 0",
                    borderBottom: "1px solid var(--color-border)"
                  }}
                >
                  <span style={{ flex: 1, fontSize: 13 }}>{s.text.slice(0, 60)}{s.text.length > 60 ? "…" : ""}</span>
                  <span className="llm-label-badge">
                    {displayLabel ? `🤖 ${labelText(displayLabel)}` : "—"}
                  </span>
                  {displayLabel && !rowAccepted && (
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
                  {rowAccepted && (
                    <span style={{ fontSize: 12, color: "#166534", fontWeight: 700 }}>✓ {t("flow.accepted")}</span>
                  )}
                </div>
              );
            })}
          </div>

          {allPredicted && !allAccepted && (
            <button
              type="button"
              className="btn full-width"
              style={{ marginTop: 12 }}
              onClick={handleAcceptAll}
              disabled={accepting}
            >
              {accepting ? "..." : t("flow.acceptAll")}
            </button>
          )}

          {allAccepted && (
            <button type="button" className="btn primary full-width" style={{ marginTop: 12 }} onClick={() => load()}>
              {t("flow.nextEssay")} →
            </button>
          )}
        </div>
      )}

      {lastRankedEssayIndex != null && (
        <div style={{ marginTop: 16 }}>
          <button
            type="button"
            className="btn full-width"
            style={{ fontSize: 13, padding: "8px 14px", background: "#fef9c3", border: "1px solid #facc15", color: "#713f12" }}
            onClick={handleUndoRanking}
            disabled={undoRankingInProgress}
          >
            {undoRankingInProgress ? "..." : `↩ ${t("flow.undoBackToRanking")}`}
          </button>
        </div>
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
