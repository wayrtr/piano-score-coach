import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppLifecycleHeartbeat } from "@/components/app-lifecycle-heartbeat";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("AppLifecycleHeartbeat", () => {
  it("announces page presence as soon as the app opens", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 204,
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    render(<AppLifecycleHeartbeat />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/lifecycle/heartbeat", {
        method: "POST",
        cache: "no-store",
      });
    });
  });

  it("keeps announcing page presence while the page remains open", async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 204,
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    render(<AppLifecycleHeartbeat />);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("re-announces after the browser restores the page", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 204,
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    render(<AppLifecycleHeartbeat />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new Event("pageshow"));
    window.dispatchEvent(new Event("online"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });
});
