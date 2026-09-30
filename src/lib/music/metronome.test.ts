import { describe, expect, it } from "vitest";

import {
  DEFAULT_METRONOME_METER,
  DEFAULT_METRONOME_VOLUME,
  METRONOME_METERS,
  clampMetronomeVolume,
  getDefaultMetronomePattern,
  getMetronomeAccentGain,
  getMetronomeBeatCount,
  normalizeMetronomeMeter,
  normalizeMetronomePattern,
} from "@/lib/music/metronome";

describe("metronome settings", () => {
  it("defines the supported meters and their beat counts", () => {
    expect(METRONOME_METERS).toEqual([
      "2/4",
      "3/4",
      "4/4",
      "5/4",
      "6/8",
      "7/8",
      "9/8",
      "12/8",
    ]);
    expect(METRONOME_METERS.map((meter) => getMetronomeBeatCount(meter))).toEqual([
      2,
      3,
      4,
      5,
      6,
      7,
      9,
      12,
    ]);
  });

  it("falls back to 4/4 when a persisted meter is unsupported", () => {
    expect(normalizeMetronomeMeter("3/4")).toBe("3/4");
    expect(normalizeMetronomeMeter("11/8")).toBe(DEFAULT_METRONOME_METER);
    expect(normalizeMetronomeMeter(null)).toBe(DEFAULT_METRONOME_METER);
  });

  it("creates musically useful default accent patterns", () => {
    expect(getDefaultMetronomePattern("2/4")).toEqual(["strong", "normal"]);
    expect(getDefaultMetronomePattern("3/4")).toEqual([
      "strong",
      "normal",
      "normal",
    ]);
    expect(getDefaultMetronomePattern("4/4")).toEqual([
      "strong",
      "normal",
      "accent",
      "normal",
    ]);
    expect(getDefaultMetronomePattern("6/8")).toEqual([
      "strong",
      "normal",
      "normal",
      "accent",
      "normal",
      "normal",
    ]);
    expect(getDefaultMetronomePattern("7/8")).toEqual([
      "strong",
      "normal",
      "accent",
      "normal",
      "accent",
      "normal",
      "normal",
    ]);
  });

  it("normalizes malformed patterns to the selected meter without mutating input", () => {
    const persisted = ["silent", "not-an-accent", "strong", "normal", "silent"];

    expect(normalizeMetronomePattern(persisted, "4/4")).toEqual([
      "silent",
      "normal",
      "strong",
      "normal",
    ]);
    expect(persisted).toEqual([
      "silent",
      "not-an-accent",
      "strong",
      "normal",
      "silent",
    ]);
    expect(normalizeMetronomePattern(undefined, "3/4")).toEqual([
      "strong",
      "normal",
      "normal",
    ]);
  });

  it("also normalizes an invalid meter before sizing a pattern", () => {
    expect(normalizeMetronomePattern(["silent"], "11/8")).toEqual([
      "silent",
      "normal",
      "accent",
      "normal",
    ]);
  });

  it("clamps volume and uses the default for unusable values", () => {
    expect(clampMetronomeVolume(-10)).toBe(0);
    expect(clampMetronomeVolume(45.6)).toBe(46);
    expect(clampMetronomeVolume(120)).toBe(100);
    expect(clampMetronomeVolume("64")).toBe(64);
    expect(clampMetronomeVolume(Number.NaN)).toBe(DEFAULT_METRONOME_VOLUME);
    expect(clampMetronomeVolume(null)).toBe(DEFAULT_METRONOME_VOLUME);
  });

  it("maps volume and accent levels to bounded, ordered audio gains", () => {
    const normal = getMetronomeAccentGain(100, "normal");
    const accent = getMetronomeAccentGain(100, "accent");
    const strong = getMetronomeAccentGain(100, "strong");

    expect(getMetronomeAccentGain(100, "silent")).toBe(0);
    expect(getMetronomeAccentGain(0, "strong")).toBe(0);
    expect(normal).toBeGreaterThan(0);
    expect(normal).toBeLessThan(accent);
    expect(accent).toBeLessThan(strong);
    expect(strong).toBeLessThanOrEqual(1);
    expect(getMetronomeAccentGain(50, "strong")).toBeCloseTo(strong / 2);
    expect(getMetronomeAccentGain(100, "unknown")).toBeCloseTo(normal);
  });
});
