import { useState } from "react";
import { AdminNav } from "../../components/AdminNav";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { getAdminToken } from "../../lib/storage";

export function AdminUnitsPage() {
  const { t } = useI18n();
  const token = getAdminToken();
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  const [msgKind, setMsgKind] = useState<"success" | "error">("success");
  const [importing, setImporting] = useState(false);

  const importUnits = async () => {
    if (importing) return;
    try {
      setImporting(true);
      const units = text.split("\n").reduce<any[]>((acc, rawLine, idx) => {
        const line = rawLine.trim();
        if (!line) return acc;
        try {
          acc.push(JSON.parse(line));
          return acc;
        } catch {
          throw new Error(t("admin.units.invalidJsonLine", { line: idx + 1 }));
        }
      }, []);
      const data = await api.adminImportUnits(units, token);
      setMsg(t("admin.units.success", { count: data.imported }));
      setMsgKind("success");
    } catch (error) {
      setMsg(error instanceof Error ? error.message : t("common.error"));
      setMsgKind("error");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div style={{ minHeight: "100dvh", background: "var(--color-bg)" }}>
      <AdminNav />
      <div className="page-wide" style={{ paddingTop: 16 }}>
        <h2 style={{ marginBottom: 16 }}>{t("admin.units.title")}</h2>

        <div className="card">
          <p style={{ marginBottom: 12 }}>{t("admin.units.hint")}</p>
          <textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} disabled={importing} />
          <button className="btn primary" style={{ marginTop: 12 }} onClick={importUnits} disabled={importing}>
            {importing ? t("common.loading") : t("common.import")}
          </button>
          {msg && (
            <div className={msgKind === "success" ? "success-box" : "error-box"} style={{ marginTop: 12 }}>
              {msg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
