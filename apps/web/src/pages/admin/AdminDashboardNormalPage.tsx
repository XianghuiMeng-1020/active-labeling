import { useEffect, useRef, useState } from "react";
import { AdminNav } from "../../components/AdminNav";
import { BarChart } from "../../components/BarChart";
import { api, API_BASE } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { getAdminToken } from "../../lib/storage";

type NormalStats = { normal_manual: Record<string, number>; normal_llm: Record<string, number> };
type OverallStats = {
  overall: Record<string, number>;
  breakdown: {
    normal_manual: Record<string, number>;
    normal_llm: Record<string, number>;
    active_manual: Record<string, number>;
    active_llm: Record<string, number>;
  };
};
type BehaviorStats = {
  overall: {
    total_attempts: number;
    avg_active_ms: number;
    avg_hidden_ms: number;
    avg_idle_ms: number;
    background_rate: number;
    invalid_rate: number;
  };
  by_task: Record<string, {
    total_attempts: number;
    avg_active_ms: number;
    avg_hidden_ms: number;
    avg_idle_ms: number;
    background_rate: number;
    invalid_rate: number;
  }>;
  by_session: Array<{
    session_id: string;
    user_id: string;
    total_attempts: number;
    avg_active_ms: number;
    avg_hidden_ms: number;
    avg_idle_ms: number;
    background_rate: number;
    invalid_rate: number;
    last_attempt_at: string;
  }>;
};

function sumCounts(obj: Record<string, number>) {
  return Object.values(obj).reduce((a, x) => a + x, 0);
}
function formatMs(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remain = sec % 60;
  return `${min}m ${remain}s`;
}
function topLabel(obj: Record<string, number>) {
  const entries = Object.entries(obj);
  if (!entries.length) return "—";
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

function LiveBar({
  sessionCount,
  recentCount,
  frozen,
  t
}: {
  sessionCount: number;
  recentCount: number;
  frozen: boolean;
  t: (k: string) => string;
}) {
  return (
    <div style={{
      display: "flex",
      flexWrap: "wrap",
      gap: 16,
      alignItems: "center",
      padding: "12px 16px",
      background: "var(--color-surface)",
      borderRadius: "var(--radius-sm)",
      border: "1px solid var(--color-border)",
      marginBottom: 8
    }}>
      <div className="live-dot">{frozen ? `⏸ ${t("admin.dashboard.frozen")}` : t("admin.dashboard.live")}</div>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", flex: 1 }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary)", textTransform: "uppercase" }}>{t("admin.dashboard.onlineSessions")}</span>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--color-text)" }}>{sessionCount}</div>
        </div>
        <div>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary)", textTransform: "uppercase" }}>{t("admin.dashboard.recentNew")}</span>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--color-success)" }}>+{recentCount}</div>
        </div>
      </div>
    </div>
  );
}

export function AdminDashboardNormalPage() {
  const { t } = useI18n();
  const token = getAdminToken();

  const [stage, setStage] = useState<"normal" | "active">("normal");
  const [frozen, setFrozen] = useState(false);
  const frozenRef = useRef(false);

  const [normalStats, setNormalStats] = useState<NormalStats>({ normal_manual: {}, normal_llm: {} });
  const [overallStats, setOverallStats] = useState<OverallStats>({
    overall: {},
    breakdown: { normal_manual: {}, normal_llm: {}, active_manual: {}, active_llm: {} }
  });
  const [sessions, setSessions] = useState<any[]>([]);
  const [behavior, setBehavior] = useState<BehaviorStats | null>(null);
  const [recentCount, setRecentCount] = useState(0);
  const recentQueue = useRef<number[]>([]);
  const totalRef = useRef(0);

  const [alRunId, setAlRunId] = useState("");
  const [alStatus, setAlStatus] = useState("");
  const [alParams, setAlParams] = useState({ candidate_k: 80, top_h: 40, sample_n: 3, active_m: 20, temperature: 0.7 });
  const [showAlParams, setShowAlParams] = useState(false);
  const [creatingShare, setCreatingShare] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const [shareCopied, setShareCopied] = useState(false);

  const lastRevisionRef = useRef(0);

  const loadSync = async () => {
    try {
      const sync = await api.adminGetStatsSync(token);
      lastRevisionRef.current = sync.revision ?? 0;
      if (!frozenRef.current) {
        setNormalStats(sync.normal);
        const o = sync.overall;
        setOverallStats({
          overall: o?.overall ?? {},
          breakdown: {
            normal_manual: o?.breakdown?.normal_manual ?? {},
            normal_llm: o?.breakdown?.normal_llm ?? {},
            active_manual: o?.breakdown?.active_manual ?? {},
            active_llm: o?.breakdown?.active_llm ?? {}
          }
        });
      }
      const [list, behaviorData] = await Promise.all([
        api.adminGetSessions(token),
        api.adminGetBehavior(token)
      ]);
      setSessions(list.sessions);
      setBehavior(behaviorData);
    } catch { /* ignore */ }
  };
  const load = loadSync;

  const recordAnnotation = () => {
    const now = Date.now();
    recentQueue.current.push(now);
    recentQueue.current = recentQueue.current.filter((ts) => now - ts < 30_000);
    setRecentCount(recentQueue.current.length);
  };

  const checkAlStatus = async (runId: string) => {
    const data = await api.adminGetAlStatus(runId, token);
    setAlStatus(data.status);
    if (data.status === "running" || data.status === "queued") {
      setTimeout(() => checkAlStatus(runId), 3000);
    } else {
      setAlRunId("");
      load();
    }
  };

  useEffect(() => {
    loadSync();
    let aborted = false;
    let ticker: ReturnType<typeof setInterval>;

    const connect = async () => {
      if (aborted) return;
      try {
        const r = await fetch(`${API_BASE}/api/stream/stats`, { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok || !r.body) return;
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (!aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split("\n\n");
          buf = parts.pop() ?? "";
          for (const part of parts) {
            const eventMatch = part.match(/event:\s*(\S+)/);
            const dataMatch = part.match(/data:\s*(.+)/s);
            if (eventMatch?.[1] === "stats_update" && dataMatch?.[1]) {
              try {
                const data = JSON.parse(dataMatch[1].trim());
                const rev = data.revision;
                if (typeof rev === "number" && rev !== lastRevisionRef.current + 1) {
                  await loadSync();
                  continue;
                }
                if (typeof rev === "number") lastRevisionRef.current = rev;
                if (frozenRef.current) continue;
                if (data.normal) {
                  const newTotal = sumCounts(data.normal.normal_manual) + sumCounts(data.normal.normal_llm);
                  if (newTotal > totalRef.current) recordAnnotation();
                  totalRef.current = newTotal;
                  setNormalStats(data.normal);
                }
                if (data.overall) {
                  const o = data.overall;
                  const newTotal2 = sumCounts(o.breakdown?.active_manual ?? {}) + sumCounts(o.breakdown?.active_llm ?? {});
                  if (newTotal2 > totalRef.current) recordAnnotation();
                  totalRef.current = newTotal2;
                  setOverallStats({
                    overall: o.overall ?? {},
                    breakdown: {
                      normal_manual: o.breakdown?.normal_manual ?? {},
                      normal_llm: o.breakdown?.normal_llm ?? {},
                      active_manual: o.breakdown?.active_manual ?? {},
                      active_llm: o.breakdown?.active_llm ?? {}
                    }
                  });
                }
              } catch (_) { /* ignore parse */ }
            }
          }
        }
      } catch (_) { /* stream error */ }
      if (!aborted) setTimeout(connect, 2000);
    };
    connect();

    ticker = setInterval(() => {
      const now = Date.now();
      recentQueue.current = recentQueue.current.filter((ts) => now - ts < 30_000);
      setRecentCount(recentQueue.current.length);
    }, 5000);

    return () => {
      aborted = true;
      clearInterval(ticker);
    };
  }, [token]);

  const toggleFreeze = () => {
    frozenRef.current = !frozenRef.current;
    setFrozen(frozenRef.current);
    if (!frozenRef.current) load();
  };

  const exportFullDataset = async (format: "csv" | "jsonl") => {
    try {
      const { blob, meta } = await api.adminExport(format, token);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `labeling_export_${Date.now()}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      if (meta?.truncated && meta?.hint) {
        alert(t("admin.dashboard.exportTruncated", { count: String(meta.count), hint: meta.hint }));
      }
    } catch {
      alert(t("admin.dashboard.exportFailed"));
    }
  };

  const exportSessionCsv = () => {
    const header = "user_id,session_id,normal_manual_done,normal_manual_total,normal_llm_done,normal_llm_total,active_manual_done,active_manual_total\n";
    const rows = sessions.map((s) => {
      const nm = s.counts.find((c: any) => c.phase === "normal" && c.task === "manual") || { done: 0, total: 0 };
      const nl = s.counts.find((c: any) => c.phase === "normal" && c.task === "llm") || { done: 0, total: 0 };
      const am = s.counts.find((c: any) => c.phase === "active" && c.task === "manual") || { done: 0, total: 0 };
      return `${s.user_id},${s.session_id},${nm.done},${nm.total},${nl.done},${nl.total},${am.done},${am.total}`;
    }).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `sessions_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };
  const createShareLink = async () => {
    if (creatingShare) return;
    try {
      setCreatingShare(true);
      const data = await api.adminCreateShare(token) as { share_token: string };
      const url = `${window.location.origin}/share/${data.share_token}`;
      setShareLink(url);
      setShareCopied(false);
    } catch {
      alert(t("common.error"));
    } finally {
      setCreatingShare(false);
    }
  };
  const copyShareLink = async () => {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      setShareCopied(false);
    }
  };

  const activeManual = overallStats.breakdown.active_manual;
  const activeLlm = overallStats.breakdown.active_llm;
  const normalManualStats = normalStats.normal_manual;
  const normalLlmStats = normalStats.normal_llm;

  const normalTotal = sumCounts(normalManualStats) + sumCounts(normalLlmStats);
  const activeTotal = sumCounts(activeManual) + sumCounts(activeLlm);

  const paramLabels: Record<string, string> = {
    candidate_k: t("admin.dashboard.candidatePool"),
    top_h: t("admin.dashboard.entropyTopH"),
    sample_n: t("admin.dashboard.sampleN"),
    active_m: t("admin.dashboard.selectCount"),
    temperature: t("admin.dashboard.sampleTemp")
  };

  return (
    <div style={{ minHeight: "100dvh", background: "var(--color-bg)" }}>
      <AdminNav />
      <div className="page-wide" style={{ paddingTop: 16 }}>

        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>{t("admin.dashboard.liveDashboard")}</h2>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button className={`freeze-btn ${frozen ? "frozen" : ""}`} onClick={toggleFreeze}>
                {frozen ? `⏸ ${t("admin.dashboard.frozenClick")}` : `⏸ ${t("admin.dashboard.freezeDisplay")}`}
              </button>
            </div>
          </div>

          <div className="tab-bar">
            <button className={`tab-btn ${stage === "normal" ? "active" : ""}`} onClick={() => setStage("normal")}>
              📊 {t("admin.dashboard.stage1Normal")}
              {normalTotal > 0 && <span className="badge green" style={{ marginLeft: 8 }}>{normalTotal}</span>}
            </button>
            <button className={`tab-btn ${stage === "active" ? "active" : ""}`} onClick={() => setStage("active")}>
              ⚡ {t("admin.dashboard.stage2Active")}
              {activeTotal > 0 && <span className="badge purple" style={{ marginLeft: 8 }}>{activeTotal}</span>}
            </button>
          </div>
        </div>

        <LiveBar sessionCount={sessions.length} recentCount={recentCount} frozen={frozen} t={t} />

        <div className="card" style={{ marginTop: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>{t("admin.dashboard.genShare")}</h3>
            <button className="btn primary" onClick={createShareLink} disabled={creatingShare}>
              {creatingShare ? t("common.loading") : t("admin.dashboard.genShare")}
            </button>
          </div>
          {shareLink && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input type="text" value={shareLink} readOnly style={{ flex: 1, minWidth: 300 }} />
              <button className="btn" onClick={copyShareLink}>
                {shareCopied ? t("admin.dashboard.copied") : t("admin.dashboard.copy")}
              </button>
              <a className="btn" href={shareLink} target="_blank" rel="noreferrer">
                {t("common.open")}
              </a>
            </div>
          )}
        </div>

        {behavior && (
          <div className="card" style={{ marginTop: 8 }}>
            <h3 style={{ marginBottom: 12 }}>{t("admin.dashboard.behaviorTitle")}</h3>
            <div className="dashboard-grid" style={{ marginBottom: 12 }}>
              <div className="metric-card"><div className="metric-label">{t("admin.dashboard.attempts")}</div><div className="metric-value">{behavior.overall.total_attempts}</div></div>
              <div className="metric-card"><div className="metric-label">{t("admin.dashboard.avgActive")}</div><div className="metric-value" style={{ fontSize: 22 }}>{formatMs(behavior.overall.avg_active_ms)}</div></div>
              <div className="metric-card"><div className="metric-label">{t("admin.dashboard.avgHidden")}</div><div className="metric-value" style={{ fontSize: 22 }}>{formatMs(behavior.overall.avg_hidden_ms)}</div></div>
              <div className="metric-card"><div className="metric-label">{t("admin.dashboard.avgIdle")}</div><div className="metric-value" style={{ fontSize: 22 }}>{formatMs(behavior.overall.avg_idle_ms)}</div></div>
              <div className="metric-card"><div className="metric-label">{t("admin.dashboard.backgroundRate")}</div><div className="metric-value" style={{ fontSize: 22 }}>{(behavior.overall.background_rate * 100).toFixed(1)}%</div></div>
              <div className="metric-card"><div className="metric-label">{t("admin.dashboard.invalidRate")}</div><div className="metric-value" style={{ fontSize: 22 }}>{(behavior.overall.invalid_rate * 100).toFixed(1)}%</div></div>
            </div>
            <div className="table-scroll-wrapper">
              <div className="table-scroll-inner">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t("admin.dashboard.byTask")}</th>
                      <th>{t("admin.dashboard.attempts")}</th>
                      <th>{t("admin.dashboard.avgActive")}</th>
                      <th>{t("admin.dashboard.backgroundRate")}</th>
                      <th>{t("admin.dashboard.invalidRate")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(behavior.by_task).map(([task, stat]) => (
                      <tr key={task}>
                        <td>{task}</td>
                        <td>{stat.total_attempts}</td>
                        <td>{formatMs(stat.avg_active_ms)}</td>
                        <td>{(stat.background_rate * 100).toFixed(1)}%</td>
                        <td>{(stat.invalid_rate * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <h4 style={{ margin: "14px 0 8px" }}>{t("admin.dashboard.bySession")}</h4>
            <div className="table-scroll-wrapper">
              <div className="table-scroll-inner">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t("admin.dashboard.user")}</th>
                      <th>{t("admin.dashboard.attempts")}</th>
                      <th>{t("admin.dashboard.backgroundRate")}</th>
                      <th>{t("admin.dashboard.invalidRate")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {behavior.by_session.slice(0, 8).map((row) => (
                      <tr key={row.session_id}>
                        <td>{row.user_id}</td>
                        <td>{row.total_attempts}</td>
                        <td>{(row.background_rate * 100).toFixed(1)}%</td>
                        <td>{(row.invalid_rate * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                    {behavior.by_session.length === 0 && (
                      <tr>
                        <td colSpan={4} style={{ textAlign: "center", color: "var(--color-text-muted)" }}>
                          {t("admin.ops.noData")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {stage === "normal" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 16 }}>
              <div className="chart-card">
                <div className="chart-header">
                  <div className="chart-title">{t("admin.dashboard.normalManualLabel")} (Normal Manual)</div>
                  {!frozen && <span className="live-dot">{t("admin.dashboard.live")}</span>}
                </div>
                <BarChart title="" counts={normalManualStats} noCard />
                <div style={{ marginTop: 12, fontSize: 13, color: "var(--color-text-secondary)" }}>
                  {t("admin.dashboard.total")}: <strong>{sumCounts(normalManualStats)}</strong> {t("admin.dashboard.items")}
                  {sumCounts(normalManualStats) > 0 && <> · Top: <strong>{topLabel(normalManualStats)}</strong></>}
                </div>
              </div>

              <div className="chart-card">
                <div className="chart-header">
                  <div className="chart-title">{t("admin.dashboard.normalLlmLabel")} (Normal LLM)</div>
                  {!frozen && <span className="live-dot">{t("admin.dashboard.live")}</span>}
                </div>
                <BarChart title="" counts={normalLlmStats} noCard />
                <div style={{ marginTop: 12, fontSize: 13, color: "var(--color-text-secondary)" }}>
                  {t("admin.dashboard.total")}: <strong>{sumCounts(normalLlmStats)}</strong> {t("admin.dashboard.items")}
                  {sumCounts(normalLlmStats) > 0 && <> · Top: <strong>{topLabel(normalLlmStats)}</strong></>}
                </div>
              </div>
            </div>

            {sumCounts(normalManualStats) > 0 && sumCounts(normalLlmStats) > 0 && (() => {
              const allLabels = Array.from(new Set([...Object.keys(normalManualStats), ...Object.keys(normalLlmStats)]));
              const mTotal = sumCounts(normalManualStats);
              const lTotal = sumCounts(normalLlmStats);
              const div = allLabels.reduce((acc, label) => {
                const p = (normalManualStats[label] ?? 0) / mTotal;
                const q = (normalLlmStats[label] ?? 0) / lTotal;
                return acc + Math.abs(p - q);
              }, 0) / 2;
              return (
                <div className="card" style={{ marginTop: 4 }}>
                  <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary)", textTransform: "uppercase" }}>{t("admin.dashboard.topManualLabel")}</div>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{topLabel(normalManualStats)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary)", textTransform: "uppercase" }}>{t("admin.dashboard.topModelLabel")}</div>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{topLabel(normalLlmStats)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary)", textTransform: "uppercase" }}>{t("admin.dashboard.divergenceIndex")}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: div > 0.3 ? "var(--color-error)" : "var(--color-success)" }}>
                        {div.toFixed(3)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </>
        )}

        {stage === "active" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 16 }}>
              <div className="chart-card">
                <div className="chart-header">
                  <div className="chart-title">{t("admin.dashboard.activeManualLabel")} (Active Manual)</div>
                  {!frozen && <span className="live-dot">{t("admin.dashboard.live")}</span>}
                </div>
                <BarChart title="" counts={activeManual} noCard />
                <div style={{ marginTop: 12, fontSize: 13, color: "var(--color-text-secondary)" }}>
                  {t("admin.dashboard.total")}: <strong>{sumCounts(activeManual)}</strong> {t("admin.dashboard.items")}
                </div>
              </div>
              <div className="chart-card">
                <div className="chart-header">
                  <div className="chart-title">{t("admin.dashboard.activeLlmLabel")}</div>
                  <span className="badge purple">{t("admin.dashboard.batchProcess")}</span>
                </div>
                <BarChart title="" counts={activeLlm} noCard />
                <div style={{ marginTop: 12, fontSize: 13, color: "var(--color-text-secondary)" }}>
                  {t("admin.dashboard.total")}: <strong>{sumCounts(activeLlm)}</strong> {t("admin.dashboard.items")}
                </div>
              </div>
            </div>

            <div className="card" style={{ marginTop: 4 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>⚡ {t("admin.dashboard.edAlTrigger")}</h3>
                <button
                  style={{ background: "none", border: "none", color: "var(--color-primary)", fontSize: 13, cursor: "pointer", fontWeight: 600 }}
                  onClick={() => setShowAlParams((s) => !s)}
                >
                  {showAlParams ? t("admin.dashboard.hideParams") : t("admin.dashboard.configParams")}
                </button>
              </div>

              {showAlParams && (
                <div className="form-row" style={{ marginBottom: 16 }}>
                  {(Object.keys(paramLabels) as (keyof typeof alParams)[]).map((key) => (
                    <div className="form-group" key={key} style={{ minWidth: 110 }}>
                      <label>{paramLabels[key]}</label>
                      <input
                        type="number"
                        value={alParams[key]}
                        min={key === "temperature" ? 0.1 : 1}
                        max={key === "temperature" ? 2 : 500}
                        step={key === "temperature" ? 0.1 : 1}
                        onChange={(e) => setAlParams((p) => ({ ...p, [key]: key === "temperature" ? parseFloat(e.target.value) : parseInt(e.target.value, 10) }))}
                        style={{ width: "100%" }}
                      />
                    </div>
                  ))}
                </div>
              )}

              {(() => {
                const edalCalls = alParams.candidate_k * alParams.sample_n;
                const activeLlmCalls = alParams.active_m * 2;
                const totalCalls = edalCalls + activeLlmCalls;
                return (
                  <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 12 }}>
                    Entropy + Diversity (TF-IDF k-center greedy).<br />
                    {t("admin.dashboard.estimatedCalls")}: <strong>{totalCalls}</strong> {t("admin.dashboard.callUnit")}
                    {` (ED-AL ${edalCalls} + Active LLM ${activeLlmCalls}). `}
                    {t("admin.dashboard.suggestBefore")} {Math.ceil(alParams.candidate_k * alParams.sample_n * 0.7 / 60)} {t("admin.dashboard.minutes")}.
                  </div>
                );
              })()}

              <button
                className={`btn ${alRunId ? "" : "primary"}`}
                disabled={!!alRunId}
                onClick={async () => {
                  const edalCalls = alParams.candidate_k * alParams.sample_n;
                  const activeLlmCalls = alParams.active_m * 2;
                  const totalCalls = edalCalls + activeLlmCalls;
                  if (totalCalls > 300 && !window.confirm(t("admin.dashboard.confirmCalls", { count: totalCalls }))) return;
                  const data = await api.adminRunAl(alParams.candidate_k, alParams.active_m, alParams, token);
                  setAlRunId(data.run_id);
                  setAlStatus(data.status);
                  checkAlStatus(data.run_id);
                }}
              >
                {alRunId
                  ? <>⏳ {t("admin.dashboard.alRunning", { status: alStatus })}<span className="spinner" style={{ width: 14, height: 14, borderWidth: 2, marginLeft: 8 }} /></>
                  : `▶ ${t("admin.dashboard.triggerEdAl")}`}
              </button>

              {alRunId && (
                <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 8 }}>
                  Run ID: {alRunId}
                </div>
              )}
            </div>
          </>
        )}

        <div className="card" style={{ marginTop: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <h3 style={{ margin: 0 }}>{t("admin.dashboard.participantProgress")}</h3>
            <div className="btn-group">
              <button className="btn" style={{ fontSize: 12 }} onClick={() => exportFullDataset("csv")}>{t("admin.dashboard.exportCsvShort")}</button>
              <button className="btn" style={{ fontSize: 12 }} onClick={() => exportFullDataset("jsonl")}>{t("admin.dashboard.exportJsonlShort")}</button>
              <button className="btn" style={{ fontSize: 12 }} onClick={exportSessionCsv}>{t("admin.dashboard.exportProgressCsv")}</button>
            </div>
          </div>
          <div className="table-scroll-wrapper">
            <div className="table-scroll-inner">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("admin.dashboard.user")}</th>
                  <th>Session</th>
                  <th>{t("admin.dashboard.normalManual")}</th>
                  <th>{t("admin.dashboard.normalLlm")}</th>
                  <th>{t("admin.dashboard.activeManual")}</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const nm = s.counts.find((c: any) => c.phase === "normal" && c.task === "manual");
                  const nl = s.counts.find((c: any) => c.phase === "normal" && c.task === "llm");
                  const am = s.counts.find((c: any) => c.phase === "active" && c.task === "manual");
                  const pct = (c: any) => c ? `${c.done}/${c.total}` : "—";
                  const isDone = (c: any) => c && c.done === c.total && c.total > 0;
                  return (
                    <tr key={s.session_id}>
                      <td><strong>{s.user_id}</strong>{s.duplicate_user && <span className="badge" style={{ marginLeft: 6, background: "var(--color-warning)", fontSize: 10 }}>{t("admin.dashboard.multiSession")}</span>}</td>
                      <td style={{ color: "var(--color-text-muted)", fontFamily: "monospace", fontSize: 12 }}>{s.session_id.slice(0, 8)}</td>
                      <td>{isDone(nm) ? <span className="badge green">{pct(nm)}</span> : <span>{pct(nm)}</span>}</td>
                      <td>{isDone(nl) ? <span className="badge green">{pct(nl)}</span> : <span>{pct(nl)}</span>}</td>
                      <td>{isDone(am) ? <span className="badge purple">{pct(am)}</span> : <span>{pct(am)}</span>}</td>
                    </tr>
                  );
                })}
                {sessions.length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--color-text-muted)" }}>{t("admin.dashboard.noSessions")}</td></tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
