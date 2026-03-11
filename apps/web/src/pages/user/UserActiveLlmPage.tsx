import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { getSessionId } from "../../lib/storage";
import { getEssaySentenceMeta } from "../../lib/unitUtils";

type ActiveLlmItem = {
  ordering: number;
  unit_id: string;
  text: string;
  label: string | null;
  score: number | null;
  reason: string | null;
};

function getDifficulty(reason: string | null | undefined, score: number | null | undefined): "Easy" | "Medium" | "Hard" | null {
  if (reason) {
    try {
      const obj = JSON.parse(reason) as { difficulty_llm?: string; entropy?: number };
      if (obj.difficulty_llm === "Easy" || obj.difficulty_llm === "Medium" || obj.difficulty_llm === "Hard")
        return obj.difficulty_llm;
      if (typeof obj.entropy === "number") {
        if (obj.entropy < 0.35) return "Easy";
        if (obj.entropy < 0.65) return "Medium";
        return "Hard";
      }
    } catch { /* ignore */ }
  }
  if (typeof score === "number") {
    if (score < 0.35) return "Easy";
    if (score < 0.65) return "Medium";
    return "Hard";
  }
  return null;
}

export function UserActiveLlmPage() {
  const nav = useNavigate();
  const { t, labelText } = useI18n();
  const sessionId = getSessionId();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ActiveLlmItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [labels, setLabels] = useState<Array<{ label: string }>>([]);
  const [overrideUnitId, setOverrideUnitId] = useState<string | null>(null);
  const [localOverrides, setLocalOverrides] = useState<Record<string, string>>({});

  useEffect(() => {
    api.getTaxonomy().then((tax) => {
      const HIDDEN = new Set(["CODE", "UNKNOWN"]);
      setLabels(tax.labels.filter((l: { label: string }) => !HIDDEN.has(l.label)));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!sessionId) { nav("/user/start"); return; }
      setLoading(true);
      setError(null);
      try {
        await api.ensureActiveLlmResults(sessionId).catch(() => {});
        let data: { items?: ActiveLlmItem[] } = await api.getActiveLlmResults(sessionId);
        if (!cancelled) setItems(data.items ?? []);
        const hasPending = (data.items ?? []).some((x) => !x.label);
        const deadline = Date.now() + 120_000;
        while (hasPending && !cancelled && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 5000));
          if (cancelled) break;
          data = await api.getActiveLlmResults(sessionId);
          if (!cancelled) setItems(data.items ?? []);
          if (!(data.items ?? []).some((x) => !x.label)) break;
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? t("common.error"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId, nav, t]);

  const readyCount = useMemo(() => items.filter((x) => !!x.label).length, [items]);

  if (!sessionId) return null;

  if (error) {
    return (
      <div className="page">
        <div className="card" style={{ textAlign: "center", padding: "32px 24px" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
          <h3 style={{ marginBottom: 8 }}>{t("common.error")}</h3>
          <p style={{ fontSize: 13, marginBottom: 16, color: "var(--color-text-muted)" }}>{error}</p>
          <button className="btn primary" onClick={() => window.location.reload()}>{t("common.retry")}</button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="page">
        <div className="card">
          <div className="skeleton skeleton-text wide" />
          <div className="skeleton skeleton-text medium" style={{ marginTop: 12 }} />
        </div>
        {[1,2,3].map((i) => (
          <div className="card" key={i}>
            <div className="skeleton skeleton-text wide" />
            <div className="skeleton skeleton-text" style={{ marginTop: 8 }} />
            <div className="skeleton skeleton-badge" style={{ marginTop: 12 }} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="page">
      <div className="hero-banner active-learning">
        <h1>{t("flow.u4Title")}</h1>
        <p>{t("flow.u4Hint", { ready: readyCount, total: items.length })}</p>
        <span className="badge purple" style={{ marginTop: 8, display: "inline-block" }}>⚡ Active Learning</span>
      </div>

      {items.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "40px 24px" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📭</div>
          <p>{t("flow.u4NoItems")}</p>
        </div>
      ) : (
        items.map((item, idx) => {
          const meta = getEssaySentenceMeta(item.unit_id);
          const displayLabel = localOverrides[item.unit_id] ?? item.label;
          const hasLabel = !!displayLabel;
          const difficulty = getDifficulty(item.reason, item.score);
          return (
            <div className="card" key={`${item.unit_id}-${idx}`}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                {meta && (
                  <span className="unit-chip">
                    {t("flow.essay")} {meta.essay} · {t("flow.sentence")} {meta.sentence}
                  </span>
                )}
                {hasLabel ? (
                  <span className="badge green">✓</span>
                ) : (
                  <span className="badge yellow">{t("flow.u4Pending")}</span>
                )}
                {difficulty && (
                  <span className={`unit-chip difficulty-${difficulty.toLowerCase()}`}>
                    {difficulty === "Easy" ? t("flow.difficultyEasy") : difficulty === "Medium" ? t("flow.difficultyMedium") : t("flow.difficultyHard")}
                  </span>
                )}
              </div>
              <div className="text-block" style={{ fontSize: 15 }}>{item.text}</div>
              <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
                <div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)" }}>{t("flow.u4Predicted")}</span>
                  <div style={{ fontWeight: 700, fontSize: 16, marginTop: 2 }}>
                    {displayLabel ? (
                      <span className="predicted-badge" style={{ fontSize: 13, padding: "4px 14px" }}>🤖 {labelText(displayLabel)}</span>
                    ) : (
                      <span style={{ color: "var(--color-text-muted)" }}>—</span>
                    )}
                  </div>
                </div>
                {item.score !== null && item.score !== undefined && (
                  <div>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)" }}>{t("flow.u4Score")}</span>
                    <div style={{ fontWeight: 700, fontSize: 16, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
                      {item.score.toFixed(4)}
                    </div>
                  </div>
                )}
                {hasLabel && (
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: "4px 12px", fontSize: 12, marginLeft: "auto" }}
                    onClick={() => setOverrideUnitId(item.unit_id)}
                  >
                    ✎ {t("flow.changeLabel")}
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}

      <button
        className="btn primary full-width lg"
        style={{ marginTop: 8, marginBottom: 32 }}
        onClick={() => nav("/user/survey")}
      >
        {t("survey.goToSurvey")} →
      </button>

      {overrideUnitId && labels.length > 0 && (
        <>
          <div className="bottom-sheet-overlay" onClick={() => setOverrideUnitId(null)} />
          <div className="bottom-sheet">
            <div className="bottom-sheet-handle" />
            <div className="bottom-sheet-title">{t("flow.overrideTitle")}</div>
            <div className="label-grid">
              {labels.map((l) => (
                <button
                  key={l.label}
                  className="label-btn"
                  onClick={() => {
                    setLocalOverrides((prev) => ({ ...prev, [overrideUnitId]: l.label }));
                    setOverrideUnitId(null);
                  }}
                >
                  {labelText(l.label)}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
