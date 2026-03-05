import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { setAdminSession } from "../../lib/storage";

export function AdminLoginPage() {
  const nav = useNavigate();
  const location = useLocation();
  const { t } = useI18n();
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const reason = (location.state as { reason?: string } | null)?.reason;
    if (reason === "expired") setMsg(t("admin.sessionExpired"));
    if (reason === "invalid") setMsg(t("admin.authInvalid"));
  }, [location.state, t]);

  const login = async () => {
    if (!token || loading) return;
    setLoading(true);
    setMsg("");
    try {
      const session = await api.adminLogin(token);
      setAdminSession(session.token, session.expires_at_epoch_ms);
      nav("/admin/dashboard/normal");
    } catch {
      setMsg(t("admin.authInvalid"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page" style={{ justifyContent: "center", minHeight: "100dvh" }}>
      <div className="hero-banner" style={{ marginBottom: 0 }}>
        <h1>{t("admin.loginTitle")}</h1>
        <p>Sentence Labeling Admin Console</p>
      </div>

      <div className="card" style={{ marginTop: -1 }}>
        <div className="form-group">
          <label>Admin Token</label>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Enter your ADMIN_TOKEN"
            onKeyDown={(e) => {
              if (e.key === "Enter" && token) {
                login();
              }
            }}
          />
        </div>
        {msg ? <div className="error-box" style={{ marginBottom: 12 }}>{msg}</div> : null}
        <button
          className="btn primary full-width lg"
          disabled={!token || loading}
          onClick={login}
        >
          {loading ? t("common.loading") : t("admin.loginBtn")}
        </button>
      </div>
    </div>
  );
}
