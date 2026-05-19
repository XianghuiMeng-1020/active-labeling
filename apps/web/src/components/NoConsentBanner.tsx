import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { getSessionId } from "../lib/storage";

// Module-level cache (per page load): consent is immutable for the life of a
// session, so we only ever need to fetch it once per session_id. This prevents
// hammering /api/session/status on every route change across the app.
const consentCache = new Map<string, boolean>();
const consentInflight = new Map<string, Promise<boolean | null>>();

async function resolveConsent(sid: string): Promise<boolean | null> {
  if (consentCache.has(sid)) return consentCache.get(sid)!;
  if (consentInflight.has(sid)) return consentInflight.get(sid)!;
  const p = (async () => {
    try {
      const s: any = await api.getSessionStatus(sid);
      if (s?.session_exists === false) return null;
      const has = s?.has_consent !== false;
      consentCache.set(sid, has);
      return has;
    } catch {
      return null;
    } finally {
      consentInflight.delete(sid);
    }
  })();
  consentInflight.set(sid, p);
  return p;
}

/**
 * Shown on every user-facing page when the active session opted out of
 * data collection (`has_consent = 0`). Reminds participants that their
 * actions are not being recorded — primarily a transparency / debugging aid
 * during workshop testing so people can clearly see "B" mode is active.
 */
export function NoConsentBanner() {
  const { t } = useI18n();
  const [hasConsent, setHasConsent] = useState<boolean | null>(null);

  useEffect(() => {
    const sid = getSessionId();
    if (!sid) {
      setHasConsent(null);
      return;
    }
    let cancelled = false;
    resolveConsent(sid).then((res) => {
      if (!cancelled) setHasConsent(res);
    });
    return () => { cancelled = true; };
  }, []);

  if (hasConsent !== false) return null;
  return (
    <div className="no-consent-banner" role="status">
      <span style={{ fontSize: 14 }}>🔒</span>
      <span style={{ flex: 1 }}>{t("consent.notCollecting")}</span>
    </div>
  );
}
