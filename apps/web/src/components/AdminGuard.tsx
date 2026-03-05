import { useEffect, useRef, useState, type ReactElement } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../lib/api";
import { clearAdminSession, getAdminSessionStatus, getAdminToken, touchAdminSession } from "../lib/storage";

function readAuth() {
  return { token: getAdminToken(), session: getAdminSessionStatus() };
}

export function AdminGuard({ children }: { children: ReactElement }) {
  const [auth, setAuth] = useState(readAuth);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [expiredOrMissing, setExpiredOrMissing] = useState<boolean>(false);
  const { token, session } = auth;
  const didClearRef = useRef(false);

  useEffect(() => {
    const onStorage = () => setAuth(readAuth());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    const onActivity = () => touchAdminSession();
    window.addEventListener("pointerdown", onActivity);
    window.addEventListener("keydown", onActivity);
    return () => {
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
    };
  }, []);

  useEffect(() => {
    if (!token || session.isExpired || session.isIdleExpired) {
      if (!didClearRef.current) {
        didClearRef.current = true;
        clearAdminSession();
      }
      setExpiredOrMissing(true);
      return;
    }
    let cancelled = false;
    api.adminVerify()
      .then(() => {
        if (!cancelled) {
          touchAdminSession();
          setVerified(true);
        }
      })
      .catch(() => {
        clearAdminSession();
        if (!cancelled) setVerified(false);
      });
    return () => { cancelled = true; };
  }, [token, session.isExpired, session.isIdleExpired]);

  if (expiredOrMissing) return <Navigate to="/admin/login" replace state={{ reason: "expired" }} />;
  if (!token) return null;
  if (verified === null) return null;
  if (!verified) return <Navigate to="/admin/login" replace state={{ reason: "invalid" }} />;
  return children;
}
