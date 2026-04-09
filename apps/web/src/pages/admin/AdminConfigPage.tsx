import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const [lockManual, setLockManual] = useState(false);
  const [lockLlm, setLockLlm] = useState(true);
  const [lockActive, setLockActive] = useState(true);
  const [lockSurvey, setLockSurvey] = useState(true);
  const [savingLocks, setSavingLocks] = useState(false);
  const [, setAlRunId] = useState<string | null>(null);
  const [alStatus, setAlStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [alDetail, setAlDetail] = useState<string>("");
  const alPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const localeTemplates = useMemo(() => getDefaultPromptTemplates(locale), [locale]);
  const prevLocaleTemplatesRef = useRef(localeTemplates);

  useEffect(() => {
    (async () => {
      const [tax, prompts, sessionCfg, locks] = await Promise.all([
        api.getTaxonomy(),
        api.getPrompts(),
        api.adminGetSessionConfig(token).catch(() => null),
        api.getPhaseLocks().catch(() => null)
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
      if (locks) {
        setLockManual(locks.lock_manual);
        setLockLlm(locks.lock_llm);
        setLockActive(locks.lock_active);
        setLockSurvey(locks.lock_survey);
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

  const [alProgress, setAlProgress] = useState<{ phase?: string; scoring?: string; difficulty?: string; active_llm?: string } | null>(null);

  const pollAlStatus = useCallback((runId: string) => {
    if (alPollRef.current) clearInterval(alPollRef.current);
    alPollRef.current = setInterval(async () => {
      try {
        const res = await api.adminGetAlStatus(runId, token) as { status: string; detail?: string; progress?: { phase: string; scoring: string; difficulty: string; active_llm: string } };
        if (res.status === "done") {
          setAlStatus("done");
          setAlProgress(null);
          try {
            const d = JSON.parse(res.detail ?? "{}");
            setAlDetail(`${t("al.doneDetail")}: ${d.selected ?? "?"} units selected (scored ${d.scored ?? "?"})`);
          } catch { setAlDetail(t("al.done")); }
          if (alPollRef.current) clearInterval(alPollRef.current);
        } else if (res.status === "error") {
          setAlStatus("error");
          setAlProgress(null);
          try {
            const d = JSON.parse(res.detail ?? "{}");
            setAlDetail(d.error ?? res.detail ?? t("common.error"));
          } catch { setAlDetail(res.detail ?? t("common.error")); }
          if (alPollRef.current) clearInterval(alPollRef.current);
        } else if (res.progress) {
          setAlProgress(res.progress);
          const p = res.progress;
          const phaseLabels: Record<string, string> = { scoring: "Entropy sampling", selecting: "Diversity selection", difficulty: "Difficulty assessment", active_llm: "Active LLM labeling" };
          const progressOf = p.phase === "scoring" ? p.scoring : p.phase === "difficulty" ? p.difficulty : p.phase === "active_llm" ? p.active_llm : "";
          setAlDetail(`${phaseLabels[p.phase] ?? p.phase}${progressOf ? ` (${progressOf})` : ""}`);
        }
      } catch { /* keep polling */ }
    }, 2000);
  }, [token, t]);

  useEffect(() => { return () => { if (alPollRef.current) clearInterval(alPollRef.current); }; }, []);

  const handleRunAl = async () => {
    if (alStatus === "running") return;
    setAlStatus("running");
    setAlDetail("");
    try {
      const res = await api.adminRunAl(15, activeM, { sample_n: 5, temperature: 0.9 }, token) as { run_id: string };
      setAlRunId(res.run_id);
      pollAlStatus(res.run_id);
    } catch (e: any) {
      setAlStatus("error");
      setAlDetail(e?.message ?? t("common.error"));
    }
  };

  const applyLocaleTemplates = () => {
    setPrompt1(localeTemplates.prompt1);
    setPrompt2(localeTemplates.prompt2);
    showMsg(t("admin.config.templateApplied"));
  };

  const toggleLock = async (key: "lock_manual" | "lock_llm" | "lock_active" | "lock_survey", current: boolean) => {
    if (savingLocks) return;
    const setters = { lock_manual: setLockManual, lock_llm: setLockLlm, lock_active: setLockActive, lock_survey: setLockSurvey };
    setters[key](!current);
    setSavingLocks(true);
    try {
      const res = await api.adminSetPhaseLocks({ [key]: !current }, token);
      setLockManual(res.lock_manual);
      setLockLlm(res.lock_llm);
      setLockActive(res.lock_active);
      setLockSurvey(res.lock_survey);
      showMsg(t("lock.saved"));
    } catch {
      setters[key](current);
      showMsg(t("common.error"), "error");
    } finally {
      setSavingLocks(false);
    }
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
          <h3>{t("lock.title")}</h3>
          <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 16 }}>{t("lock.hint")}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {([
              { key: "lock_manual" as const, label: t("lock.task1"), locked: lockManual },
              { key: "lock_llm" as const, label: t("lock.task2"), locked: lockLlm },
              { key: "lock_active" as const, label: t("lock.task3"), locked: lockActive },
              { key: "lock_survey" as const, label: t("lock.task4"), locked: lockSurvey },
            ]).map(({ key, label, locked }) => (
              <div key={key} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "12px 16px", borderRadius: 8,
                border: `1px solid ${locked ? "var(--color-border)" : "var(--color-success)"}`,
                background: locked ? "var(--color-bg-secondary)" : "rgba(16, 185, 129, 0.08)"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 18 }}>{locked ? "🔒" : "🔓"}</span>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{label}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{
                    fontSize: 12, fontWeight: 600,
                    color: locked ? "var(--color-text-muted)" : "var(--color-success)"
                  }}>
                    {locked ? t("lock.locked") : t("lock.unlocked")}
                  </span>
                  <button
                    className={`btn ${locked ? "primary" : ""}`}
                    style={{ padding: "6px 16px", fontSize: 12, minWidth: 72 }}
                    onClick={() => toggleLock(key, locked)}
                    disabled={savingLocks}
                  >
                    {locked ? "🔓" : "🔒"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <h3>{t("al.title")}</h3>
          <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 16 }}>{t("al.hint")}</p>

          <div style={{
            padding: "16px", borderRadius: 10,
            border: `1px solid ${alStatus === "done" ? "var(--color-success)" : alStatus === "error" ? "#ef4444" : "var(--color-border)"}`,
            background: alStatus === "done" ? "rgba(16,185,129,0.06)" : alStatus === "error" ? "rgba(239,68,68,0.06)" : "var(--color-bg-secondary)"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <span style={{ fontSize: 24 }}>
                {alStatus === "idle" ? "⚡" : alStatus === "running" ? "⏳" : alStatus === "done" ? "✅" : "❌"}
              </span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {alStatus === "idle" ? t("al.notRun") : alStatus === "running" ? t("al.running") : alStatus === "done" ? t("al.done") : t("al.error")}
                </div>
                {alDetail && <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 2 }}>{alDetail}</div>}
              </div>
            </div>

            {alStatus === "running" && (() => {
              let pct = 0;
              if (alProgress) {
                const parse = (s?: string) => { const m = s?.match(/^(\d+)\/(\d+)$/); return m ? [Number(m[1]), Number(m[2])] : [0, 0]; };
                const [sI, sT] = parse(alProgress.scoring);
                const [dI, dT] = parse(alProgress.difficulty);
                const [aI, aT] = parse(alProgress.active_llm);
                const total = sT + (dT || sT * 0.3) + (aT || sT * 0.5);
                const done = sI + (alProgress.phase === "selecting" ? sT : 0)
                  + (["difficulty", "active_llm"].includes(alProgress.phase ?? "") ? sT : 0) + dI
                  + (alProgress.phase === "active_llm" ? (dT || 0) : 0) + aI;
                pct = total > 0 ? Math.min(98, Math.round((done / total) * 100)) : 2;
              }
              return (
                <div style={{ height: 6, borderRadius: 3, background: "var(--color-border)", overflow: "hidden", marginBottom: 12 }}>
                  <div style={{
                    height: "100%", borderRadius: 3,
                    background: "var(--color-primary)",
                    transition: "width 0.5s ease",
                    width: pct > 0 ? `${pct}%` : "3%",
                    ...(pct === 0 ? { animation: "al-progress 2s ease-in-out infinite" } : {})
                  }} />
                </div>
              );
            })()}

            <button
              className="btn primary full-width"
              onClick={handleRunAl}
              disabled={alStatus === "running"}
              style={{ fontSize: 14, padding: "10px 0" }}
            >
              {alStatus === "running" ? (
                <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2, marginRight: 8 }} />{t("al.running")}</>
              ) : alStatus === "done" ? t("al.rerun") : t("al.runButton")}
            </button>

            {alStatus === "done" && lockActive && (
              <button
                className="btn full-width"
                style={{ marginTop: 8, fontSize: 13, background: "rgba(16,185,129,0.1)", border: "1px solid var(--color-success)", color: "#059669" }}
                onClick={() => toggleLock("lock_active", true)}
                disabled={savingLocks}
              >
                🔓 {t("al.unlockActive")}
              </button>
            )}
          </div>
        </div>

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
