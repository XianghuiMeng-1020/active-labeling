import { useLocation } from "react-router-dom";
import { useI18n, type Locale } from "../lib/i18n";

const locales: Locale[] = ["zh-Hans", "zh-Hant", "en"];

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  const { pathname } = useLocation();
  const isAdmin = pathname.startsWith("/admin");

  return (
    <div className={`lang-switcher ${isAdmin ? "admin" : ""}`}>
      <label htmlFor="lang-select">{t("lang.label")}</label>
      <select id="lang-select" value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
        {locales.map((item) => (
          <option key={item} value={item}>
            {t(`lang.${item}`)}
          </option>
        ))}
      </select>
    </div>
  );
}

