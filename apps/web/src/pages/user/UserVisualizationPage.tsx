import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
} from "chart.js";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { getSessionId } from "../../lib/storage";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

type VizData = Awaited<ReturnType<typeof api.getVisualizationStats>>;

function formatTime(ms: number): string {
  return (ms / 1000).toFixed(1);
}

function TimeCard({ label, manualMs, llmMs, unit }: { label: string; manualMs: number; llmMs: number; unit: string }) {
  const { t } = useI18n();
  const saved = manualMs > 0 ? Math.round(((manualMs - llmMs) / manualMs) * 100) : 0;

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-secondary)", marginBottom: 12 }}>
        {label}
      </div>
      <div className="time-comparison">
        <div className="time-card">
          <div className="time-card-label">{t("viz.manual")}</div>
          <div className="time-card-value manual">{formatTime(manualMs)}</div>
          <div className="time-card-unit">{unit}</div>
        </div>
        <div className="time-card">
          <div className="time-card-label">{t("viz.llm")}</div>
          <div className="time-card-value llm">{formatTime(llmMs)}</div>
          <div className="time-card-unit">{unit}</div>
        </div>
      </div>
      {saved > 0 && (
        <div style={{ textAlign: "center", marginTop: 10, fontSize: 13, fontWeight: 700, color: "var(--color-success)" }}>
          {t("viz.fasterPercent", { percent: saved })}
        </div>
      )}
    </div>
  );
}

export function UserVisualizationPage() {
  const nav = useNavigate();
  const { t, labelText } = useI18n();
  const sessionId = getSessionId();
  const [data, setData] = useState<VizData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) { nav("/user/start"); return; }
    (async () => {
      setLoading(true);
      try {
        const status = await api.getSessionStatus(sessionId);
        if (!status.gates.can_enter_active_manual) {
          if (status.gates.can_enter_normal_llm) nav("/user/normal/llm");
          else nav("/user/normal/manual");
          return;
        }
        const viz = await api.getVisualizationStats();
        setData(viz);
      } catch (e: any) {
        setError(e?.message ?? "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId, nav]);

  if (!sessionId) return null;

  if (loading) {
    return (
      <div className="page">
        <div className="card">
          <div className="skeleton skeleton-text wide" />
          <div className="skeleton" style={{ height: 200, marginTop: 16, borderRadius: 12 }} />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="page">
        <div className="card" style={{ textAlign: "center", padding: 32 }}>
          <p>{error ?? t("viz.noData")}</p>
          <button className="btn primary" style={{ marginTop: 16 }} onClick={() => nav("/user/active/manual")}>
            {t("viz.continue")} →
          </button>
        </div>
      </div>
    );
  }

  const { label_distribution: dist, time_comparison: time } = data;
  const allLabels = Array.from(new Set([
    ...Object.keys(dist.normal_manual),
    ...Object.keys(dist.normal_llm)
  ])).filter((l) => l !== "UNKNOWN").sort();

  const manualDistData = allLabels.map((l) => dist.normal_manual[l] ?? 0);
  const llmDistData = allLabels.map((l) => dist.normal_llm[l] ?? 0);
  const translatedLabels = allLabels.map((l) => labelText(l));

  const chartData = {
    labels: translatedLabels,
    datasets: [
      {
        label: t("viz.manual"),
        data: manualDistData,
        backgroundColor: "rgba(99, 102, 241, 0.7)",
        borderColor: "rgba(99, 102, 241, 1)",
        borderWidth: 1,
        borderRadius: 6
      },
      {
        label: t("viz.llm"),
        data: llmDistData,
        backgroundColor: "rgba(16, 185, 129, 0.7)",
        borderColor: "rgba(16, 185, 129, 1)",
        borderWidth: 1,
        borderRadius: 6
      }
    ]
  };

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: { position: "top" as const },
      title: { display: false }
    },
    scales: {
      y: { beginAtZero: true, ticks: { stepSize: 1 } }
    }
  };

  return (
    <div className="page">
      <div className="hero-banner">
        <h1>{t("viz.title")}</h1>
        <p>{t("viz.subtitle")}</p>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 16 }}>{t("viz.labelDist")}</h3>
        <Bar data={chartData} options={chartOptions} />
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 4 }}>{t("viz.timeComparison")}</h3>
        <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 16 }}>
          {t("viz.metaSummary", { sessions: data.meta.sessions, essays: data.meta.total_essays, sentencesPerEssay: data.meta.sentences_per_essay })}
        </p>
      </div>

      <TimeCard
        label={t("viz.sentenceAvg")}
        manualMs={time.sentence_avg.manual_ms}
        llmMs={time.sentence_avg.llm_ms}
        unit={t("viz.seconds")}
      />

      <TimeCard
        label={t("viz.essayAvg")}
        manualMs={time.essay_avg.manual_ms}
        llmMs={time.essay_avg.llm_ms}
        unit={t("viz.seconds")}
      />

      <TimeCard
        label={t("viz.totalAvg")}
        manualMs={time.total_avg.manual_ms}
        llmMs={time.total_avg.llm_ms}
        unit={t("viz.seconds")}
      />

      <button
        className="btn primary full-width lg"
        onClick={() => nav("/user/active/manual")}
        style={{ marginTop: 8 }}
      >
        {t("viz.continue")} →
      </button>
    </div>
  );
}
