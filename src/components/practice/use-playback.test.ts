import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePlayback } from "@/components/practice/use-playback";
import { __clearSampleCache } from "@/lib/music/note-samples";
import type { PlaybackStep } from "@/lib/music/playback-timeline";

const sampleStops: ReturnType<typeof vi.fn>[] = [];

function step(objectId: string, notes: string[], stepDurationSec: number): PlaybackStep {
  return {
    pageIndex: 0,
    primaryObjectId: objectId,
    objectIds: [objectId],
    notes,
    startSec: 0,
    stepDurationSec,
    voices: [{ notes, durationSec: stepDurationSec }],
  };
}

class MockAudioContext {
  state = "running";
  currentTime = 0;
  destination = {};

  createOscillator() {
    return {
      type: "sine",
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
  }

  createGain() {
    return {
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    };
  }

  createBufferSource() {
    const stop = vi.fn();
    sampleStops.push(stop);

    return {
      buffer: null,
      connect: vi.fn(),
      start: vi.fn(),
      stop,
    };
  }

  decodeAudioData() {
    return Promise.resolve({ duration: 1 } as AudioBuffer);
  }

  resume() {
    return Promise.resolve();
  }

  close() {
    this.state = "closed";
    return Promise.resolve();
  }
}

describe("usePlayback", () => {
  beforeEach(() => {
    sampleStops.length = 0;
    vi.useFakeTimers();
    vi.stubGlobal("AudioContext", MockAudioContext);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
      })),
    );
    __clearSampleCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    __clearSampleCache();
  });

  it("steps through each event in order and finishes idle", async () => {
    const active: (string | null)[] = [];
    const steps = [
      step("a", ["C4"], 0.5),
      step("b", ["D4"], 0.5),
    ];

    const { result } = renderHook(() =>
      usePlayback({
        getSteps: () => steps,
        timbre: "piano",
        onActiveStep: (playbackStep) => active.push(playbackStep?.primaryObjectId ?? null),
      }),
    );

    await act(async () => {
      await result.current.play();
    });
    expect(result.current.status).toBe("playing");
    expect(active).toEqual(["a"]);

    act(() => vi.advanceTimersByTime(500));
    expect(active).toEqual(["a", "b"]);

    // After the last step's duration elapses, playback ends.
    act(() => vi.advanceTimersByTime(500));
    expect(active).toEqual(["a", "b", null]);
    expect(result.current.status).toBe("idle");
  });

  it("starts from the resolved index", async () => {
    const active: string[] = [];
    const steps = [step("a", ["C4"], 0.5), step("b", ["D4"], 0.5), step("c", ["E4"], 0.5)];

    const { result } = renderHook(() =>
      usePlayback({
        getSteps: () => steps,
        resolveStartIndex: () => 1,
        timbre: "piano",
        onActiveStep: (playbackStep) => {
          if (playbackStep) {
            active.push(playbackStep.primaryObjectId);
          }
        },
      }),
    );

    await act(async () => {
      await result.current.play();
    });
    expect(active).toEqual(["b"]);
  });

  it("pauses without advancing and resumes from the same step", async () => {
    const active: string[] = [];
    const steps = [step("a", ["C4"], 0.5), step("b", ["D4"], 0.5)];

    const { result } = renderHook(() =>
      usePlayback({
        getSteps: () => steps,
        timbre: "piano",
        onActiveStep: (playbackStep) => {
          if (playbackStep) {
            active.push(playbackStep.primaryObjectId);
          }
        },
      }),
    );

    await act(async () => {
      await result.current.play();
    });
    act(() => result.current.pause());
    expect(result.current.status).toBe("paused");
    expect(sampleStops).toHaveLength(1);
    expect(sampleStops[0]).toHaveBeenLastCalledWith();

    // Timers should not advance the step while paused.
    act(() => vi.advanceTimersByTime(2000));
    expect(active).toEqual(["a"]);

    // Resuming re-sounds the step you paused on, then continues. The paused
    // branch needs no preload, so this resolves without a sample decode.
    await act(async () => {
      await result.current.play();
    });
    expect(active).toEqual(["a", "a"]);
    act(() => vi.advanceTimersByTime(500));
    expect(active).toEqual(["a", "a", "b"]);
  });

  it("stop resets to idle and clears the active step", async () => {
    const steps = [step("a", ["C4"], 0.5), step("b", ["D4"], 0.5)];

    const { result } = renderHook(() =>
      usePlayback({
        getSteps: () => steps,
        timbre: "piano",
        onActiveStep: () => undefined,
      }),
    );

    await act(async () => {
      await result.current.play();
    });
    act(() => result.current.stop());

    expect(result.current.status).toBe("idle");
    expect(result.current.activeIndex).toBeNull();
  });

  it("does nothing when there are no steps", async () => {
    const { result } = renderHook(() =>
      usePlayback({
        getSteps: () => [],
        timbre: "piano",
        onActiveStep: () => undefined,
      }),
    );

    await act(async () => {
      await result.current.play();
    });
    expect(result.current.status).toBe("idle");
  });

  it("does not start playback when sample loading finishes after unmount", async () => {
    let finishLoading!: (response: unknown) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => {
      finishLoading = resolve;
    })));
    const onActiveStep = vi.fn();
    const { result, unmount } = renderHook(() =>
      usePlayback({
        getSteps: () => [step("a", ["C4"], 0.5)],
        timbre: "piano",
        onActiveStep,
      }),
    );
    let pendingPlay!: Promise<void>;

    act(() => {
      pendingPlay = result.current.play();
    });
    expect(result.current.isLoadingSamples).toBe(true);
    unmount();

    await act(async () => {
      finishLoading({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
      await pendingPlay;
    });

    expect(onActiveStep).not.toHaveBeenCalled();
    expect(sampleStops).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the latest sample loading state when an earlier play is cancelled", async () => {
    const finishLoading: ((response: unknown) => void)[] = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => {
      finishLoading.push(resolve);
    })));
    const onActiveStep = vi.fn();
    const { result, rerender } = renderHook(
      ({ steps }) => usePlayback({ getSteps: () => steps, timbre: "piano", onActiveStep }),
      { initialProps: { steps: [step("a", ["C4"], 0.5)] } },
    );
    let firstPlay!: Promise<void>;
    let latestPlay!: Promise<void>;

    act(() => {
      firstPlay = result.current.play();
    });
    act(() => result.current.stop());
    rerender({ steps: [step("b", ["D4"], 0.5)] });
    act(() => {
      latestPlay = result.current.play();
    });

    await act(async () => {
      finishLoading[0]({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
      await firstPlay;
    });

    expect(result.current.isLoadingSamples).toBe(true);
    expect(result.current.status).toBe("idle");
    expect(onActiveStep).not.toHaveBeenCalled();

    await act(async () => {
      finishLoading[1]({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
      await latestPlay;
    });

    expect(result.current.isLoadingSamples).toBe(false);
    expect(result.current.status).toBe("playing");
    expect(onActiveStep).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      primaryObjectId: "b",
    }));
  });
});
