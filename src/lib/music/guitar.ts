import { midiToNoteName, noteNameToMidi } from "@/lib/music/piano";

export type GuitarStringNumber = 1 | 2 | 3 | 4 | 5 | 6;
export type GuitarFret = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
export type GuitarTuning = Readonly<Record<GuitarStringNumber, string>>;

export type GuitarPosition = {
  stringNumber: GuitarStringNumber;
  fret: GuitarFret;
  midi: number;
  noteName: string;
};

export type GuitarRecommendedShape = {
  status: "ideal" | "approximate" | "unavailable";
  positions: GuitarPosition[];
  rootNote: string | null;
  message: string | null;
};

export type GuitarGuidance = {
  recommended: GuitarRecommendedShape;
  allPositions: Map<string, GuitarPosition[]>;
};

/** Standard tuning, written from the high E string (1) to the low E string (6). */
export const STANDARD_TUNING: GuitarTuning = {
  6: "E2",
  5: "A2",
  4: "D3",
  3: "G3",
  2: "B3",
  1: "E4",
};

export const DROP_D_TUNING: GuitarTuning = {
  ...STANDARD_TUNING,
  6: "D2",
};

export const GUITAR_TUNING_PRESETS = [
  { value: "standard", label: "标准调弦 E A D G B E", tuning: STANDARD_TUNING },
  { value: "drop_d", label: "Drop D（六弦降到 D）", tuning: DROP_D_TUNING },
] as const satisfies readonly {
  value: string;
  label: string;
  tuning: GuitarTuning;
}[];

/** A broad chromatic range for standard, drop, baritone, and custom tunings. */
export const GUITAR_TUNING_NOTE_OPTIONS = Array.from(
  { length: 49 },
  (_, index) => midiToNoteName(24 + index),
).filter((noteName): noteName is string => noteName.length > 0);

export const MAX_FRET = 12;

const IDEAL_FRET_SPAN = 4;

type NoteEntry = {
  noteName: string;
  positions: GuitarPosition[];
};

type ShapeSearchState = {
  stringMask: number;
  positions: GuitarPosition[];
  minFret: number;
  maxFret: number;
  additiveScore: number;
};

function buildPositionsForNote(
  noteName: string,
  tuning: GuitarTuning,
): GuitarPosition[] {
  const midi = noteNameToMidi(noteName);

  if (midi === null) {
    return [];
  }

  const positions: GuitarPosition[] = [];

  for (const stringNumber of ([
    1, 2, 3, 4, 5, 6,
  ] satisfies GuitarStringNumber[])) {
    const openStringMidi = noteNameToMidi(tuning[stringNumber]);

    if (openStringMidi === null) {
      continue;
    }

    const fret = midi - openStringMidi;

    if (fret < 0 || fret > MAX_FRET) {
      continue;
    }

    positions.push({
      stringNumber,
      fret: fret as GuitarFret,
      midi,
      noteName,
    });
  }

  return positions.sort(
    (left, right) => left.fret - right.fret || left.stringNumber - right.stringNumber,
  );
}

function pickRecommendedShape(
  notes: readonly NoteEntry[],
  invalidNotes: readonly string[] = [],
): GuitarRecommendedShape {
  const rootNote = notes[0]?.noteName ?? invalidNotes[0] ?? null;

  if (notes.length === 0 && invalidNotes.length === 0) {
    return {
      status: "unavailable",
      positions: [],
      rootNote: null,
      message: "未选择音符",
    };
  }

  const best = searchCompactShape(notes);

  if (!best || best.length === 0) {
    const unavailableNotes = notes
      .filter((note) => note.positions.length === 0)
      .map((note) => note.noteName);
    const unavailableMessages = [
      invalidNotes.length > 0
        ? `无法识别音符：${invalidNotes.join("、")}`
        : null,
      unavailableNotes.length > 0
        ? `无法在前 ${MAX_FRET} 品找到 ${unavailableNotes.join("、")} 的按法`
        : null,
    ].filter((message): message is string => message !== null);

    return {
      status: "unavailable",
      positions: [],
      rootNote,
      message: unavailableMessages.join("；") || "这些音符无法在不同琴弦上同时找到按法",
    };
  }

  const coveredMidis = new Set(best.map((position) => position.midi));
  const unavailableNotes = notes
    .filter((note) => note.positions.length === 0)
    .map((note) => note.noteName);
  const missingPlayableNotes = notes
    .filter((note) => {
      const midi = note.positions[0]?.midi;
      return midi !== undefined && !coveredMidis.has(midi);
    })
    .map((note) => note.noteName);
  const frets = best.map((position) => position.fret);
  const minFret = Math.min(...frets);
  const maxFret = Math.max(...frets);
  const span = maxFret - minFret;
  const isPartial =
    invalidNotes.length > 0 ||
    unavailableNotes.length > 0 ||
    missingPlayableNotes.length > 0;
  const status = isPartial || span > IDEAL_FRET_SPAN ? "approximate" : "ideal";

  let message: string | null = null;

  if (isPartial) {
    const partialMessages = [
      invalidNotes.length > 0
        ? `无法识别音符：${invalidNotes.join("、")}`
        : null,
      unavailableNotes.length > 0
        ? `前 ${MAX_FRET} 品没有 ${unavailableNotes.join("、")} 的按法`
        : null,
      missingPlayableNotes.length > 0
        ? `无法组成完整把位，以下显示可用参考位置；未覆盖：${missingPlayableNotes.join("、")}`
        : null,
      missingPlayableNotes.length === 0 &&
      (invalidNotes.length > 0 || unavailableNotes.length > 0)
        ? "以下显示其余可用音的参考位置"
        : null,
    ].filter((part): part is string => part !== null);
    message = partialMessages.join("；");
  } else if (status === "approximate") {
    message = "推荐形状跨度较大，仅作参考";
  }

  return {
    status,
    positions: best,
    rootNote,
    message,
  };
}

export function getGuitarGuidanceForNotes(
  notes: readonly string[],
  tuning: GuitarTuning = STANDARD_TUNING,
): GuitarGuidance {
  const allPositions = new Map<string, GuitarPosition[]>();
  const entries: NoteEntry[] = [];
  const seenMidi = new Set<number>();
  const invalidNotes: string[] = [];

  for (const note of notes) {
    const noteName = note.trim();
    const midi = noteNameToMidi(noteName);

    if (midi === null) {
      if (noteName) {
        invalidNotes.push(noteName);
      }
      continue;
    }

    const positions = buildPositionsForNote(noteName, tuning);

    if (positions.length > 0) {
      allPositions.set(noteName, positions);
    }

    // A chord may spell the same sounding pitch twice (for example B#4 and
    // C5).  It only needs one physical marker and one string in a recommended
    // shape, while each written spelling still gets its own lookup entry.
    if (!seenMidi.has(midi)) {
      seenMidi.add(midi);
      entries.push({ noteName, positions });
    }
  }

  const recommended = pickRecommendedShape(entries, invalidNotes);

  return {
    recommended,
    allPositions,
  };
}

export function normalizeGuitarTuning(value: unknown): GuitarTuning {
  if (!value || typeof value !== "object") {
    return STANDARD_TUNING;
  }

  const record = value as Record<string, unknown>;
  const normalized = {} as Record<GuitarStringNumber, string>;

  for (const stringNumber of [1, 2, 3, 4, 5, 6] as const) {
    const candidate = record[stringNumber] ?? record[String(stringNumber)];
    const noteName = typeof candidate === "string" ? candidate.trim() : "";
    const midi = noteNameToMidi(noteName);

    normalized[stringNumber] =
      noteName.length > 0 && midi !== null
        ? midiToNoteName(midi)
        : STANDARD_TUNING[stringNumber];
  }

  return normalized;
}

export function areGuitarTuningsEqual(left: GuitarTuning, right: GuitarTuning) {
  return ([1, 2, 3, 4, 5, 6] as const).every(
    (stringNumber) => left[stringNumber] === right[stringNumber],
  );
}

/**
 * Search distinct-string combinations and choose the most compact one. When a
 * complete shape is impossible, keep the largest usable subset so the UI can
 * still show concrete reference positions instead of going blank.
 *
 * The state space is bounded by six string bits and the 0-12 fret range. This
 * keeps long edited note lists from turning into an exponential search while
 * still preserving the exact score used for normal chords.
 */
function searchCompactShape(
  notes: readonly NoteEntry[],
): GuitarPosition[] | null {
  let states = new Map<string, ShapeSearchState>([
    [
      "0",
      {
        stringMask: 0,
        positions: [],
        minFret: MAX_FRET + 1,
        maxFret: -1,
        additiveScore: 0,
      },
    ],
  ]);

  for (const entry of notes) {
    // Copying the prior states represents skipping this note. New states are
    // built only from the prior map, so one note can never occupy two strings.
    const nextStates = new Map(states);

    for (const state of states.values()) {
      for (const candidate of entry.positions) {
        const stringBit = 1 << (candidate.stringNumber - 1);

        if ((state.stringMask & stringBit) !== 0) {
          continue;
        }

        const stringMask = state.stringMask | stringBit;
        const minFret =
          state.positions.length === 0
            ? candidate.fret
            : Math.min(state.minFret, candidate.fret);
        const maxFret = Math.max(state.maxFret, candidate.fret);
        const additiveScore =
          state.additiveScore +
          candidate.fret -
          (candidate.fret === 0 ? 0.25 : 0);
        const key = `${stringMask}:${minFret}:${maxFret}`;
        const existing = nextStates.get(key);

        // For an equal mask and fret range, the remaining score is additive,
        // so only the lowest-cost shape can be useful to later notes.
        if (!existing || additiveScore < existing.additiveScore) {
          nextStates.set(key, {
            stringMask,
            positions: [...state.positions, candidate],
            minFret,
            maxFret,
            additiveScore,
          });
        }
      }
    }

    states = nextStates;
  }

  let best: GuitarPosition[] | null = null;
  let bestCoveredCount = 0;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const state of states.values()) {
    if (state.positions.length === 0) {
      continue;
    }

    const score = scoreShape(state.positions);

    if (
      state.positions.length > bestCoveredCount ||
      (state.positions.length === bestCoveredCount && score < bestScore)
    ) {
      best = state.positions;
      bestCoveredCount = state.positions.length;
      bestScore = score;
    }
  }

  return best;
}

function scoreShape(positions: readonly GuitarPosition[]) {
  const frets = positions.map((position) => position.fret);
  const minFret = Math.min(...frets);
  const maxFret = Math.max(...frets);
  const span = maxFret - minFret;
  const totalFret = frets.reduce<number>((sum, fret) => sum + fret, 0);
  const openStringBonus = frets.filter((fret) => fret === 0).length;

  // Span is the dominant cost: a compact hand shape is easier to practise.
  // The remaining terms make ties deterministic and prefer lower positions,
  // then open strings.
  return span * 1_000 + maxFret * 10 + totalFret - openStringBonus * 0.25;
}
