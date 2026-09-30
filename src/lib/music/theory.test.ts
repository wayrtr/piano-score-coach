import { describe, expect, it } from "vitest";

import {
  getIntervalBetweenNotes,
  getIntervalNameFromSemitones,
  getTheoryForKey,
  normalizeWorkKey,
} from "@/lib/music/theory";

describe("getIntervalNameFromSemitones", () => {
  it("maps common simple intervals from semitone counts", () => {
    expect(getIntervalNameFromSemitones(0)).toBe("纯一度");
    expect(getIntervalNameFromSemitones(4)).toBe("大三度");
    expect(getIntervalNameFromSemitones(7)).toBe("纯五度");
    expect(getIntervalNameFromSemitones(12)).toBe("纯八度");
    expect(getIntervalNameFromSemitones(16)).toBe("大十度");
    expect(getIntervalNameFromSemitones(24)).toBe("纯十五度（双八度）");
  });

  it("returns null for invalid semitone counts", () => {
    expect(getIntervalNameFromSemitones(-1)).toBeNull();
    expect(getIntervalNameFromSemitones(Number.NaN)).toBeNull();
    expect(getIntervalNameFromSemitones(3.5)).toBeNull();
  });
});

describe("getIntervalBetweenNotes", () => {
  it("computes the interval between two note names", () => {
    expect(getIntervalBetweenNotes("C4", "E4")).toEqual({
      fromNote: "C4",
      toNote: "E4",
      semitones: 4,
      intervalName: "大三度",
      direction: "up",
    });
  });

  it("preserves direction when the selected note moves downward", () => {
    expect(getIntervalBetweenNotes("G4", "E4")).toEqual({
      fromNote: "G4",
      toNote: "E4",
      semitones: 3,
      intervalName: "小三度",
      direction: "down",
    });
  });

  it("returns null when either note name cannot be parsed", () => {
    expect(getIntervalBetweenNotes("C4", "H4")).toBeNull();
  });

  it("accepts double accidentals when comparing written notes", () => {
    expect(getIntervalBetweenNotes("B#4", "C5")).toEqual({
      fromNote: "B#4",
      toNote: "C5",
      semitones: 0,
      intervalName: "纯一度",
      direction: "same",
    });
  });
});

describe("work key normalization", () => {
  it("accepts Unicode accidentals and flexible casing", () => {
    expect(normalizeWorkKey(" c♯ MAJOR ")).toBe("C# major");
    expect(getTheoryForKey("B♭ major").key).toBe("Bb major");
  });
});
