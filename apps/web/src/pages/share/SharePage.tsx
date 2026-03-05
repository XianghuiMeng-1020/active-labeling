import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { BarChart } from "../../components/BarChart";
import { API_BASE, api } from "../../lib/api";
import { useI18n } from "../../lib/i18n";

type OverallData = {
  overall: Record<string, number>;
  breakdown: {
    normal_manual: Record<string, number>;
    normal_llm: Record<string, number>;
    active_manual: Record<string, number>;
    active_llm: Record<string, number>;
  };
};

export function SharePage() {
  const { t } = useI18n();
  const { token = "" } = useParams();
  const [stats, setStats] = useState<OverallData>({
    overall: {},
    breakdown: { normal_manual: {}, normal_llm: {}, active_manual: {}, active_llm: {} }
  });
  const [view, setView] = useState<"overall" | "breakdown">("overall");

  useEffect(() => {
    if (!token) return;
    api.shareStats(token).then(setStats);
    const es = new EventSource(`${API_BASE}/api/share/stream/stats?token=${token}`);
    es.addEventListener("stats_update", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        const o = data.overall;
        if (o?.overall && o?.breakdown) {
          setStats(o);
        }
      } catch { /* ignore malformed SSE */ }
    });
    return () => es.close();
  }, [token]);

  return (
    <div className="page">
      <div className="hero-banner">
        <h1>{t("share.title")}</h1>
        <p>Sentence Labeling — Live Statistics</p>
      </div>

      <div className="card">
        <div className="segmented">
          <button
            className={`segmented-btn ${view === "overall" ? "active" : ""}`}
            onClick={() => setView("overall")}
          >
            {t("admin.dashboard.totalDist")}
          </button>
          <button
            className={`segmented-btn ${view === "breakdown" ? "active" : ""}`}
            onClick={() => setView("breakdown")}
          >
            {t("admin.dashboard.fourModeDist")}
          </button>
        </div>
      </div>

      {view === "overall" ? (
        <BarChart title={t("admin.dashboard.overallDist")} counts={stats.overall} />
      ) : (
        <>
          <BarChart title={t("admin.dashboard.normalManual")} counts={stats.breakdown.normal_manual} />
          <BarChart title={t("admin.dashboard.normalLlm")} counts={stats.breakdown.normal_llm} />
          <BarChart title={t("admin.dashboard.activeManual")} counts={stats.breakdown.active_manual} />
          <BarChart title={t("admin.dashboard.activeLlm")} counts={stats.breakdown.active_llm} />
        </>
      )}
    </div>
  );
}
