import { useEffect, useRef } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import "./App.css";
import { AdminGuard } from "./components/AdminGuard";
import { ConnectivityBanner } from "./components/ConnectivityBanner";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import { api } from "./lib/api";
import { ENABLE_ACTIVE_LEARNING } from "./lib/featureFlags";
import { getSessionId, getConsent } from "./lib/storage";
import { AdminConfigPage } from "./pages/admin/AdminConfigPage";
import { AdminDashboardNormalPage } from "./pages/admin/AdminDashboardNormalPage";
import { AdminDashboardOverallPage } from "./pages/admin/AdminDashboardOverallPage";
import { AdminLoginPage } from "./pages/admin/AdminLoginPage";
import { AdminUnitsPage } from "./pages/admin/AdminUnitsPage";
import { AdminOpsPage } from "./pages/admin/AdminOpsPage";
import { WelcomePage } from "./pages/user/WelcomePage";
import { UserActiveManualPage } from "./pages/user/UserActiveManualPage";
import { UserActiveLlmPage } from "./pages/user/UserActiveLlmPage";
import { UserNormalLlmPage } from "./pages/user/UserNormalLlmPage";
import { UserPhaseManualPage } from "./pages/user/UserPhaseManualPage";
import { UserVisualizationPage } from "./pages/user/UserVisualizationPage";
import { SharePage } from "./pages/share/SharePage";
import { UserStartPage } from "./pages/user/UserStartPage";
import { UserSurveyPage } from "./pages/user/UserSurveyPage";

function App() {
  const location = useLocation();
  const pathnameRef = useRef<string | null>(null);
  const enteredAtRef = useRef<number | null>(null);

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      if (!getConsent()) return;
      api.reportClientError({
        message: event.message || "window_error",
        stack: event.error?.stack,
        page: window.location.href
      }).catch(() => undefined);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      if (!getConsent()) return;
      const reason = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
      api.reportClientError({
        message: `unhandled_rejection: ${reason.message}`,
        stack: reason.stack,
        page: window.location.href
      }).catch(() => undefined);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  // Record page view time: enter on pathname, leave on pathname change or unmount.
  // We also emit a best-effort leave via sendBeacon on REAL unloads (pagehide with
  // persisted=false) so a hard tab close doesn't strand the row with left_at_epoch_ms
  // NULL. For bfcache transitions (pagehide persisted=true → pageshow persisted=true),
  // we keep the page-view OPEN: iOS Safari and Chrome both reuse the same DOM, so the
  // user is still on the same logical view. Emitting a leave there would create rows
  // that look like the user vanished and never came back.
  useEffect(() => {
    const sessionId = getSessionId();
    const path = location.pathname;
    if (!sessionId || !path || !getConsent()) return;
    const entered = Date.now();
    pathnameRef.current = path;
    enteredAtRef.current = entered;
    api.recordPageViewEnter(sessionId, path, entered).catch(() => undefined);

    const sendLeave = (useBeacon: boolean) => {
      const p = pathnameRef.current;
      if (!p) return;
      pathnameRef.current = null;
      enteredAtRef.current = null;
      const payload = { session_id: sessionId, page_path: p, left_at_epoch_ms: Date.now() };
      if (useBeacon && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        try {
          // Beacons survive page unload even when the document is being torn down;
          // perfect for unloads. Use a Blob with the correct MIME type so the worker
          // parses it as JSON.
          const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
          const ok = navigator.sendBeacon("/api/page-view/leave", blob);
          if (ok) return;
        } catch { /* fall through to fetch */ }
      }
      api.recordPageViewLeave(sessionId, p, payload.left_at_epoch_ms).catch(() => undefined);
    };

    const onPageHide = (event: PageTransitionEvent) => {
      // event.persisted === true ⇒ page went into the back-forward cache. The DOM is
      // alive, no real "leave". When the user comes back, only `pageshow` fires (no
      // remount). If we sent a leave here, we'd produce a permanent enter/leave row
      // with no follow-up enter when they return.
      if (event.persisted) return;
      sendLeave(true);
    };
    const onPageShow = (event: PageTransitionEvent) => {
      // Restored from bfcache: re-open a page-view row so we keep tracking continuously.
      // We don't re-open on plain initial loads — the effect body above already did that.
      if (!event.persisted) return;
      if (pathnameRef.current) return; // already open (shouldn't happen, but be safe)
      const reEntered = Date.now();
      pathnameRef.current = path;
      enteredAtRef.current = reEntered;
      api.recordPageViewEnter(sessionId, path, reEntered).catch(() => undefined);
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      sendLeave(false);
    };
  }, [location.pathname]);

  return (
    <>
      <LanguageSwitcher />
      <ConnectivityBanner />
      <Routes>
        {/* User routes */}
        <Route path="/" element={<Navigate to="/welcome" replace />} />
        <Route path="/welcome" element={<WelcomePage />} />
        <Route path="/user/start" element={<UserStartPage />} />
        <Route path="/user/normal/manual" element={<UserPhaseManualPage phase="normal" />} />
        <Route path="/user/normal/llm" element={<UserNormalLlmPage />} />
        <Route path="/user/visualization" element={<UserVisualizationPage />} />
        {ENABLE_ACTIVE_LEARNING && (
          <>
            <Route path="/user/active/manual" element={<UserActiveManualPage />} />
            <Route path="/user/active/llm" element={<UserActiveLlmPage />} />
          </>
        )}
        <Route path="/user/survey" element={<UserSurveyPage />} />

        {/* Admin routes — all protected by AdminGuard */}
        <Route path="/admin" element={<Navigate to="/admin/login" replace />} />
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route
          path="/admin/dashboard"
          element={
            <AdminGuard>
              <AdminDashboardNormalPage />
            </AdminGuard>
          }
        />
        <Route
          path="/admin/dashboard/normal"
          element={
            <AdminGuard>
              <AdminDashboardNormalPage />
            </AdminGuard>
          }
        />
        <Route
          path="/admin/dashboard/overall"
          element={
            <AdminGuard>
              <AdminDashboardOverallPage />
            </AdminGuard>
          }
        />
        <Route
          path="/admin/config"
          element={
            <AdminGuard>
              <AdminConfigPage />
            </AdminGuard>
          }
        />
        <Route
          path="/admin/units"
          element={
            <AdminGuard>
              <AdminUnitsPage />
            </AdminGuard>
          }
        />
        <Route
          path="/admin/ops"
          element={
            <AdminGuard>
              <AdminOpsPage />
            </AdminGuard>
          }
        />

        {/* Share route — public, read-only */}
        <Route path="/share/:token" element={<SharePage />} />

        <Route path="*" element={<Navigate to="/welcome" replace />} />
      </Routes>
    </>
  );
}

export default App;
