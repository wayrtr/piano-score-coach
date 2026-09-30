import { describe, expect, it } from "vitest";

import {
  DROP_D_TUNING,
  STANDARD_TUNING,
  areGuitarTuningsEqual,
  getGuitarGuidanceForNotes,
  normalizeGuitarTuning,
} from "@/lib/music/guitar";

describe("guitar guidance", () => {
  it("uses a custom tuning when calculating physical positions", () => {
    const guidance = getGuitarGuidanceForNotes(["D2"], DROP_D_TUNING);

    expect(guidance.recommended.positions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stringNumber: 6, fret: 0 }),
      ]),
    );
  });

  it("normalizes malformed persisted tuning without losing the standard fallback", () => {
    const normalized = normalizeGuitarTuning({
      1: "E4",
      2: "not-a-note",
      6: "D2",
    });

    expect(normalized).toMatchObject({
      1: "E4",
      2: STANDARD_TUNING[2],
      6: "D2",
    });
    expect(areGuitarTuningsEqual(normalized, STANDARD_TUNING)).toBe(false);
  });

  it("recommends the open string for a single note", () => {
    const guidance = getGuitarGuidanceForNotes(["E4"]);

    expect(guidance.recommended.status).toBe("ideal");
    expect(guidance.recommended.positions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stringNumber: 1,
          fret: 0,
        }),
      ]),
    );

    const allPositions = guidance.allPositions.get("E4");
    expect(allPositions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stringNumber: 1, fret: 0 }),
      ]),
    );
  });

  it("finds a compact ideal shape for a basic triad", () => {
    const guidance = getGuitarGuidanceForNotes(["E4", "G#4", "B4"]);

    expect(guidance.recommended.status).toBe("ideal");
    expect(guidance.recommended.positions.length).toBeGreaterThanOrEqual(3);
    expect(
      Math.max(...guidance.recommended.positions.map((position) => position.fret)) -
        Math.min(...guidance.recommended.positions.map((position) => position.fret)),
    ).toBeLessThanOrEqual(2);
    expect(
      guidance.recommended.positions.every(
        (position) => position.fret >= 0 && position.fret <= 12,
      ),
    ).toBe(true);
  });

  it("provides fallback guidance when the chord spans a wide stretch", () => {
    const guidance = getGuitarGuidanceForNotes(["E4", "F#5", "B5", "D#6"]);

    expect(["ideal", "approximate", "unavailable"]).toContain(
      guidance.recommended.status,
    );
    if (guidance.recommended.status === "unavailable") {
      expect(guidance.recommended.message).toBeDefined();
    }
  });

  it("keeps a partial reference when a chord cannot fit on distinct strings", () => {
    const guidance = getGuitarGuidanceForNotes(["A4", "C#5", "E5"]);

    expect(guidance.recommended.status).toBe("approximate");
    expect(guidance.recommended.positions.length).toBeGreaterThan(0);
    expect(guidance.recommended.positions.length).toBeLessThan(3);
    expect(guidance.recommended.message).toContain("无法组成完整把位");
    expect([...guidance.allPositions.values()].flat().length).toBeGreaterThan(0);
  });

  it("keeps playable notes when another chord tone is outside the first 12 frets", () => {
    const guidance = getGuitarGuidanceForNotes(["E5", "E6"]);

    expect(guidance.recommended.status).toBe("approximate");
    expect(guidance.recommended.positions).toEqual([
      expect.objectContaining({ noteName: "E5", stringNumber: 1, fret: 12 }),
    ]);
    expect(guidance.recommended.message).toContain("E6");
  });

  it("keeps valid positions when one note cannot be parsed", () => {
    const guidance = getGuitarGuidanceForNotes(["H4", "E4"]);

    expect(guidance.recommended.status).toBe("approximate");
    expect(guidance.recommended.positions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ noteName: "E4" }),
      ]),
    );
    expect(guidance.recommended.message).toContain("H4");
  });

  it("returns a bounded partial reference when there are more tones than strings", () => {
    const guidance = getGuitarGuidanceForNotes([
      "E4",
      "F4",
      "G4",
      "A4",
      "B4",
      "C5",
      "D5",
    ]);

    expect(guidance.recommended.status).toBe("approximate");
    expect(guidance.recommended.positions.length).toBeGreaterThan(0);
    expect(guidance.recommended.positions.length).toBeLessThanOrEqual(6);
    expect(guidance.recommended.message).toContain("无法组成完整把位");
  });

  it("reports all valid fretboard positions for each note", () => {
    const guidance = getGuitarGuidanceForNotes(["A3"]);
    const positions = guidance.allPositions.get("A3");

    expect(positions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stringNumber: 5, fret: 12 }),
        expect.objectContaining({ stringNumber: 4, fret: 7 }),
        expect.objectContaining({ stringNumber: 3, fret: 2 }),
      ]),
    );
  });

  it("uses the same physical positions for enharmonic spellings", () => {
    const guidance = getGuitarGuidanceForNotes(["B#4"]);

    expect(guidance.recommended.positions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stringNumber: 1, fret: 8, midi: 72 }),
      ]),
    );
    expect(guidance.allPositions.get("B#4")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ midi: 72 }),
      ]),
    );
  });

  it("does not duplicate a physical key when a chord contains enharmonic aliases", () => {
    const guidance = getGuitarGuidanceForNotes(["B#4", "C5"]);

    expect(guidance.recommended.positions).toHaveLength(1);
    expect(guidance.recommended.positions[0]?.midi).toBe(72);
  });

  it("reports malformed note names instead of silently treating them as empty", () => {
    const guidance = getGuitarGuidanceForNotes(["H4"]);

    expect(guidance.recommended.status).toBe("unavailable");
    expect(guidance.recommended.message).toContain("H4");
  });
});
