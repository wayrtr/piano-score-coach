import { describe, expect, it, vi } from "vitest";

import { noteNameToFrequency, playNote } from "@/lib/music/note-synth";

describe("noteNameToFrequency", () => {
  it("anchors A4 to 440 Hz", () => {
    expect(noteNameToFrequency("A4")).toBeCloseTo(440);
  });

  it("computes octave and semitone relationships", () => {
    expect(noteNameToFrequency("A5")).toBeCloseTo(880);
    expect(noteNameToFrequency("A3")).toBeCloseTo(220);
    expect(noteNameToFrequency("C4")).toBeCloseTo(261.63, 1);
  });

  it("returns null for an unparseable note", () => {
    expect(noteNameToFrequency("not-a-note")).toBeNull();
  });
});

describe("playNote", () => {
  function createMockContext() {
    const gainNode = () => ({
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    });
    const oscillators: Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = [];
    const context = {
      currentTime: 0,
      destination: {},
      createGain: vi.fn(gainNode),
      createOscillator: vi.fn(() => {
        const oscillator = {
          type: "sine",
          frequency: { setValueAtTime: vi.fn() },
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        };
        oscillators.push(oscillator);
        return oscillator;
      }),
    };

    return { context, oscillators };
  }

  it("schedules one oscillator per partial and starts them", () => {
    const { context, oscillators } = createMockContext();

    const nodes = playNote(context as unknown as AudioContext, {
      frequency: 440,
      startTime: 0,
      durationSec: 1,
      timbre: "piano",
    });

    // Piano recipe has 4 partials.
    expect(nodes).toHaveLength(4);
    expect(oscillators).toHaveLength(4);
    expect(oscillators.every((osc) => osc.start.mock.calls.length === 1)).toBe(true);
    expect(oscillators.every((osc) => osc.stop.mock.calls.length === 1)).toBe(true);
  });

  it("ignores a non-positive frequency", () => {
    const { context, oscillators } = createMockContext();

    expect(
      playNote(context as unknown as AudioContext, {
        frequency: 0,
        startTime: 0,
        durationSec: 1,
        timbre: "guitar",
      }),
    ).toEqual([]);
    expect(oscillators).toHaveLength(0);
  });

  it("holds a sustain plateau instead of decaying straight to silence", () => {
    // Capture the envelope gain automation: rise to peak, drop to a sustain
    // level, hold near it through the body, then fall to silence. A regression
    // to the old "peak -> silence" shape (the metronome-tick bug) would leave
    // no value between the peak and the final near-zero.
    const ramps: Array<{ value: number; time: number }> = [];
    const context = {
      currentTime: 0,
      destination: {},
      createGain: vi.fn(() => ({
        gain: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn((value: number, time: number) =>
            ramps.push({ value, time }),
          ),
        },
        connect: vi.fn(),
      })),
      createOscillator: vi.fn(() => ({
        type: "sine",
        frequency: { setValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      })),
    };

    playNote(context as unknown as AudioContext, {
      frequency: 440,
      startTime: 0,
      durationSec: 1,
      timbre: "piano",
    });

    // The gain envelope (first createGain) records: attack->peak, decay->sustain,
    // body drift, release->silence. Partial gains use setValueAtTime only.
    const peak = Math.max(...ramps.map((ramp) => ramp.value));
    const sustainRamp = ramps.find((ramp) => ramp.value < peak && ramp.value > peak * 0.3);
    const lastRamp = ramps.at(-1);

    // A real sustain level exists between peak and silence...
    expect(sustainRamp).toBeDefined();
    // ...it is reached well before the note's body ends (held, not instant)...
    expect(sustainRamp!.time).toBeLessThan(0.5);
    // ...and the note only reaches silence at/after the notated duration.
    expect(lastRamp!.value).toBeLessThan(0.01);
    expect(lastRamp!.time).toBeGreaterThanOrEqual(1);
  });
});
