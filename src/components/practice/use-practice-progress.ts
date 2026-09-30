"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { GuitarViewMode, InstrumentMode } from "@/lib/domain/types";

type PracticeProgressInput = {
  workId: string;
  pageIndex: number | null;
  objectId: string | null;
  measure: number | null;
  instrumentMode: InstrumentMode;
  guitarViewMode: GuitarViewMode;
  isPlaying: boolean;
};

// Keep selection versions ordered even for multiple changes in one millisecond.
let lastProgressTimestampMs = 0;

export function usePracticeProgress({
  workId,
  pageIndex,
  objectId,
  measure,
  instrumentMode,
  guitarViewMode,
  isPlaying,
}: PracticeProgressInput) {
  const [error, setError] = useState<string | null>(null);
  const snapshot = useMemo(() => {
    if (pageIndex === null) {
      return null;
    }

    const payload = {
      lastPageIndex: pageIndex,
      lastObjectId: objectId,
      lastMeasure: measure,
      instrumentMode,
      guitarViewMode,
    };

    return { workId, payload, key: `${workId}:${JSON.stringify(payload)}` };
  }, [guitarViewMode, instrumentMode, measure, objectId, pageIndex, workId]);
  const latestRef = useRef<(NonNullable<typeof snapshot> & { observedAt: string }) | null>(null);
  const savedKeyRef = useRef<string | null>(null);
  const pendingKeyRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(false);

  // Capture the committed selection before a page-hide or unmount can flush it.
  useLayoutEffect(() => {
    if (!snapshot) {
      latestRef.current = null;
      return;
    }

    lastProgressTimestampMs = Math.max(Date.now(), lastProgressTimestampMs + 1);
    latestRef.current = {
      ...snapshot,
      observedAt: new Date(lastProgressTimestampMs).toISOString(),
    };
  }, [snapshot]);

  const save = useCallback(async () => {
    const progress = latestRef.current;

    if (
      !progress ||
      progress.key === savedKeyRef.current ||
      progress.key === pendingKeyRef.current
    ) {
      return;
    }

    const requestId = ++requestIdRef.current;
    pendingKeyRef.current = progress.key;
    savedKeyRef.current = null;
    let nextError: string | null = null;

    try {
      const response = await fetch(`/api/works/${progress.workId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...progress.payload, observedAt: progress.observedAt }),
        // An ordinary save may still be in flight when the user leaves.
        keepalive: true,
      });

      if (!response.ok) {
        nextError = "保存查看位置失败，不过当前页面还能继续用。";
      }
    } catch {
      nextError = "保存查看位置失败，请检查本地服务后再试。";
    }

    if (requestId !== requestIdRef.current) {
      return;
    }

    pendingKeyRef.current = null;
    if (!nextError) {
      savedKeyRef.current = progress.key;
    }
    if (mountedRef.current && latestRef.current?.key === progress.key) {
      setError(nextError);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const flush = () => { void save(); };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flush();
      }
    };

    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      mountedRef.current = false;
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      flush();
    };
  }, [save]);

  useEffect(() => {
    if (!snapshot || isPlaying) {
      return;
    }

    const timeoutId = window.setTimeout(() => { void save(); }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [isPlaying, save, snapshot]);

  return { error };
}
