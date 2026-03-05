import { Link, useLocation, useNavigate } from "react-router-dom";
import { useI18n } from "../lib/i18n";
import { clearAdminToken } from "../lib/storage";

export function AdminNav() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const nav = useNavigate();

  const navItems = [
    { to: "/admin/dashboard", label: t("admin.nav.dashboard") },
    { to: "/admin/ops", label: t("admin.nav.ops") },
    { to: "/admin/config", label: t("admin.nav.config") },
    { to: "/admin/units", label: t("admin.nav.units") },
  ];

  return (
    <nav className="admin-nav">
      <span style={{ fontWeight: 800, fontSize: 14, color: "var(--color-text)", marginRight: 8, flexShrink: 0 }}>
        Admin
      </span>
      {navItems.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className={pathname.startsWith(item.to) ? "active" : ""}
        >
          {item.label}
        </Link>
      ))}
      <button
        style={{ marginLeft: "auto", flexShrink: 0 }}
        onClick={() => {
          clearAdminToken();
          nav("/admin/login");
        }}
      >
        {t("admin.nav.logout")}
      </button>
    </nav>
  );
}
