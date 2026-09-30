import { describe, expect, it } from "vitest";

import {
  formatNoteWithSoundingEquivalent,
  midiToNoteName,
  noteNameToMidi,
} from "@/lib/music/piano";

describe("piano note conversion", () => {
  it("maps double accidentals and Unicode accidentals to the right key", () => {
    expect(noteNameToMidi("B#4")).toBe(72);
    expect(noteNameToMidi("C♯♯4")).toBe(62);
    expect(noteNameToMidi("Dbb4")).toBe(60);
    expect(noteNameToMidi("E𝄫4")).toBe(62);
  });

  it("keeps the piano range guard for otherwise valid notes", () => {
    expect(noteNameToMidi("C-1")).toBeNull();
    expect(noteNameToMidi("A0")).toBe(21);
    expect(noteNameToMidi("C8")).toBe(108);
    expect(noteNameToMidi("C9")).toBeNull();
  });

  it("uses a stable sharp spelling when converting a key back to a name", () => {
    expect(midiToNoteName(21)).toBe("A0");
    expect(midiToNoteName(60)).toBe("C4");
    expect(midiToNoteName(108)).toBe("C8");
  });

  it("explains enharmonic spellings without changing ordinary labels", () => {
    expect(formatNoteWithSoundingEquivalent("B#4")).toBe(
      "B♯4（对应琴键 C5）",
    );
    expect(formatNoteWithSoundingEquivalent("C5")).toBe("C5");
    expect(formatNoteWithSoundingEquivalent("Dbb4")).toBe(
      "D♭♭4（对应琴键 C4）",
    );
  });
});
