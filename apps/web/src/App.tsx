import { useEffect, useRef } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import "./App.css";
import { AdminGuard } from "./components/AdminGuard";
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

  // Record page view time: enter on pathname, leave on pathname change or unmount
  useEffect(() => {
    const sessionId = getSessionId();
    const path = location.pathname;
    if (!sessionId || !path || !getConsent()) return;
    const entered = Date.now();
    pathnameRef.current = path;
    api.recordPageViewEnter(sessionId, path, entered).catch(() => undefined);
    return () => {
      if (pathnameRef.current) {
        api.recordPageViewLeave(sessionId, pathnameRef.current, Date.now()).catch(() => undefined);
        pathnameRef.current = null;
      }
    };
  }, [location.pathname]);

  return (
    <>
      <LanguageSwitcher />
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
