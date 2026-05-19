import { useEffect, useState } from "react";
import { pingHealth } from "../lib/api";
import { useI18n } from "../lib/i18n";

type State = "idle" | "checking" | "ok" | "fail" | "offline";

/**
 * Startup connectivity self-check.
 *
 * Fires once on mount, and again on `online` / `visibilitychange` events.
 * Hidden when the API is reachable; surfaces a friendly Chinese-first
 * banner with retry + diagnostic hints when blocked (most common in
 * mainland China when Cloudflare workers.dev/pages.dev is throttled).
 */
export function ConnectivityBanner() {
  const { t } = useI18n();
  const [state, setState] = useState<State>("idle");
  const [latency, setLatency] = useState<number | null>(null);
  const [errorDetail, setErrorDetail] = useState<string>("");
  const [hidden, setHidden] = useState(false);

  const check = async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setState("offline");
      return;
    }
    setState("checking");
    setErrorDetail("");
    try {
      const r = await pingHealth(8000);
      setLatency(r.latency_ms);
      setState("ok");
      setTimeout(() => setHidden(true), 800);
    } catch (e: any) {
      setLatency(null);
      const code = e?.code ?? "";
      const status = e?.status;
      setErrorDetail(
        code === "REQUEST_TIMEOUT"
          ? "TIMEOUT"
          : code === "NETWORK_OFFLINE"
            ? "OFFLINE"
            : status
              ? `HTTP ${status}`
              : "BLOCKED"
      );
      setState("fail");
      setHidden(false);
    }
  };

  useEffect(() => {
    void check();
    const onOnline = () => { void check(); };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void check();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (hidden && state === "ok") return null;
  if (state === "ok") {
    return (
      <div className="conn-banner conn-banner-ok" role="status" aria-live="polite">
        <span className="conn-dot conn-dot-ok" />
        <span>{t("conn.ok", { ms: latency ?? "" })}</span>
      </div>
    );
  }
  if (state === "checking" || state === "idle") {
    return (
      <div className="conn-banner conn-banner-checking" role="status" aria-live="polite">
        <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />
        <span>{t("conn.checking")}</span>
      </div>
    );
  }
  return (
    <div className="conn-banner conn-banner-fail" role="alert">
      <div className="conn-banner-row">
        <span className="conn-dot conn-dot-fail" />
        <strong>{t("conn.failTitle")}</strong>
        <button
          type="button"
          className="conn-retry"
          onClick={() => void check()}
        >
          {t("conn.retry")}
        </button>
      </div>
      <div className="conn-banner-detail">
        {state === "offline" ? t("conn.offlineHint") : t("conn.blockedHint")}
        <span className="conn-banner-code">[{errorDetail}]</span>
      </div>
    </div>
  );
}
