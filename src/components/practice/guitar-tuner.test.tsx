import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import { GuitarTuner } from "@/components/practice/guitar-tuner";
import { DROP_D_TUNING, STANDARD_TUNING } from "@/lib/music/guitar";

describe("GuitarTuner", () => {
  it("uses the configured tuning as the target for all six strings", () => {
    render(<GuitarTuner tuning={DROP_D_TUNING} />);

    expect(
      screen.queryByText("自动识别琴弦；声音只在本机分析，不会上传录音。"),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /弦 ·/ })).toHaveLength(6);
    expect(screen.getByRole("button", { name: "6 弦 · D2" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("目标").parentElement).toHaveTextContent("D2");

    fireEvent.click(screen.getByRole("button", { name: "1 弦 · E4" }));

    expect(screen.getByText("目标").parentElement).toHaveTextContent("E4");
  });

  it("automatically targets the detected string without a prior click", async () => {
    const originalMediaDevices = navigator.mediaDevices;
    const originalAudioContext = window.AudioContext;
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const originalCancelAnimationFrame = window.cancelAnimationFrame;
    const stream = {
      getTracks: () => [{ stop: vi.fn() }],
    } as unknown as MediaStream;
    let scheduledFrame: FrameRequestCallback | null = null;
    const analyser = {
      fftSize: 2_048,
      smoothingTimeConstant: 0,
      getFloatTimeDomainData: vi.fn((samples: Float32Array) => {
        for (let index = 0; index < samples.length; index += 1) {
          samples[index] =
            Math.sin((2 * Math.PI * 110 * index) / 48_000) * 0.6;
        }
      }),
    } as unknown as AnalyserNode;

    class FakeAudioContext {
      sampleRate = 48_000;
      createAnalyser = () => analyser;
      createMediaStreamSource = () => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
      });
      resume = vi.fn().mockResolvedValue(undefined);
      close = vi.fn().mockResolvedValue(undefined);
    }

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: FakeAudioContext,
    });
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: vi.fn((callback: FrameRequestCallback) => {
        scheduledFrame = callback;
        return 7;
      }),
    });
    Object.defineProperty(window, "cancelAnimationFrame", {
      configurable: true,
      value: vi.fn(),
    });

    const { unmount } = render(<GuitarTuner tuning={STANDARD_TUNING} />);
    fireEvent.click(screen.getByRole("button", { name: "开始听音" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "停止听音" })).toBeInTheDocument();
    });

    for (const timestamp of [0, 80, 160]) {
      await act(async () => {
        scheduledFrame?.(timestamp);
      });
    }

    expect(screen.getByRole("button", { name: "5 弦 · A2" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("目标").parentElement).toHaveTextContent("A2");

    unmount();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: originalMediaDevices,
    });
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: originalAudioContext,
    });
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: originalRequestAnimationFrame,
    });
    Object.defineProperty(window, "cancelAnimationFrame", {
      configurable: true,
      value: originalCancelAnimationFrame,
    });
  });

  it("explains when this browser cannot open a microphone", async () => {
    const originalMediaDevices = navigator.mediaDevices;

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });

    render(<GuitarTuner tuning={STANDARD_TUNING} />);
    fireEvent.click(screen.getByRole("button", { name: "开始听音" }));

    await waitFor(() => {
      expect(
        screen.getByText("当前浏览器无法使用麦克风，请改用最新版 Chrome 或 Safari。"),
      ).toBeInTheDocument();
    });

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: originalMediaDevices,
    });
  });

  it("opens the local microphone and releases it when the tuner closes", async () => {
    const originalMediaDevices = navigator.mediaDevices;
    const originalAudioContext = window.AudioContext;
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const originalCancelAnimationFrame = window.cancelAnimationFrame;
    const stopTrack = vi.fn();
    const disconnect = vi.fn();
    const close = vi.fn().mockResolvedValue(undefined);
    const connect = vi.fn();
    const stream = {
      getTracks: () => [{ stop: stopTrack }],
    } as unknown as MediaStream;
    const analyser = {
      fftSize: 2_048,
      smoothingTimeConstant: 0,
      getFloatTimeDomainData: vi.fn(),
    } as unknown as AnalyserNode;

    class FakeAudioContext {
      sampleRate = 48_000;
      createAnalyser = () => analyser;
      createMediaStreamSource = () => ({ connect, disconnect });
      resume = vi.fn().mockResolvedValue(undefined);
      close = close;
    }

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: FakeAudioContext,
    });
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: vi.fn().mockReturnValue(7),
    });
    Object.defineProperty(window, "cancelAnimationFrame", {
      configurable: true,
      value: vi.fn(),
    });

    const { unmount } = render(<GuitarTuner tuning={STANDARD_TUNING} />);
    fireEvent.click(screen.getByRole("button", { name: "开始听音" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "停止听音" })).toBeInTheDocument();
    });

    expect(connect).toHaveBeenCalledWith(analyser);
    unmount();
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: originalMediaDevices,
    });
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: originalAudioContext,
    });
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: originalRequestAnimationFrame,
    });
    Object.defineProperty(window, "cancelAnimationFrame", {
      configurable: true,
      value: originalCancelAnimationFrame,
    });
  });

  it.each([
    // The AudioContext is now created (and resumed) inside the click gesture,
    // BEFORE getUserMedia — so a constructor failure never opens the mic and
    // has no track to release.
    { failure: "AudioContext constructor", expectedCloseCalls: 0, expectedStopCalls: 0 },
    { failure: "createAnalyser", expectedCloseCalls: 1, expectedStopCalls: 1 },
    { failure: "createMediaStreamSource", expectedCloseCalls: 1, expectedStopCalls: 1 },
  ])(
    "releases the microphone when $failure fails after permission succeeds",
    async ({ failure, expectedCloseCalls, expectedStopCalls }) => {
      const originalMediaDevices = navigator.mediaDevices;
      const originalAudioContext = window.AudioContext;
      const stopTrack = vi.fn();
      const close = vi.fn().mockRejectedValue(new Error("close failed"));
      const stream = {
        getTracks: () => [{ stop: stopTrack }],
      } as unknown as MediaStream;
      const analyser = {
        fftSize: 2_048,
        smoothingTimeConstant: 0,
      } as unknown as AnalyserNode;

      class FailingAudioContext {
        sampleRate = 48_000;
        close = close;

        constructor() {
          if (failure === "AudioContext constructor") {
            throw new Error("context failed");
          }
        }

        createAnalyser() {
          if (failure === "createAnalyser") {
            throw new Error("analyser failed");
          }

          return analyser;
        }

        createMediaStreamSource() {
          if (failure === "createMediaStreamSource") {
            throw new Error("source failed");
          }

          throw new Error("unexpected source creation");
        }
      }

      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
      });
      Object.defineProperty(window, "AudioContext", {
        configurable: true,
        value: FailingAudioContext,
      });

      render(<GuitarTuner tuning={STANDARD_TUNING} />);
      fireEvent.click(screen.getByRole("button", { name: "开始听音" }));

      await waitFor(() => {
        expect(
          screen.getByText("麦克风启动失败，请检查浏览器权限和系统输入设备。"),
        ).toBeInTheDocument();
      });

      expect(stopTrack).toHaveBeenCalledTimes(expectedStopCalls);
      expect(close).toHaveBeenCalledTimes(expectedCloseCalls);

      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: originalMediaDevices,
      });
      Object.defineProperty(window, "AudioContext", {
        configurable: true,
        value: originalAudioContext,
      });
    },
  );
});
