import { midiToSharpNoteName, parseNoteName } from "@/lib/music/notes";

export {
  describeNote,
  formatNoteWithSoundingEquivalent,
  formatParsedNoteName,
  normalizeNoteName,
  parseNoteName,
} from "@/lib/music/notes";

export const PIANO_MIN_MIDI = 21;
export const PIANO_MAX_MIDI = 108;

export type PianoKey = {
  midi: number;
  noteName: string;
  isBlack: boolean;
};

export function noteNameToMidi(noteName: string) {
  const parsed = parseNoteName(noteName);

  if (!parsed) {
    return null;
  }

  const { midi } = parsed;

  if (midi < PIANO_MIN_MIDI || midi > PIANO_MAX_MIDI) {
    return null;
  }

  return midi;
}

export function midiToNoteName(midi: number) {
  return midiToSharpNoteName(midi) ?? "";
}

export function buildPianoKeys(): PianoKey[] {
  return Array.from(
    { length: PIANO_MAX_MIDI - PIANO_MIN_MIDI + 1 },
    (_, index) => {
      const midi = PIANO_MIN_MIDI + index;
      const noteName = midiToNoteName(midi);

      return {
        midi,
        noteName,
        isBlack: noteName.includes("#"),
      };
    },
  );
}
