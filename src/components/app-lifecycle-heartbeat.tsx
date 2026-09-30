"use client";

import { useEffect } from "react";

const HEARTBEAT_INTERVAL_MS = 60_000;

export function AppLifecycleHeartbeat() {
  useEffect(() => {
    function sendHeartbeat() {
      void fetch("/api/lifecycle/heartbeat", {
        method: "POST",
        cache: "no-store",
      }).catch(() => undefined);
    }

    sendHeartbeat();

    const interval = window.setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    window.addEventListener("pageshow", sendHeartbeat);
    window.addEventListener("online", sendHeartbeat);
    document.addEventListener("visibilitychange", sendHeartbeat);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("pageshow", sendHeartbeat);
      window.removeEventListener("online", sendHeartbeat);
      document.removeEventListener("visibilitychange", sendHeartbeat);
    };
  }, []);

  return null;
}
