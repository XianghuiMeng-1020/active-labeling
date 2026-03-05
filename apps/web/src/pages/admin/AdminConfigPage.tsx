import { useEffect, useMemo, useRef, useState } from "react";
import { AdminNav } from "../../components/AdminNav";
import { api } from "../../lib/api";
import { getDefaultPromptTemplates, useI18n } from "../../lib/i18n";
import { getAdminToken } from "../../lib/storage";

export function AdminConfigPage() {
  const { t, locale } = useI18n();
  const token = getAdminToken();
  const [taxonomyText, setTaxonomyText] = useState("");
  const [prompt1, setPrompt1] = useState("");
  const [prompt2, setPrompt2] = useState("");
  const [normalN, setNormalN] = useState(6);
  const [activeM, setActiveM] = useState(4);
  const [msg, setMsg] = useState("");
  const [msgKind, setMsgKind] = useState<"success" | "error">("success");
  const [savingTaxonomy, setSavingTaxonomy] = useState(false);
  const [savingPrompts, setSavingPrompts] = useState(false);
  const [savingSession, setSavingSession] = useState(false);
  const localeTemplates = useMemo(() => getDefaultPromptTemplates(locale), [locale]);
  const prevLocaleTemplatesRef = useRef(localeTemplates);

  useEffect(() => {
    (async () => {
      const [tax, prompts, sessionCfg] = await Promise.all([
        api.getTaxonomy(),
        api.getPrompts(),
        api.adminGetSessionConfig(token).catch(() => null)
      ]);
      setTaxonomyText(
        tax.labels
          .map((x: any) => `${x.label}${x.description ? `|${x.description}` : ""}`)
          .join("\n")
      );
      setPrompt1(prompts.prompt1?.trim() ? prompts.prompt1 : localeTemplates.prompt1);
      setPrompt2(prompts.prompt2?.trim() ? prompts.prompt2 : localeTemplates.prompt2);
      if (sessionCfg) {
        setNormalN(sessionCfg.normal_n);
        setActiveM(sessionCfg.active_m);
      }
    })();
  }, [localeTemplates.prompt1, localeTemplates.prompt2]);

  useEffect(() => {
    const prev = prevLocaleTemplatesRef.current;
    const shouldSyncPrompt1 = !prompt1.trim() || prompt1 === prev.prompt1;
    const shouldSyncPrompt2 = !prompt2.trim() || prompt2 === prev.prompt2;
    if (shouldSyncPrompt1) setPrompt1(localeTemplates.prompt1);
    if (shouldSyncPrompt2) setPrompt2(localeTemplates.prompt2);
    prevLocaleTemplatesRef.current = localeTemplates;
  }, [locale, localeTemplates, prompt1, prompt2]);

  const showMsg = (text: string, kind: "success" | "error" = "success") => {
    setMsg(text);
    setMsgKind(kind);
    setTimeout(() => setMsg(""), 4000);
  };

  const saveTaxonomy = async () => {
    if (savingTaxonomy) return;
    try {
      setSavingTaxonomy(true);
      const labels = taxonomyText
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((line) => {
          const [label, description] = line.split("|");
          return { label, description };
        });
      await api.adminSetTaxonomy(labels, token);
      showMsg(t("admin.config.taxonomySaved"));
    } catch {
      showMsg(t("common.error"), "error");
    } finally {
      setSavingTaxonomy(false);
    }
  };

  const savePrompts = async () => {
    if (savingPrompts) return;
    try {
      setSavingPrompts(true);
      await api.adminSetPrompts(prompt1, prompt2, token);
      showMsg(t("admin.config.promptsSaved"));
    } catch {
      showMsg(t("common.error"), "error");
    } finally {
      setSavingPrompts(false);
    }
  };

  const saveSessionConfig = async () => {
    if (savingSession) return;
    try {
      setSavingSession(true);
      await api.adminSetSessionConfig({ normal_n: normalN, active_m: activeM }, token);
      showMsg(t("admin.config.sessionSaved"));
    } catch {
      showMsg(t("common.error"), "error");
    } finally {
      setSavingSession(false);
    }
  };

  const applyLocaleTemplates = () => {
    setPrompt1(localeTemplates.prompt1);
    setPrompt2(localeTemplates.prompt2);
    showMsg(t("admin.config.templateApplied"));
  };

  return (
    <div style={{ minHeight: "100dvh", background: "var(--color-bg)" }}>
      <AdminNav />
      <div className="page-wide" style={{ paddingTop: 16 }}>
        <h2 style={{ marginBottom: 16 }}>{t("admin.config.title")}</h2>

        {msg && (
          <div className={msgKind === "success" ? "success-box" : "error-box"} style={{ marginBottom: 16 }}>
            {msg}
          </div>
        )}

        <div className="card" style={{ marginBottom: 16 }}>
          <h3>{t("admin.config.sessionTitle")}</h3>
          <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 12 }}>{t("admin.config.sessionHint")}</p>
          <div className="form-row">
            <div className="form-group">
              <label>{t("admin.config.normalN")}</label>
              <input
                type="number" min={1} max={500} step={1} value={normalN}
                onChange={(e) => setNormalN(Number(e.target.value))}
                onBlur={() => { if (!Number.isFinite(normalN) || normalN < 1) setNormalN(1); }}
                disabled={savingSession}
              />
            </div>
            <div className="form-group">
              <label>{t("admin.config.activeM")}</label>
              <input
                type="number" min={0} max={200} step={1} value={activeM}
                onChange={(e) => setActiveM(Number(e.target.value))}
                onBlur={() => { if (!Number.isFinite(activeM) || activeM < 0) setActiveM(0); }}
                disabled={savingSession}
              />
            </div>
          </div>
          <button className="btn primary" style={{ marginTop: 12 }} onClick={saveSessionConfig} disabled={savingSession}>
            {savingSession ? t("common.loading") : t("admin.config.saveSession")}
          </button>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <h3>{t("admin.config.taxonomyHint")}</h3>
          <textarea rows={8} value={taxonomyText} onChange={(e) => setTaxonomyText(e.target.value)} disabled={savingTaxonomy} />
          <button className="btn primary" style={{ marginTop: 12 }} onClick={saveTaxonomy} disabled={savingTaxonomy}>
            {savingTaxonomy ? t("common.loading") : t("admin.config.saveTaxonomy")}
          </button>
        </div>

        <div className="card">
          <h3>{t("admin.config.prompt1")}</h3>
          <textarea rows={6} value={prompt1} onChange={(e) => setPrompt1(e.target.value)} disabled={savingPrompts} />
          <h3 style={{ marginTop: 16 }}>{t("admin.config.prompt2")}</h3>
          <textarea rows={6} value={prompt2} onChange={(e) => setPrompt2(e.target.value)} disabled={savingPrompts} />
          <div className="btn-group" style={{ marginTop: 12 }}>
            <button className="btn" onClick={applyLocaleTemplates} disabled={savingPrompts}>
              {t("admin.config.applyLocaleTemplate")}
            </button>
            <button className="btn primary" onClick={savePrompts} disabled={savingPrompts}>
              {savingPrompts ? t("common.loading") : t("admin.config.savePrompts")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
