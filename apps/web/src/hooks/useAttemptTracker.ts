import { useEffect, useRef } from "react";
import type { AttemptPayload } from "../lib/api";

const TICK_MS = 500;
const IDLE_THRESHOLD_MS = 10000;
const ACTIVITY_THROTTLE_MS = 300;
const MAX_EVENTS = 200;

type EventItem = { t_perf_ms: number; t_epoch_ms: number; type: string; payload_json?: string };

function pushEvent(events: EventItem[], item: EventItem) {
  if (events.length < MAX_EVENTS) events.push(item);
}

export function useAttemptTracker(unitKey: string) {
  const ref = useRef({
    shownAtEpoch: Date.now(),
    lastTickPerf: performance.now(),
    lastActivePerf: performance.now(),
    lastActivityEventPerf: 0,
    activeMs: 0,
    hiddenMs: 0,
    idleMs: 0,
    hiddenCount: 0,
    blurCount: 0,
    hadBackground: 0,
    visible: document.visibilityState === "visible",
    focused: document.hasFocus(),
    events: [] as EventItem[]
  });

  useEffect(() => {
    ref.current = {
      shownAtEpoch: Date.now(),
      lastTickPerf: performance.now(),
      lastActivePerf: performance.now(),
      lastActivityEventPerf: 0,
      activeMs: 0,
      hiddenMs: 0,
      idleMs: 0,
      hiddenCount: 0,
      blurCount: 0,
      hadBackground: 0,
      visible: document.visibilityState === "visible",
      focused: document.hasFocus(),
      events: [{ t_perf_ms: performance.now(), t_epoch_ms: Date.now(), type: "shown" }]
    };
  }, [unitKey]);

  useEffect(() => {
    const onVisibility = () => {
      const visible = document.visibilityState === "visible";
      ref.current.visible = visible;
      if (!visible) {
        ref.current.hiddenCount += 1;
        ref.current.hadBackground = 1;
      }
      pushEvent(ref.current.events, {
        t_perf_ms: performance.now(),
        t_epoch_ms: Date.now(),
        type: "visibility",
        payload_json: JSON.stringify({ visible })
      });
    };
    const onFocus = () => {
      ref.current.focused = true;
      pushEvent(ref.current.events, { t_perf_ms: performance.now(), t_epoch_ms: Date.now(), type: "focus" });
    };
    const onBlur = () => {
      ref.current.focused = false;
      ref.current.blurCount += 1;
      ref.current.hadBackground = 1;
      pushEvent(ref.current.events, { t_perf_ms: performance.now(), t_epoch_ms: Date.now(), type: "blur" });
    };
    const onActive = () => {
      const now = performance.now();
      ref.current.lastActivePerf = now;
      if (now - ref.current.lastActivityEventPerf > ACTIVITY_THROTTLE_MS) {
        ref.current.lastActivityEventPerf = now;
        pushEvent(ref.current.events, { t_perf_ms: now, t_epoch_ms: Date.now(), type: "activity" });
      }
    };
    const onPageHide = () => {
      ref.current.hadBackground = 1;
      pushEvent(ref.current.events, { t_perf_ms: performance.now(), t_epoch_ms: Date.now(), type: "pagehide" });
    };
    const onPageShow = () => {
      pushEvent(ref.current.events, { t_perf_ms: performance.now(), t_epoch_ms: Date.now(), type: "pageshow" });
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pointerdown", onActive);
    window.addEventListener("touchstart", onActive);
    window.addEventListener("keydown", onActive);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);

    const timer = setInterval(() => {
      const now = performance.now();
      const delta = now - ref.current.lastTickPerf;
      ref.current.lastTickPerf = now;
      if (!ref.current.visible || !ref.current.focused) {
        ref.current.hiddenMs += delta;
        return;
      }
      const idle = now - ref.current.lastActivePerf > IDLE_THRESHOLD_MS;
      if (idle) {
        ref.current.idleMs += delta;
      } else {
        ref.current.activeMs += delta;
      }
    }, TICK_MS);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pointerdown", onActive);
      window.removeEventListener("touchstart", onActive);
      window.removeEventListener("keydown", onActive);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [unitKey]);

  const finalize = (): AttemptPayload => {
    const answeredAt = Date.now();
    ref.current.events.push({ t_perf_ms: performance.now(), t_epoch_ms: answeredAt, type: "answer" });
    return {
      shown_at_epoch_ms: ref.current.shownAtEpoch,
      answered_at_epoch_ms: answeredAt,
      active_ms: Math.round(ref.current.activeMs),
      hidden_ms: Math.round(ref.current.hiddenMs),
      idle_ms: Math.round(ref.current.idleMs),
      hidden_count: ref.current.hiddenCount,
      blur_count: ref.current.blurCount,
      had_background: ref.current.hadBackground,
      events: ref.current.events
    };
  };

  return { finalize };
}
