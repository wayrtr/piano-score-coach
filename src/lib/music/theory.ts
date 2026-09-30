import { noteNameToMidi } from "@/lib/music/piano";

type KeyMode = "major" | "minor";

type TheoryChord = {
  symbol: string;
  notes: string[];
};

export type KeyTheory = {
  key: string;
  mode: KeyMode;
  scale: string[];
  triads: TheoryChord[];
  sevenths: TheoryChord[];
};

export type NoteInterval = {
  fromNote: string;
  toNote: string;
  semitones: number;
  intervalName: string;
  direction: "up" | "down" | "same";
};

const INTERVAL_NAMES: Record<number, string> = {
  0: "纯一度",
  1: "小二度",
  2: "大二度",
  3: "小三度",
  4: "大三度",
  5: "纯四度",
  6: "增四度（减五度）",
  7: "纯五度",
  8: "小六度",
  9: "大六度",
  10: "小七度",
  11: "大七度",
  12: "纯八度",
  13: "小九度",
  14: "大九度",
  15: "小十度",
  16: "大十度",
  17: "纯十一度",
  18: "增十一度",
  19: "纯十二度",
  20: "小十三度",
  21: "大十三度",
  22: "小十四度",
  23: "大十四度",
  24: "纯十五度（双八度）",
};

const MAJOR_SCALES: Record<string, string[]> = {
  "C major": ["C", "D", "E", "F", "G", "A", "B"],
  "G major": ["G", "A", "B", "C", "D", "E", "F#"],
  "D major": ["D", "E", "F#", "G", "A", "B", "C#"],
  "A major": ["A", "B", "C#", "D", "E", "F#", "G#"],
  "E major": ["E", "F#", "G#", "A", "B", "C#", "D#"],
  "B major": ["B", "C#", "D#", "E", "F#", "G#", "A#"],
  "F# major": ["F#", "G#", "A#", "B", "C#", "D#", "E#"],
  "C# major": ["C#", "D#", "E#", "F#", "G#", "A#", "B#"],
  "F major": ["F", "G", "A", "Bb", "C", "D", "E"],
  "Bb major": ["Bb", "C", "D", "Eb", "F", "G", "A"],
  "Eb major": ["Eb", "F", "G", "Ab", "Bb", "C", "D"],
  "Ab major": ["Ab", "Bb", "C", "Db", "Eb", "F", "G"],
  "Db major": ["Db", "Eb", "F", "Gb", "Ab", "Bb", "C"],
  "Gb major": ["Gb", "Ab", "Bb", "Cb", "Db", "Eb", "F"],
  "Cb major": ["Cb", "Db", "Eb", "Fb", "Gb", "Ab", "Bb"],
};

const NATURAL_MINOR_SCALES: Record<string, string[]> = {
  "A minor": ["A", "B", "C", "D", "E", "F", "G"],
  "E minor": ["E", "F#", "G", "A", "B", "C", "D"],
  "B minor": ["B", "C#", "D", "E", "F#", "G", "A"],
  "F# minor": ["F#", "G#", "A", "B", "C#", "D", "E"],
  "C# minor": ["C#", "D#", "E", "F#", "G#", "A", "B"],
  "G# minor": ["G#", "A#", "B", "C#", "D#", "E", "F#"],
  "D# minor": ["D#", "E#", "F#", "G#", "A#", "B", "C#"],
  "A# minor": ["A#", "B#", "C#", "D#", "E#", "F#", "G#"],
  "D minor": ["D", "E", "F", "G", "A", "Bb", "C"],
  "G minor": ["G", "A", "Bb", "C", "D", "Eb", "F"],
  "C minor": ["C", "D", "Eb", "F", "G", "Ab", "Bb"],
  "F minor": ["F", "G", "Ab", "Bb", "C", "Db", "Eb"],
  "Bb minor": ["Bb", "C", "Db", "Eb", "F", "Gb", "Ab"],
  "Eb minor": ["Eb", "F", "Gb", "Ab", "Bb", "Cb", "Db"],
  "Ab minor": ["Ab", "Bb", "Cb", "Db", "Eb", "Fb", "Gb"],
};

const MAJOR_TRIAD_SYMBOLS = ["I", "ii", "iii", "IV", "V", "vi", "vii°"];
const MAJOR_SEVENTH_SYMBOLS = [
  "Imaj7",
  "ii7",
  "iii7",
  "IVmaj7",
  "V7",
  "vi7",
  "viiø7",
];
const MINOR_TRIAD_SYMBOLS = ["i", "ii°", "III", "iv", "v", "VI", "VII"];
const MINOR_SEVENTH_SYMBOLS = [
  "i7",
  "iiø7",
  "IIImaj7",
  "iv7",
  "v7",
  "VImaj7",
  "VII7",
];

export function getSupportedKeys() {
  return [
    ...Object.keys(MAJOR_SCALES),
    ...Object.keys(NATURAL_MINOR_SCALES),
  ];
}

export function normalizeWorkKey(input: string | null | undefined) {
  if (!input) {
    return "C major";
  }

  const normalizedInput = input
    .trim()
    .replace(/♯/g, "#")
    .replace(/♭/g, "b")
    .replace(/\s+/g, " ");

  const match = getSupportedKeys().find(
    (candidate) => candidate.toLowerCase() === normalizedInput.toLowerCase(),
  );

  return match ?? "C major";
}

export function getIntervalNameFromSemitones(semitones: number) {
  if (!Number.isInteger(semitones) || semitones < 0) {
    return null;
  }

  if (semitones in INTERVAL_NAMES) {
    return INTERVAL_NAMES[semitones];
  }

  const octaveCount = Math.floor(semitones / 12);
  const remainder = semitones % 12;
  const remainderName = INTERVAL_NAMES[remainder];

  if (remainder === 0) {
    return `${octaveCount}个八度`;
  }

  return `${octaveCount}个八度 + ${remainderName}`;
}

export function getIntervalBetweenNotes(
  fromNote: string,
  toNote: string,
): NoteInterval | null {
  const fromMidi = noteNameToMidi(fromNote);
  const toMidi = noteNameToMidi(toNote);

  if (fromMidi === null || toMidi === null) {
    return null;
  }

  const semitoneDelta = toMidi - fromMidi;
  const semitones = Math.abs(semitoneDelta);
  const intervalName = getIntervalNameFromSemitones(semitones);

  if (!intervalName) {
    return null;
  }

  return {
    fromNote,
    toNote,
    semitones,
    intervalName,
    direction:
      semitoneDelta > 0 ? "up" : semitoneDelta < 0 ? "down" : "same",
  };
}

export function getTheoryForKey(input: string | null | undefined): KeyTheory {
  const key = normalizeWorkKey(input);
  const majorScale = MAJOR_SCALES[key];
  const mode: KeyMode = majorScale ? "major" : "minor";
  const scale = majorScale ?? NATURAL_MINOR_SCALES[key];

  return {
    key,
    mode,
    scale,
    triads: buildDiatonicChords(
      scale,
      mode === "major" ? MAJOR_TRIAD_SYMBOLS : MINOR_TRIAD_SYMBOLS,
      3,
    ),
    sevenths: buildDiatonicChords(
      scale,
      mode === "major" ? MAJOR_SEVENTH_SYMBOLS : MINOR_SEVENTH_SYMBOLS,
      4,
    ),
  };
}

function buildDiatonicChords(
  scale: string[],
  symbols: string[],
  size: 3 | 4,
) {
  return symbols.map((symbol, degreeIndex) => ({
    symbol,
    notes: Array.from({ length: size }, (_, offset) =>
      scale[(degreeIndex + offset * 2) % scale.length]
    ),
  }));
}
