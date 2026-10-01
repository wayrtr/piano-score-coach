/**
 * Shared note-name parsing and display helpers.
 *
 * MusicXML keeps the written spelling of a note (for example B#4), while an
 * instrument needs the sounding MIDI key (C5 in that example).  Keeping the
 * two concepts together prevents each instrument view from having to parse
 * accidentals independently.
 */

export type NoteLetter = "A" | "B" | "C" | "D" | "E" | "F" | "G";

export type NoteAccidentalStyle = "ascii" | "unicode";

export type ParsedNoteName = {
  input: string;
  letter: NoteLetter;
  accidental: number;
  octave: number;
  midi: number;
};

const NOTE_BASE_OFFSETS: Record<NoteLetter, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const SHARP_NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

/**
 * Parse a written note name, including double accidentals and their Unicode
 * equivalents.  The parser deliberately does not clamp to the piano range;
 * callers can decide whether a parsed MIDI value is playable on their
 * instrument.
 */
export function parseNoteName(noteName: string): ParsedNoteName | null {
  const input = noteName.trim();
  const match = input.match(
    /^([A-Ga-g])((?:[#♯]{1,2}|[b♭]{1,2}|[𝄪𝄫]|[xX])?)(-?\d+)$/u,
  );

  if (!match) {
    return null;
  }

  const [, letterRaw, accidentalRaw, octaveRaw] = match;
  const letter = letterRaw.toUpperCase() as NoteLetter;
  const octave = Number.parseInt(octaveRaw, 10);

  if (!Number.isSafeInteger(octave) || NOTE_BASE_OFFSETS[letter] === undefined) {
    return null;
  }

  const accidental = parseAccidental(accidentalRaw);
  const midi = 12 * (octave + 1) + NOTE_BASE_OFFSETS[letter] + accidental;
  if (!Number.isSafeInteger(midi)) {
    return null;
  }

  return {
    input,
    letter,
    accidental,
    octave,
    midi,
  };
}

function parseAccidental(raw: string) {
  let accidental = 0;

  for (const symbol of raw) {
    if (symbol === "#" || symbol === "♯" || symbol === "x" || symbol === "X") {
      accidental += symbol === "x" || symbol === "X" ? 2 : 1;
      continue;
    }

    if (symbol === "b" || symbol === "♭") {
      accidental -= 1;
      continue;
    }

    if (symbol === "\u{1d12a}") {
      accidental += 2;
      continue;
    }

    if (symbol === "\u{1d12b}") {
      accidental -= 2;
    }
  }

  return accidental;
}

export function formatParsedNoteName(
  note: Pick<ParsedNoteName, "letter" | "accidental" | "octave">,
  style: NoteAccidentalStyle = "ascii",
) {
  const accidentalSymbol = style === "unicode" ? { sharp: "♯", flat: "♭" } : { sharp: "#", flat: "b" };
  const accidental =
    note.accidental > 0
      ? accidentalSymbol.sharp.repeat(note.accidental)
      : accidentalSymbol.flat.repeat(Math.abs(note.accidental));

  return `${note.letter}${accidental}${note.octave}`;
}

/**
 * Normalize casing and accidental glyphs while retaining the written
 * enharmonic spelling.  For example, `b♯4` becomes `B#4`; it does not become
 * `C5`, because the latter is the sounding name and is exposed separately.
 */
export function normalizeNoteName(noteName: string) {
  const parsed = parseNoteName(noteName);

  return parsed ? formatParsedNoteName(parsed, "ascii") : null;
}

/** Return the canonical sharp spelling for a MIDI pitch. */
export function midiToSharpNoteName(midi: number) {
  if (!Number.isSafeInteger(midi)) {
    return null;
  }

  const pitchClass = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;

  return `${SHARP_NOTE_NAMES[pitchClass]}${octave}`;
}

export type NoteDisplay = {
  written: string;
  sounding: string | null;
  midi: number | null;
  hasEnharmonicEquivalent: boolean;
};

/**
 * Build the two labels users need when a score spelling differs from a
 * physical key.  `B♯4` therefore renders as `B♯4（对应琴键 C5）` while a plain
 * `C5` stays compact.
 */
export function describeNote(
  noteName: string,
  options: {
    style?: NoteAccidentalStyle;
    equivalentLabel?: string;
  } = {},
): NoteDisplay {
  const parsed = parseNoteName(noteName);
  const style = options.style ?? "unicode";

  if (!parsed) {
    return {
      written: noteName,
      sounding: null,
      midi: null,
      hasEnharmonicEquivalent: false,
    };
  }

  const written = formatParsedNoteName(parsed, style);
  const sounding = midiToSharpNoteName(parsed.midi);
  const soundingParsed = sounding ? parseNoteName(sounding) : null;
  const hasEnharmonicEquivalent =
    soundingParsed !== null &&
    (soundingParsed.letter !== parsed.letter ||
      soundingParsed.accidental !== parsed.accidental ||
      soundingParsed.octave !== parsed.octave);

  return {
    written,
    sounding,
    midi: parsed.midi,
    hasEnharmonicEquivalent,
  };
}

export function formatNoteWithSoundingEquivalent(
  noteName: string,
  options: {
    style?: NoteAccidentalStyle;
    equivalentLabel?: string;
  } = {},
) {
  const display = describeNote(noteName, options);

  if (!display.hasEnharmonicEquivalent || !display.sounding) {
    return display.written;
  }

  const style = options.style ?? "unicode";
  const sounding = style === "unicode"
    ? formatParsedNoteName(parseNoteName(display.sounding)!, style)
    : display.sounding;

  return `${display.written}（${options.equivalentLabel ?? "对应琴键"} ${sounding}）`;
}
