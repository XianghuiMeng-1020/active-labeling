import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { useI18n } from "../lib/i18n";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const COLORS = [
  "#4f46e5", "#7c3aed", "#0ea5e9", "#10b981", "#f59e0b",
  "#ef4444", "#8b5cf6", "#06b6d4", "#84cc16", "#f97316"
];
function hashLabel(label: string) {
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  }
  return hash;
}
function colorForLabel(label: string) {
  return COLORS[hashLabel(label) % COLORS.length];
}

export function BarChart({
  title,
  counts,
  noCard = false
}: {
  title: string;
  counts: Record<string, number>;
  noCard?: boolean;
}) {
  const { t } = useI18n();
  const labels = Object.keys(counts);
  const isEmpty = labels.length === 0;

  const data = {
    labels,
    datasets: [
      {
        label: title || "Count",
        data: labels.map((k) => counts[k]),
        backgroundColor: labels.map((label) => colorForLabel(label)),
        borderRadius: 6,
        borderSkipped: false
      }
    ]
  };

  const itemsLabel = t("chart.items");
  const options = {
    responsive: true,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (ctx: any) => ` ${ctx.raw} ${itemsLabel}` } }
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: { stepSize: 1, precision: 0 },
        grid: { color: "#f1f5f9" }
      },
      x: {
        grid: { display: false }
      }
    },
    animation: { duration: 400 }
  };

  const content = isEmpty ? (
    <div style={{ textAlign: "center", color: "var(--color-text-muted)", padding: "32px 0", fontSize: 13 }}>
      {t("chart.noData")}
    </div>
  ) : (
    <Bar data={data} options={options as any} />
  );

  if (noCard) return content;

  return (
    <div className="card">
      {title && <h3>{title}</h3>}
      {content}
    </div>
  );
}
