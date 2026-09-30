import { describe, expect, it } from "vitest";

import { noteNameToMidi } from "@/lib/music/piano";
import {
  NOTE_COLOR_COUNT,
  assignNoteColors,
  assignVisibleNoteColors,
} from "@/lib/music/note-colors";

describe("assignNoteColors", () => {
  it("assigns colors by order of first appearance", () => {
    const colors = assignNoteColors(["D4", "F#4", "D3"]);

    expect(colors.get(noteNameToMidi("D4")!)).toBe(0);
    expect(colors.get(noteNameToMidi("F#4")!)).toBe(1);
    expect(colors.get(noteNameToMidi("D3")!)).toBe(2);
  });

  it("gives the same letter at different octaves different colors", () => {
    const colors = assignNoteColors(["D4", "D3"]);

    // D4 and D3 share a letter but are different physical keys/positions,
    // so they must be distinguishable by color.
    expect(colors.get(noteNameToMidi("D4")!)).not.toBe(
      colors.get(noteNameToMidi("D3")!),
    );
  });

  it("keeps a stable color for a repeated note and does not advance the index", () => {
    const colors = assignNoteColors(["C4", "C4", "E4"]);

    expect(colors.get(noteNameToMidi("C4")!)).toBe(0);
    expect(colors.get(noteNameToMidi("E4")!)).toBe(1);
    expect(colors.size).toBe(2);
  });

  it("shares one visible palette across current and preview notes", () => {
    const colors = assignVisibleNoteColors(
      ["C4", "E4"],
      ["E4", "G4"],
    );

    expect(colors.get(noteNameToMidi("C4")!)).toBe(0);
    expect(colors.get(noteNameToMidi("E4")!)).toBe(1);
    expect(colors.get(noteNameToMidi("G4")!)).toBe(2);
    expect(colors.size).toBe(3);
  });

  it("cycles colors once the palette is exhausted", () => {
    const notes = ["C1", "C#1", "D1", "D#1", "E1", "F1", "F#1"];
    const colors = assignNoteColors(notes);

    expect(colors.get(noteNameToMidi("C1")!)).toBe(0);
    expect(colors.get(noteNameToMidi("F#1")!)).toBe(NOTE_COLOR_COUNT % NOTE_COLOR_COUNT);
    expect(colors.get(noteNameToMidi("F#1")!)).toBe(0);
  });

  it("skips notes outside the piano range without consuming a color slot", () => {
    const colors = assignNoteColors(["C4", "Z9", "E4"]);

    expect(colors.get(noteNameToMidi("C4")!)).toBe(0);
    expect(colors.get(noteNameToMidi("E4")!)).toBe(1);
    expect(colors.size).toBe(2);
  });
});
