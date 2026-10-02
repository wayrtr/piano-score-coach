import {
  getCompactKeyboardLayout,
  KEYBOARD_REGION_GAP,
  KEYBOARD_REGION_PADDING,
  MIN_WHITE_KEY_WIDTH,
} from "@/components/practice/keyboard-layout";
import { noteNameToMidi } from "@/lib/music/piano";

function expectVisibleLayout(notes: string[], width: number) {
  const midiValues = notes.map((note) => noteNameToMidi(note)!);
  const rows = getCompactKeyboardLayout(new Set(midiValues), width);
  const visible = new Set(rows.flatMap((row) => row.regions.flatMap((region) => region.map((key) => key.midi))));
  for (const midi of midiValues) expect(visible.has(midi)).toBe(true);
  for (const row of rows) {
    expect(row.whiteKeyWidth).toBeGreaterThanOrEqual(MIN_WHITE_KEY_WIDTH);
    const renderedWidth = row.regions.reduce(
      (sum, region) => sum + region.filter((key) => !key.isBlack).length * row.whiteKeyWidth + KEYBOARD_REGION_PADDING,
      (row.regions.length - 1) * KEYBOARD_REGION_GAP,
    );
    expect(renderedWidth).toBeCloseTo(width, 5);
    for (const region of row.regions) {
      expect(region[0].isBlack).toBe(false);
      expect(region.at(-1)!.isBlack).toBe(false);
      expect(region.map((key) => key.midi)).toEqual(
        Array.from({ length: region.at(-1)!.midi - region[0].midi + 1 }, (_, index) => region[0].midi + index),
      );
    }
  }
  return rows;
}

describe("compact keyboard layout", () => {
  it("retains a single continuous region when readable keys fit", () => {
    expect(expectVisibleLayout(["C4", "E4", "G4"], 600)).toHaveLength(1);
    expect(getCompactKeyboardLayout(new Set(), 280)).toHaveLength(1);
  });

  it.each([980, 1200])("fills %i px around a single note with neighbouring keys", (width) => {
    const rows = expectVisibleLayout(["C4"], width);
    expect(rows).toHaveLength(1);
    expect(rows[0].regions).toHaveLength(1);
    expect(rows[0].whiteKeyWidth).toBeGreaterThanOrEqual(30);
    expect(rows[0].whiteKeyWidth).toBeLessThanOrEqual(36);
    expect(rows[0].regions[0][0].midi).toBeLessThan(60);
    expect(rows[0].regions[0].at(-1)!.midi).toBeGreaterThan(60);
  });

  it.each([180, 280, 360])("keeps a single note and readable context on a %i px phone layout", (width) => {
    const rows = expectVisibleLayout(["C4"], width);
    expect(rows).toHaveLength(1);
    expect(rows[0].whiteKeyWidth).toBeLessThanOrEqual(36);
  });

  it.each(["A0", "C8", "A#0", "C#4", "A#7"])("fills the available range without clipping %s", (note) => {
    for (const width of [180, 280, 980, 1200]) {
      const rows = expectVisibleLayout([note], width);
      expect(rows).toHaveLength(1);
      expect(rows[0].whiteKeyWidth).toBeLessThanOrEqual(36);
    }
  });

  it.each([280, 980, 1200])("fills the idle keyboard at %i px", (width) => {
    expect(expectVisibleLayout([], width)).toHaveLength(1);
  });

  it.each([280, 360, 600])("shows both C-major triads completely at %i px", (width) => {
    const rows = expectVisibleLayout(["C2", "E2", "G2", "C5", "E5", "G5"], width);
    expect(rows).toHaveLength(2);
  });

  it.each([280, 360, 600, 980])("keeps C1 and C8 visible without a tiny full-piano view at %i px", (width) => {
    const rows = expectVisibleLayout(["C1", "C8"], width);
    expect(rows).toHaveLength(2);
    expect(rows[0].regions[0].at(-1)!.midi).toBeLessThan(rows[1].regions[0][0].midi);
  });

  it("balances uneven distant note groups without stretching a short row into giant keys", () => {
    const rows = expectVisibleLayout(["C1", "C2", "C8"], 980);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.whiteKeyWidth < 38)).toBe(true);
    expect(rows[0].regions.at(-1)!.at(-1)!.midi).toBeLessThan(rows[1].regions[0][0].midi);
  });

  it("balances a dense full piano across two desktop rows", () => {
    const rows = getCompactKeyboardLayout(new Set(Array.from({ length: 88 }, (_, index) => index + 21)), 980);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.whiteKeyWidth < 38)).toBe(true);
    const visible = new Set(rows.flatMap((row) => row.regions.flatMap((region) => region.map((key) => key.midi))));
    expect(visible.size).toBe(88);
  });

  it("fits six scattered black notes in two rows with each black key between white keys", () => {
    const rows = expectVisibleLayout(["C#1", "D#2", "F#3", "G#4", "A#5", "C#7"], 280);
    expect(rows).toHaveLength(2);
    expect(rows.some((row) => row.regions.length > 1)).toBe(true);
    const regions = rows.flatMap((row) => row.regions);
    for (let index = 1; index < regions.length; index += 1) {
      expect(regions[index][0].midi).toBeGreaterThan(regions[index - 1].at(-1)!.midi + 1);
    }
  });

  it("retains dense black-key selections across row boundaries", () => {
    const notes = ["A0", "A#0", "B0", "C1", "C#1", "D1", "D#1", "E1", "F1", "F#1", "G1", "G#1", "A1", "A#1", "B1", "C2"];
    expectVisibleLayout(notes, 180);
  });

  it("uses more rows when all 88 keys cannot physically fit in two", () => {
    const rows = getCompactKeyboardLayout(new Set(Array.from({ length: 88 }, (_, i) => i + 21)), 280);
    expect(rows.length).toBeGreaterThan(2);
    const visible = new Set(rows.flatMap((row) => row.regions.flatMap((region) => region.map((key) => key.midi))));
    expect(visible.size).toBe(88);
  });
});

describe("phone width pitch preservation", () => {
  it.each([284, 339, 354, 394])("keeps octave-separated and accidental pitches at %i px", (width) => {
    const notes = ["C2", "F#4", "C5", "G#5", "C8"];
    const selected = new Set(notes.map((note) => noteNameToMidi(note)!));
    const rows = getCompactKeyboardLayout(selected, width);
    const visible = new Set(rows.flatMap((row) => row.regions.flatMap((r) => r.map((key) => key.midi))));
    for (const midi of selected) expect(visible.has(midi)).toBe(true);
    for (const row of rows) {
      const size = row.regions.reduce((sum, region) => sum + region.filter((k) => !k.isBlack).length * row.whiteKeyWidth + KEYBOARD_REGION_PADDING, 0) + (row.regions.length - 1) * KEYBOARD_REGION_GAP;
      expect(size).toBeLessThanOrEqual(width + 1);
    }
  });
});
