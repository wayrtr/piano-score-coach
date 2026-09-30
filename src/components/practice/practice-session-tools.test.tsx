import { act, fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { PracticeSessionTools } from "@/components/practice/practice-session-tools";

describe("PracticeSessionTools", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows only the essential metronome controls", () => {
    render(<PracticeSessionTools workId="work-simple" />);

    expect(screen.getByRole("button", { name: "开启" })).toBeInTheDocument();
    expect(screen.getByLabelText("速度（BPM）")).toBeInTheDocument();
    expect(screen.getByLabelText("节拍器音量")).toBeInTheDocument();
    expect(screen.getByLabelText("节拍器拍号")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "节拍强弱编辑" })).toBeInTheDocument();
    expect(screen.queryByText(/循环/)).not.toBeInTheDocument();
    expect(screen.queryByText(/难点/)).not.toBeInTheDocument();
    expect(screen.queryByText(/标记本小节/)).not.toBeInTheDocument();
  });

  it("lets the user finish typing a tempo before clamping it", () => {
    render(<PracticeSessionTools workId="work-tempo" />);
    const tempoInput = screen.getByLabelText("速度（BPM）");

    fireEvent.change(tempoInput, { target: { value: "1" } });
    expect(tempoInput).toHaveValue(1);

    fireEvent.change(tempoInput, { target: { value: "120" } });
    fireEvent.keyDown(tempoInput, { key: "Enter" });

    expect(screen.getByDisplayValue("120")).toBeInTheDocument();
  });

  it("starts with independent volume and a simple strong-weak pattern", () => {
    render(<PracticeSessionTools workId="work-defaults" />);

    expect(screen.getByLabelText("节拍器音量")).toHaveValue("75");
    expect(screen.getByLabelText("节拍器拍号")).toHaveValue("4/4");
    expect(screen.getByRole("button", { name: "第 1 拍，强拍" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "第 3 拍，弱拍" })).toBeInTheDocument();
  });

  it("persists volume, meter, and edited beat strength", () => {
    const props = { workId: "work-settings" } as const;
    const { unmount } = render(<PracticeSessionTools {...props} />);

    fireEvent.change(screen.getByLabelText("节拍器音量"), {
      target: { value: "90" },
    });
    fireEvent.change(screen.getByLabelText("节拍器拍号"), {
      target: { value: "3/4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "第 1 拍，强拍" }));

    unmount();
    render(<PracticeSessionTools {...props} />);

    expect(screen.getByLabelText("节拍器音量")).toHaveValue("90");
    expect(screen.getByLabelText("节拍器拍号")).toHaveValue("3/4");
    expect(screen.getByRole("button", { name: "第 1 拍，弱拍" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /第 4 拍/ })).not.toBeInTheDocument();
  });

  it("applies live volume and beat-strength changes without restarting", () => {
    vi.useFakeTimers();
    const frequencies: number[] = [];
    const gains: number[] = [];

    class MockAudioContext {
      state = "running";
      currentTime = 0;
      destination = {};

      createOscillator() {
        const oscillator = {
          frequency: { value: 0 },
          connect: vi.fn(),
          start: vi.fn(() => frequencies.push(oscillator.frequency.value)),
          stop: vi.fn(),
        };

        return oscillator;
      }

      createGain() {
        return {
          gain: {
            setValueAtTime: vi.fn((value: number) => gains.push(value)),
            exponentialRampToValueAtTime: vi.fn(),
          },
          connect: vi.fn(),
        };
      }

      resume() {
        return Promise.resolve();
      }
    }

    vi.stubGlobal("AudioContext", MockAudioContext);

    render(<PracticeSessionTools workId="work-live" />);
    fireEvent.click(screen.getByRole("button", { name: "开启" }));
    expect(frequencies).toEqual([1_320]);

    act(() => vi.advanceTimersByTime(833));
    expect(frequencies).toEqual([1_320, 880]);

    fireEvent.change(screen.getByLabelText("节拍器音量"), {
      target: { value: "50" },
    });
    fireEvent.click(screen.getByRole("button", { name: "第 3 拍，弱拍" }));

    act(() => vi.advanceTimersByTime(833));

    expect(frequencies).toEqual([1_320, 880, 1_320]);
    expect(gains[2]).toBeCloseTo(0.15);
  });

  it("reads old session data without restoring removed practice features", () => {
    window.localStorage.setItem(
      "piano-score-coach:practice-session:work-old-session",
      JSON.stringify({
        tempo: 84,
        metronome: false,
        loopStart: 2,
        loopEnd: 8,
        isLooping: true,
        difficultObjectIds: ["old-object"],
      }),
    );

    render(
      <PracticeSessionTools
        workId="work-old-session"
        suggestedMeter="3/4"
      />,
    );

    expect(screen.getByDisplayValue("84")).toBeInTheDocument();
    expect(screen.getByLabelText("节拍器拍号")).toHaveValue("3/4");
    expect(screen.queryByText(/循环/)).not.toBeInTheDocument();
    expect(screen.queryByText(/难点/)).not.toBeInTheDocument();
  });
});
