/**
 * Shared access to the per-work practice session store (tempo, metronome…).
 * Both the metronome UI and the score player read the tempo from here so there
 * is a single source of truth for the storage key and clamping rules.
 */

export const DEFAULT_PRACTICE_TEMPO = 72;
const MIN_TEMPO = 30;
const MAX_TEMPO = 240;

export function practiceSessionStorageKey(workId: string) {
  return `piano-score-coach:practice-session:${workId}`;
}

export function clampPracticeTempo(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_PRACTICE_TEMPO;
  }

  return Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, Math.round(value)));
}

/** Read the saved tempo for a work, falling back to the default. */
export function readPracticeTempo(workId: string): number {
  if (typeof window === "undefined") {
    return DEFAULT_PRACTICE_TEMPO;
  }

  try {
    const raw = window.localStorage.getItem(practiceSessionStorageKey(workId));

    if (!raw) {
      return DEFAULT_PRACTICE_TEMPO;
    }

    const parsed = JSON.parse(raw) as { tempo?: unknown };

    return clampPracticeTempo(Number(parsed.tempo ?? DEFAULT_PRACTICE_TEMPO));
  } catch {
    return DEFAULT_PRACTICE_TEMPO;
  }
}
