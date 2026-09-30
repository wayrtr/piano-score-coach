import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_PRACTICE_TEMPO,
  clampPracticeTempo,
  practiceSessionStorageKey,
  readPracticeTempo,
} from "@/lib/practice/session-settings";

describe("practice session settings", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("builds the per-work storage key used by the metronome store", () => {
    expect(practiceSessionStorageKey("abc")).toBe(
      "piano-score-coach:practice-session:abc",
    );
  });

  it("clamps tempo into the supported range", () => {
    expect(clampPracticeTempo(5)).toBe(30);
    expect(clampPracticeTempo(999)).toBe(240);
    expect(clampPracticeTempo(120.4)).toBe(120);
    expect(clampPracticeTempo(Number.NaN)).toBe(DEFAULT_PRACTICE_TEMPO);
  });

  it("reads a saved tempo and falls back when absent or malformed", () => {
    expect(readPracticeTempo("missing")).toBe(DEFAULT_PRACTICE_TEMPO);

    window.localStorage.setItem(
      practiceSessionStorageKey("saved"),
      JSON.stringify({ tempo: 96 }),
    );
    expect(readPracticeTempo("saved")).toBe(96);

    window.localStorage.setItem(practiceSessionStorageKey("broken"), "not json");
    expect(readPracticeTempo("broken")).toBe(DEFAULT_PRACTICE_TEMPO);
  });
});
