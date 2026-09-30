import {
  createGuitarStringTracker,
  detectPitch,
  getCentsOffset,
  getClosestGuitarString,
  getTuningTargetFrequency,
} from "@/lib/music/tuner";
import {
  DROP_D_TUNING,
  STANDARD_TUNING,
  type GuitarTuning,
} from "@/lib/music/guitar";

function makeSineWave(
  frequency: number,
  sampleRate = 48_000,
  length = 4_096,
) {
  return Float32Array.from(
    { length },
    (_, index) => Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.6,
  );
}

describe("guitar tuner music helpers", () => {
  it("converts a tuning target note into its concert-pitch frequency", () => {
    expect(getTuningTargetFrequency("A4")).toBeCloseTo(440, 5);
    expect(getTuningTargetFrequency("E2")).toBeCloseTo(82.4069, 3);
    expect(getTuningTargetFrequency("not-a-note")).toBeNull();
  });

  it("reports pitch distance in cents", () => {
    expect(getCentsOffset(440, 440)).toBeCloseTo(0, 6);
    expect(getCentsOffset(466.1638, 440)).toBeCloseTo(100, 2);
    expect(getCentsOffset(0, 440)).toBeNull();
  });

  it("finds the closest open string without a manually selected target", () => {
    const detected = getClosestGuitarString(109.5, STANDARD_TUNING);

    expect(detected).toMatchObject({
      stringNumber: 5,
      noteName: "A2",
    });
    expect(detected?.targetFrequency).toBeCloseTo(110, 3);
    expect(detected?.cents).toBeCloseTo(-7.89, 1);
  });

  it.each([
    [6, 82.4069],
    [5, 110],
    [4, 146.8324],
    [3, 195.9977],
    [2, 246.9417],
    [1, 329.6276],
  ] as const)("maps standard open-string frequency to %s string", (stringNumber, frequency) => {
    expect(getClosestGuitarString(frequency, STANDARD_TUNING)?.stringNumber).toBe(
      stringNumber,
    );
  });

  it("uses the configured tuning when identifying the string", () => {
    expect(
      getClosestGuitarString(73.42, DROP_D_TUNING)?.stringNumber,
    ).toBe(6);
    expect(getClosestGuitarString(73.42, DROP_D_TUNING)?.noteName).toBe("D2");
  });

  it("does not guess between identical open-string targets on a cold start", () => {
    const unisonTuning: GuitarTuning = {
      ...STANDARD_TUNING,
      1: "E2",
    };

    expect(getClosestGuitarString(82.41, unisonTuning)).toBeNull();
    expect(getClosestGuitarString(82.41, unisonTuning, 1)?.stringNumber).toBe(1);
  });

  it("keeps the current string near a midpoint so small pitch jitter does not switch it", () => {
    const nearBoundary = getClosestGuitarString(221.28, STANDARD_TUNING, 3);

    expect(nearBoundary?.stringNumber).toBe(3);

    const clearlyCloserToSecondString = getClosestGuitarString(
      225.14,
      STANDARD_TUNING,
      3,
    );

    expect(clearlyCloserToSecondString?.stringNumber).toBe(2);
  });

  it("locks onto a string only after three clear matching readings", () => {
    const tracker = createGuitarStringTracker();
    const clearA2 = { frequency: 110, clarity: 0.95 };
    const clearE2 = { frequency: 82.41, clarity: 0.95 };

    expect(tracker.update(clearA2, STANDARD_TUNING)).toBeNull();
    expect(tracker.update(clearA2, STANDARD_TUNING)).toBeNull();
    expect(tracker.update(clearA2, STANDARD_TUNING)).toBe(5);

    expect(tracker.update(clearE2, STANDARD_TUNING)).toBe(5);
    expect(tracker.update(clearE2, STANDARD_TUNING)).toBe(5);
    expect(tracker.update(clearE2, STANDARD_TUNING)).toBe(6);
  });

  it("releases a locked string after three silent readings", () => {
    const tracker = createGuitarStringTracker();
    const clearE2 = { frequency: 82.41, clarity: 0.95 };

    tracker.update(clearE2, STANDARD_TUNING);
    tracker.update(clearE2, STANDARD_TUNING);
    expect(tracker.update(clearE2, STANDARD_TUNING)).toBe(6);

    expect(tracker.update(null, STANDARD_TUNING)).toBe(6);
    expect(tracker.update(null, STANDARD_TUNING)).toBe(6);
    expect(tracker.update(null, STANDARD_TUNING)).toBeNull();
  });

  it("does not lock onto low-clarity pitch readings", () => {
    const tracker = createGuitarStringTracker();
    const unclearA2 = { frequency: 110, clarity: 0.79 };
    const clearA2 = { frequency: 110, clarity: 0.8 };

    expect(tracker.update(unclearA2, STANDARD_TUNING)).toBeNull();
    expect(tracker.update(unclearA2, STANDARD_TUNING)).toBeNull();
    expect(tracker.update(unclearA2, STANDARD_TUNING)).toBeNull();
    expect(tracker.update(clearA2, STANDARD_TUNING)).toBeNull();
    expect(tracker.update(clearA2, STANDARD_TUNING)).toBeNull();
    expect(tracker.update(clearA2, STANDARD_TUNING)).toBe(5);
  });

  it("does not carry pending readings across a tuning change", () => {
    const tracker = createGuitarStringTracker();
    const clearE2 = { frequency: 82.41, clarity: 0.95 };
    const clearD2 = { frequency: 73.42, clarity: 0.95 };

    tracker.update(clearE2, STANDARD_TUNING);
    tracker.update(clearE2, STANDARD_TUNING);

    expect(tracker.update(clearD2, DROP_D_TUNING)).toBeNull();
    expect(tracker.update(clearD2, DROP_D_TUNING)).toBeNull();
    expect(tracker.update(clearD2, DROP_D_TUNING)).toBe(6);
  });

  it("detects low guitar fundamentals from microphone-sized sample buffers", () => {
    const detected = detectPitch(makeSineWave(82.4069), 48_000);

    expect(detected).not.toBeNull();
    expect(detected?.frequency).toBeCloseTo(82.4069, 0);
    expect(detected?.clarity).toBeGreaterThan(0.85);
  });

  it("keeps the default detector range wide enough for the high E string", () => {
    const detected = detectPitch(makeSineWave(329.6276), 48_000);

    expect(detected).not.toBeNull();
    expect(detected?.frequency).toBeCloseTo(329.6276, 0);
  });

  it("does not invent a pitch when the input is silent", () => {
    expect(detectPitch(new Float32Array(4_096), 48_000)).toBeNull();
  });
});
