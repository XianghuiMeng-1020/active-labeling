import { useState } from "react";
import { API_BASE } from "../lib/api";
import { useI18n } from "../lib/i18n";

export function EnvDebugPanel() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [healthData, setHealthData] = useState<any>(null);
  const [pingData, setPingData] = useState<any>(null);

  const checkConnection = async () => {
    setChecking(true);
    try {
      const [health, ping] = await Promise.all([
        fetch(`${API_BASE}/api/health`).then((r) => r.json()),
        fetch(`${API_BASE}/api/llm/ping`, { method: "POST" }).then((r) => r.json())
      ]);
      setHealthData(health);
      setPingData(ping);
    } catch (error: any) {
      setHealthData({ error: error.message });
      setPingData({ error: error.message });
    } finally {
      setChecking(false);
    }
  };

  const pingOk = pingData?.provider && pingData?.provider !== "none" && pingData?.status === 200;

  return (
    <>
      <button className="debug-trigger" onClick={() => { setOpen(!open); if (!open && !healthData) checkConnection(); }} title="Debug">
        ⚙
      </button>

      {open && (
        <div className="debug-panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <strong style={{ fontSize: 13 }}>🔧 {t("debug.env")}</strong>
            <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", fontSize: 16, cursor: "pointer", color: "var(--color-text-muted)" }}>✕</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 10px", marginBottom: 12, fontSize: 12 }}>
            <span style={{ color: "var(--color-text-secondary)", fontWeight: 600 }}>{t("debug.apiBase")}:</span>
            <span style={{ wordBreak: "break-all" }}>{API_BASE || t("debug.viteProxy")}</span>
            <span style={{ color: "var(--color-text-secondary)", fontWeight: 600 }}>{t("debug.buildId")}:</span>
            <span>{healthData?.build ?? "—"}</span>
          </div>

          <button className="btn full-width" onClick={checkConnection} disabled={checking} style={{ marginBottom: 12 }}>
            {checking ? <span className="spinner" /> : `🔍 ${t("common.checkConnection")}`}
          </button>

          {healthData && (
            <div style={{ padding: 12, background: "var(--color-primary-light)", borderRadius: 10, marginBottom: 8 }}>
              <div style={{ fontSize: 12, marginBottom: 4 }}>
                Qwen Key: {healthData.qwen?.key_present ? "✅" : "❌"} &nbsp;
                Qwen URL: {healthData.qwen?.base_url_present ? "✅" : "❌"}
              </div>
            </div>
          )}

          {pingData && (
            <div style={{
              padding: 12,
              background: pingOk ? "var(--color-success-bg)" : "var(--color-error-bg)",
              borderRadius: 10,
              border: `1px solid ${pingOk ? "var(--color-success-border)" : "var(--color-error-border)"}`,
              fontSize: 12
            }}>
              <div>LLM: <strong>{pingData.provider ?? "—"}</strong> — Status: <strong>{pingData.status ?? "—"}</strong></div>
              {pingData.latency_ms !== undefined && <div>Latency: {pingData.latency_ms}ms</div>}
              {pingData.error_detail && <div style={{ color: "var(--color-error)", marginTop: 4 }}>{pingData.error_detail}</div>}
            </div>
          )}
        </div>
      )}
    </>
  );
}
