import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePracticeProgress } from "@/components/practice/use-practice-progress";

const initialProgress = {
  workId: "work_1",
  pageIndex: 0,
  objectId: "note_a",
  measure: 1,
  instrumentMode: "piano" as const,
  guitarViewMode: "recommended" as const,
  isPlaying: false,
};

describe("usePracticeProgress", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("debounces ordinary saves and does not resend a saved position on exit", async () => {
    const { rerender, unmount } = renderHook(usePracticeProgress, {
      initialProps: initialProgress,
    });

    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(fetch).not.toHaveBeenCalled();
    rerender({ ...initialProgress, objectId: "note_b", measure: 2 });
    await act(async () => vi.advanceTimersByTimeAsync(249));
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));

    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/works/work_1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: expect.any(String),
    });
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body).toEqual({
      lastPageIndex: 0,
      lastObjectId: "note_b",
      lastMeasure: 2,
      instrumentMode: "piano",
      guitarViewMode: "recommended",
      observedAt: expect.any(String),
    });
    act(() => window.dispatchEvent(new Event("pagehide")));
    unmount();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("flushes the latest selection when unmounted before the debounce expires", () => {
    const { rerender, unmount } = renderHook(usePracticeProgress, {
      initialProps: initialProgress,
    });
    rerender({ ...initialProgress, pageIndex: 1, objectId: "note_c", measure: 3 });
    unmount();

    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/works/work_1", expect.objectContaining({
      keepalive: true,
      body: expect.stringContaining('"lastObjectId":"note_c"'),
    }));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("flushes the last playback note on pagehide without saving every note", async () => {
    const { rerender, unmount } = renderHook(usePracticeProgress, {
      initialProps: { ...initialProgress, isPlaying: true },
    });
    rerender({ ...initialProgress, objectId: "note_b", isPlaying: true });
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(fetch).not.toHaveBeenCalled();

    await act(async () => { window.dispatchEvent(new Event("pagehide")); });
    unmount();

    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/works/work_1", expect.objectContaining({
      keepalive: true,
      body: expect.stringContaining('"lastObjectId":"note_b"'),
    }));
  });

  it("retries an unsuccessful save when the page becomes hidden", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
    const { result, unmount } = renderHook(usePracticeProgress, {
      initialProps: initialProgress,
    });
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(result.current.error).toBe("保存查看位置失败，不过当前页面还能继续用。");

    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
    unmount();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("ignores old responses and does not duplicate the current in-flight save", async () => {
    let failFirst!: (reason: Error) => void;
    let finishLatest!: (response: Response) => void;
    vi.mocked(fetch)
      .mockImplementationOnce(() => new Promise((_, reject) => { failFirst = reject; }))
      .mockImplementationOnce(() => new Promise((resolve) => { finishLatest = resolve; }));
    const { result, rerender, unmount } = renderHook(usePracticeProgress, {
      initialProps: initialProgress,
    });
    await act(async () => vi.advanceTimersByTimeAsync(250));
    rerender({ ...initialProgress, objectId: "note_b" });
    await act(async () => vi.advanceTimersByTimeAsync(250));
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(fetch).toHaveBeenCalledTimes(2);

    await act(async () => { finishLatest({ ok: false } as Response); });
    expect(result.current.error).toBe("保存查看位置失败，不过当前页面还能继续用。");
    await act(async () => { failFirst(new Error("offline")); });
    expect(result.current.error).toBe("保存查看位置失败，不过当前页面还能继续用。");
    unmount();
  });

  it("does not save when no page is available", async () => {
    const { unmount } = renderHook(() => usePracticeProgress({
      ...initialProgress,
      pageIndex: null,
    }));
    await act(async () => vi.advanceTimersByTimeAsync(500));
    act(() => window.dispatchEvent(new Event("pagehide")));
    unmount();

    expect(fetch).not.toHaveBeenCalled();
  });

  it("orders selections in the same millisecond and keeps the version on retry", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2030-01-01T00:00:00.000Z"));
    const { rerender, unmount } = renderHook(usePracticeProgress, {
      initialProps: { ...initialProgress, isPlaying: true },
    });
    await act(async () => { window.dispatchEvent(new Event("pagehide")); });
    rerender({ ...initialProgress, objectId: "note_b", isPlaying: true });
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
    await act(async () => { window.dispatchEvent(new Event("pagehide")); });
    await act(async () => { window.dispatchEvent(new Event("pagehide")); });

    const versions = vi.mocked(fetch).mock.calls.map(([, options]) =>
      JSON.parse(options?.body as string).observedAt as string,
    );
    expect(versions).toHaveLength(3);
    expect(Date.parse(versions[1])).toBe(Date.parse(versions[0]) + 1);
    expect(versions[2]).toBe(versions[1]);
    unmount();
  });
});
