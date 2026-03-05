import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAttemptTracker } from "../../hooks/useAttemptTracker";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { DeadLetterBanner } from "../../components/DeadLetterBanner";
import { EssayDisplay } from "../../components/EssayDisplay";
import { DifficultyRanking } from "../../components/DifficultyRanking";
import { ProgressRing } from "../../components/ProgressRing";
import { ToastContainer, useToast } from "../../components/Toast";
import { enqueueManualSubmission, flushOfflineQueue } from "../../lib/offlineQueue";
import { getSessionId } from "../../lib/storage";
import { getEssaySentenceMeta } from "../../lib/unitUtils";
import { ESSAYS, getEssayByUnitId } from "../../lib/essayData";

function parseAlReason(reason: string | null | undefined, t: (k: string, v?: Record<string, string | number>) => string): string | null {
  if (!reason) return null;
  try {
    const obj = JSON.parse(reason) as {
      method?: string;
      entropy?: number;
      selected?: boolean;
      diversity_rank?: number | null;
      score_components?: { disagreement?: number };
    };
    if (obj.method === "ed_al_v1") {
      const parts: string[] = [];
      if (typeof obj.entropy === "number") parts.push(`${t("flow.uncertainty")} ${(obj.entropy * 100).toFixed(0)}%`);
      if (obj.diversity_rank) parts.push(`${t("flow.diversityRank")} #${obj.diversity_rank}`);
      return parts.length ? parts.join(" · ") : t("flow.alSelected");
    }
    if (obj.score_components?.disagreement === 1) return t("flow.promptDisagreement");
  } catch { /* ignore */ }
  return null;
}

type UndoEntry = { unit_id: string; label: string; text: string };
type UnitWithMeta = { unit_id: string; text: string; al_reason?: string | null; al_score?: number | null };

// getFullyLabeledEssays removed — now fetched from backend via api.getLabeledEssays

export function UserPhaseManualPage({ phase }: { phase: "normal" | "active" }) {
  const nav = useNavigate();
  const { t, labelText } = useI18n();
  const sessionId = getSessionId();

  const [labels, setLabels] = useState<Array<{ label: string }>>([]);
  const [unit, setUnit] = useState<UnitWithMeta | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [lastSubmitted, setLastSubmitted] = useState<UndoEntry | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [cardLeaving, setCardLeaving] = useState(false);
  const cardKey = useRef(0);
  const submittingRef = useRef(false);

  const [showRanking, setShowRanking] = useState(false);
  const [rankingEssayIndex, setRankingEssayIndex] = useState<number | null>(null);
  const pendingUnitRef = useRef<UnitWithMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const navigatingRef = useRef(false);

  const { toasts, showToast } = useToast();
  const tracker = useAttemptTracker(unit?.unit_id ?? "empty");
  const title = useMemo(() => (phase === "normal" ? t("flow.u1Title") : t("flow.u3Title")), [phase, t]);
  const unitMeta = useMemo(() => getEssaySentenceMeta(unit?.unit_id), [unit?.unit_id]);
  const currentEssay = useMemo(() => unit ? getEssayByUnitId(unit.unit_id) : null, [unit]);
  const alHint = useMemo(() => parseAlReason(unit?.al_reason, t), [unit?.al_reason, t]);

  const load = useCallback(async () => {
    if (!sessionId) { nav("/user/start"); return; }
    setLoading(true);
    setLoadError(null);
    navigatingRef.current = false;
    try {
      const status = await api.getSessionStatus(sessionId);
      if (phase === "active" && !status.gates.can_enter_active_manual) {
        nav("/user/normal/llm");
        return;
      }
      const prog = phase === "normal" ? status.normal_manual : status.active_manual;
      const done = prog?.done ?? 0;
      const total = prog?.total ?? 0;
      setProgress({ done, total });

      const [tax, next] = await Promise.all([
        labels.length > 0 ? { labels } : api.getTaxonomy(),
        api.getNextUnit(sessionId, phase, "manual")
      ]);
      if (tax.labels.length > 0) setLabels(tax.labels);

      if (phase === "normal") {
        const [labeledRes, rankRes] = await Promise.all([
          api.getLabeledEssays(sessionId, "normal").catch(() => ({ fully_labeled_essays: [] as number[] })),
          api.getRankingStatus(sessionId).catch(() => ({ ranked_essays: [] as number[] }))
        ]);
        const fullyLabeled = labeledRes.fully_labeled_essays;
        const rankedEssays = rankRes.ranked_essays;

        if (fullyLabeled.length > 0) {
          const unranked = fullyLabeled.find((idx) => !rankedEssays.includes(idx));
          if (unranked !== undefined) {
            const essay = ESSAYS.find((e) => e.essayIndex === unranked);
            if (essay) {
              setRankingEssayIndex(unranked);
              setShowRanking(true);
              pendingUnitRef.current = next.unit ?? null;
              setUnit(null);
              setLoading(false);
              return;
            }
          }
        }
      }

      if (!next.unit) {
        if (!navigatingRef.current) {
          navigatingRef.current = true;
          if (phase === "normal") nav("/user/normal/llm");
          else nav("/user/active/llm");
        }
        setUnit(null);
      } else {
        setUnit(next.unit);
      }
    } catch (err: any) {
      console.error("load() failed:", err);
      setLoadError(err?.message ?? t("common.error"));
    } finally {
      setLoading(false);
    }
  }, [sessionId, phase, nav, t]);

  useEffect(() => {
    flushOfflineQueue().catch(() => undefined);
    load();
  }, [phase, load]);
  useEffect(() => {
    const onOnline = () => { flushOfflineQueue().catch(() => undefined); };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  const applySubmitResponse = useCallback((res: any) => {
    if (res.progress) setProgress(res.progress);
    if (phase === "normal" && res.fully_labeled_essays?.length > 0) {
      const ranked = res.ranked_essays ?? [];
      const unranked = (res.fully_labeled_essays as number[]).find((idx: number) => !ranked.includes(idx));
      if (unranked !== undefined) {
        const essay = ESSAYS.find((e) => e.essayIndex === unranked);
        if (essay) {
          setRankingEssayIndex(unranked);
          setShowRanking(true);
          pendingUnitRef.current = res.next_unit ?? null;
          setUnit(null);
          return;
        }
      }
    }
    if (!res.next_unit) {
      if (!navigatingRef.current) {
        navigatingRef.current = true;
        if (phase === "normal") nav("/user/normal/llm");
        else nav("/user/active/llm");
      }
      setUnit(null);
    } else {
      setUnit(res.next_unit);
    }
  }, [phase, nav]);

  const submit = async (label: string) => {
    if (!unit || submitting || submittingRef.current) return;
    submittingRef.current = true;
    const attemptPayload = tracker.finalize();
    setSubmitting(true);
    setCardLeaving(true);
    try {
      const res = await api.submitManual({
        session_id: sessionId,
        unit_id: unit.unit_id,
        phase,
        label,
        attempt: attemptPayload
      });
      setLastSubmitted({ unit_id: unit.unit_id, label, text: unit.text });
      showToast(`✓ ${t("flow.submittedAs", { label: labelText(label) })}`, "success");

      cardKey.current += 1;
      await new Promise((r) => setTimeout(r, 180));
      setCardLeaving(false);
      applySubmitResponse(res);
    } catch (error: any) {
      setCardLeaving(false);
      const status = error?.status;
      const retryable =
        error?.code === "NETWORK_OFFLINE" ||
        error?.code === "NETWORK_ERROR" ||
        error?.code === "REQUEST_TIMEOUT" ||
        status === 429 ||
        (typeof status === "number" && status >= 500 && status < 600);
      if (retryable) {
        enqueueManualSubmission({
          session_id: sessionId,
          unit_id: unit.unit_id,
          phase,
          label,
          attempt: attemptPayload
        });
        showToast(t("flow.queuedForRetry"), "warn");
        if (error?.code === "REQUEST_TIMEOUT") showToast(t("common.requestTimeout"), "error");
        else if (status !== 429) showToast(t("common.networkError"), "error");
        cardKey.current += 1;
        await new Promise((r) => setTimeout(r, 180));
        setCardLeaving(false);
        await load().catch(() => undefined);
      } else {
        showToast(t("flow.submitFailed"), "error");
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const undo = async () => {
    if (!lastSubmitted || undoing) return;
    setUndoing(true);
    try {
      await api.undoManual({ session_id: sessionId, unit_id: lastSubmitted.unit_id, phase });
      showToast(t("flow.undone"), "warn");
      setLastSubmitted(null);
      await load();
    } catch {
      showToast(t("flow.undoFailed"), "error");
    } finally {
      setUndoing(false);
    }
  };

  const [rankingSubmitting, setRankingSubmitting] = useState(false);

  const handleRankingSubmit = async (ranking: string[]) => {
    if (!sessionId || rankingEssayIndex === null || rankingSubmitting) return;
    setRankingSubmitting(true);
    try {
      await api.submitRanking({
        session_id: sessionId,
        essay_index: rankingEssayIndex,
        ordering: ranking
      });
    } catch {
      showToast(t("flow.submitFailed"), "error");
      setRankingSubmitting(false);
      return;
    }
    setRankingSubmitting(false);
    setShowRanking(false);
    setRankingEssayIndex(null);

    pendingUnitRef.current = null;
    await load();
  };

  useEffect(() => {
    if (!unit || submitting) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const idx = Number.parseInt(e.key, 10);
      if (!Number.isFinite(idx) || idx < 1 || idx > labels.length || idx > 9) return;
      e.preventDefault();
      submit(labels[idx - 1].label);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [labels, submit, submitting, unit]);

  if (!sessionId) return null;

  if (loading) {
    return (
      <div className="page">
        <div className="card">
          <div className="skeleton skeleton-text wide" />
          <div className="skeleton skeleton-text medium" style={{ marginTop: 16 }} />
          <div className="skeleton skeleton-text" style={{ marginTop: 8 }} />
          <div className="skeleton skeleton-text" style={{ marginTop: 8 }} />
        </div>
        <div className="card">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[1,2,3,4].map((i) => <div key={i} className="skeleton" style={{ height: 52, borderRadius: 8 }} />)}
          </div>
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

  if (showRanking && rankingEssayIndex !== null && phase === "normal") {
    const essay = ESSAYS.find((e) => e.essayIndex === rankingEssayIndex);
    if (essay) {
      return (
        <div className="page">
          <div className="progress-header">
            <ProgressRing done={progress.done} total={progress.total} />
            <div className="progress-info">
              <div className="progress-title">{title}</div>
              <div className="progress-subtitle">{t("flow.essay")} {rankingEssayIndex} — {t("ranking.title")}</div>
            </div>
          </div>
          <DifficultyRanking essay={essay} onSubmit={handleRankingSubmit} submitting={rankingSubmitting} />
          <ToastContainer toasts={toasts} />
        </div>
      );
    }
  }

  if (!unit && phase === "active") {
    return (
      <div className="page">
        <div className="card" style={{ textAlign: "center", padding: "40px 24px" }}>
          <div className="confetti">
            {Array.from({ length: 18 }).map((_, i) => (
              <span key={i} className="confetti-piece" />
            ))}
          </div>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
          <h2>{t("flow.activeDoneTitle")}</h2>
          <p style={{ marginTop: 8 }}>{t("flow.allDone")}</p>
          <button className="btn primary lg" style={{ marginTop: 20 }} onClick={() => nav("/welcome")}>
            {t("welcome.letsGo")} →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="progress-header">
        <ProgressRing done={progress.done} total={progress.total} />
        <div className="progress-info">
          <div className="progress-title">{title}</div>
          <div className="progress-subtitle">{t("flow.submitNext")}</div>
        </div>
        {phase === "active" && <span className="badge purple">Active</span>}
      </div>

      <DeadLetterBanner />

      {lastSubmitted && (
        <div className="undo-banner">
          <div className="undo-text">
            <span className="undo-label">{labelText(lastSubmitted.label)}</span>
            {" — "}
            <span className="undo-excerpt">
              {lastSubmitted.text.slice(0, 55)}{lastSubmitted.text.length > 55 ? "…" : ""}
            </span>
          </div>
          <button
            className="btn"
            style={{ flexShrink: 0, fontSize: 13, padding: "6px 14px", background: "#fef9c3", border: "1px solid #facc15", color: "#713f12" }}
            onClick={undo}
            disabled={undoing}
          >
            {undoing ? "..." : `↩ ${t("flow.undo")}`}
          </button>
        </div>
      )}

      {unit ? (
        <>
          {currentEssay && (
            <EssayDisplay essay={currentEssay} currentUnitId={unit.unit_id} />
          )}

          <div
            className={`card ${phase === "active" ? "card-active" : ""} ${cardLeaving ? "unit-card-leave" : "unit-card-enter"}`}
            key={cardKey.current}
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {unitMeta ? (
                <span className="unit-chip">{t("flow.essay")} {unitMeta.essay} · S{unitMeta.sentence}</span>
              ) : null}
              {phase === "active" && (
                <span className="unit-chip active">⚡ {t("flow.activeLearning")}</span>
              )}
            </div>

            {alHint && (
              <div style={{ fontSize: 12, color: "#7c3aed", marginBottom: 10, fontWeight: 600 }}>
                🔍 {alHint}
              </div>
            )}

            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 10 }}>
              {t("flow.selectLabel")}
            </div>
            <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 10 }}>
              {t("flow.shortcutHint")}
            </div>
            <div className="label-grid">
              {labels.map((l, index) => (
                <button key={l.label} className="label-btn" onClick={() => submit(l.label)} disabled={submitting}>
                  {index < 9 ? `${index + 1}. ` : ""}{labelText(l.label)}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="card" style={{ textAlign: "center", padding: "32px" }}>
          <div className="spinner" style={{ margin: "0 auto" }} />
          <p style={{ marginTop: 12 }}>{t("common.done")}</p>
        </div>
      )}

      <ToastContainer toasts={toasts} />
    </div>
  );
}
