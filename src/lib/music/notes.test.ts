import { describe, expect, it } from "vitest";

import {
  describeNote,
  normalizeNoteName,
  parseNoteName,
} from "@/lib/music/notes";

describe("shared note helpers", () => {
  it("retains written spelling while exposing sounding MIDI", () => {
    expect(parseNoteName(" b♯4 ")).toEqual({
      input: "b♯4",
      letter: "B",
      accidental: 1,
      octave: 4,
      midi: 72,
    });

    expect(normalizeNoteName(" b♯4 ")).toBe("B#4");
  });

  it("reports whether a written note needs an instrument-facing equivalent", () => {
    expect(describeNote("B#4")).toMatchObject({
      written: "B♯4",
      sounding: "C5",
      midi: 72,
      hasEnharmonicEquivalent: true,
    });

    expect(describeNote("F#4")).toMatchObject({
      written: "F♯4",
      sounding: "F#4",
      hasEnharmonicEquivalent: false,
    });
  });

  it("rejects mixed or unsupported accidental sequences", () => {
    expect(parseNoteName("C#b4")).toBeNull();
    expect(parseNoteName("C###4")).toBeNull();
  });
});
