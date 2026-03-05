import { useEffect, useState } from "react";
import { useI18n } from "../lib/i18n";
import { clearDeadLetter, getDeadLetterCount } from "../lib/offlineQueue";

export function DeadLetterBanner() {
  const { t } = useI18n();
  const [count, setCount] = useState(0);

  const refresh = () => setCount(getDeadLetterCount());
  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("deadLetterChange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("deadLetterChange", refresh);
    };
  }, []);

  const handleClear = () => {
    clearDeadLetter();
    setCount(0);
  };

  if (count <= 0) return null;

  return (
    <div className="error-box" style={{ marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
      <span>{t("flow.deadLetterWarning", { count: String(count) })}</span>
      <button type="button" className="btn" onClick={handleClear}>{t("flow.clearDeadLetter")}</button>
    </div>
  );
}
