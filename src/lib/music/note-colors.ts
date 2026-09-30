import { noteNameToMidi } from "@/lib/music/piano";

/**
 * How many distinct note colors the palette offers. Each visible MIDI pitch
 * gets its own color so the same note can be traced across the score, card
 * list, fretboard marker, and piano key. Current and next events rarely exceed
 * a handful of notes together; when they do, colors cycle.
 *
 * The concrete color values live in `globals.css` as `--note-fill-{n}` (used on
 * the physical instruments, which never darken) and `--note-accent-{n}` (used
 * for chips and labels on card surfaces, which do). Index 0 is amber, so a
 * chord's first note keeps the familiar warm tone.
 */
export const NOTE_COLOR_COUNT = 6;

/**
 * Assign a color index to every note, keyed by MIDI in order of first
 * appearance. Keying by MIDI (not pitch class) means D4 and D3 get different
 * colors even though they share a letter — exactly the two positions a player
 * needs to tell apart on the keyboard or fretboard.
 *
 * Callers that show current and preview notes together should use
 * `assignVisibleNoteColors` so a pitch has only one hue on the screen. The
 * current/preview distinction is carried by fill vs. outline, not another
 * palette.
 */
export function assignNoteColors(notes: readonly string[]): Map<number, number> {
  const colors = new Map<number, number>();

  for (const note of notes) {
    const midi = noteNameToMidi(note);

    if (midi === null || colors.has(midi)) {
      continue;
    }

    colors.set(midi, colors.size % NOTE_COLOR_COUNT);
  }

  return colors;
}

/**
 * Build one color map for the notes visible in the current and next events.
 * Current notes claim palette slots first; preview notes reuse an existing MIDI
 * color or take the next free slot.
 */
export function assignVisibleNoteColors(
  currentNotes: readonly string[],
  previewNotes: readonly string[],
) {
  return assignNoteColors([...currentNotes, ...previewNotes]);
}
