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

export function UserActiveLlmPage() {
  const nav = useNavigate();
  const { t, labelText } = useI18n();
  const sessionId = getSessionId();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ActiveLlmItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!sessionId) { nav("/user/start"); return; }
      setLoading(true);
      setError(null);
      try {
        const data = await api.getActiveLlmResults(sessionId);
        if (!cancelled) setItems(data.items ?? []);
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
          const hasLabel = !!item.label;
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
              </div>
              <div className="text-block" style={{ fontSize: 15 }}>{item.text}</div>
              <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
                <div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)" }}>{t("flow.u4Predicted")}</span>
                  <div style={{ fontWeight: 700, fontSize: 16, marginTop: 2 }}>
                    {item.label ? (
                      <span className="predicted-badge" style={{ fontSize: 13, padding: "4px 14px" }}>🤖 {labelText(item.label)}</span>
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
    </div>
  );
}
