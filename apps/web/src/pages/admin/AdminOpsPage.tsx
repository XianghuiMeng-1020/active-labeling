import { useEffect, useState } from "react";
import { AdminNav } from "../../components/AdminNav";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { getAdminToken } from "../../lib/storage";

export function AdminOpsPage() {
  const { t } = useI18n();
  const token = getAdminToken();
  const [metrics, setMetrics] = useState<{ qwen_calls_total: number; qwen_429_total: number; retries_total: number; avg_latency_ms: number } | null>(null);
  const [sync, setSync] = useState<{ revision: number } | null>(null);
  const [recent, setRecent] = useState<{ events: Array<{ attempt_id: string; session_id: string; unit_id: string; phase: string; task: string; llm_mode: string | null; created_at: string }> } | null>(null);
  const [audit, setAudit] = useState<{ ok: boolean; mismatches: string[] } | null>(null);

  useEffect(() => {
    if (!token) return;
    const load = async () => {
      try {
        const [m, s, r, a] = await Promise.all([
          api.adminGetQwenMetrics(token),
          api.adminGetStatsSync(token).then((x) => ({ revision: x.revision })),
          api.adminGetOpsRecent(token, 50),
          api.adminGetAuditConsistency(token)
        ]);
        setMetrics(m);
        setSync(s);
        setRecent(r);
        setAudit(a);
      } catch {
        setMetrics(null);
        setSync(null);
        setRecent(null);
        setAudit(null);
      }
    };
    load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, [token]);

  return (
    <div style={{ minHeight: "100dvh", background: "var(--color-bg)" }}>
      <AdminNav />
      <div className="page-wide" style={{ paddingTop: 16 }}>
        <h2 style={{ marginBottom: 16 }}>{t("admin.ops.title")} (Admin-only)</h2>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16, marginBottom: 24 }}>
          {metrics && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>{t("admin.ops.qwenMetrics")}</h3>
              <dl style={{ margin: 0, fontSize: 14 }}>
                <dt>calls_total</dt><dd>{metrics.qwen_calls_total}</dd>
                <dt>429_total</dt><dd>{metrics.qwen_429_total}</dd>
                <dt>retries_total</dt><dd>{metrics.retries_total}</dd>
                <dt>avg_latency_ms</dt><dd>{metrics.avg_latency_ms}</dd>
              </dl>
            </div>
          )}
          {sync && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Stats revision</h3>
              <p style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{sync.revision}</p>
            </div>
          )}
          {audit && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>{t("admin.ops.auditConsistency")}</h3>
              <p style={{ margin: 0, color: audit.ok ? "var(--color-success)" : "var(--color-error)", fontWeight: 600 }}>
                {audit.ok ? "OK" : "Mismatches"}
              </p>
              {!audit.ok && audit.mismatches?.length > 0 && (
                <ul style={{ margin: "8px 0 0", paddingLeft: 20, fontSize: 12 }}>
                  {audit.mismatches.slice(0, 5).map((m, i) => <li key={i}>{m}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>{t("admin.ops.recentEvents")} (label_attempts)</h3>
          <div className="table-scroll-wrapper">
            <div className="table-scroll-inner" style={{ maxHeight: 320 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("admin.ops.time")}</th>
                  <th>session</th>
                  <th>unit</th>
                  <th>phase</th>
                  <th>task</th>
                  <th>llm_mode</th>
                </tr>
              </thead>
              <tbody>
                {recent?.events?.slice(0, 50).map((e, i) => (
                  <tr key={i}>
                    <td>{e.created_at?.slice(0, 19)}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{e.session_id?.slice(0, 8)}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{e.unit_id?.slice(0, 8)}</td>
                    <td>{e.phase}</td>
                    <td>{e.task}</td>
                    <td>{e.llm_mode ?? "—"}</td>
                  </tr>
                ))}
                {(!recent?.events?.length) && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--color-text-muted)" }}>{t("admin.ops.noData")}</td></tr>}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
