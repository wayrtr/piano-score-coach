import { describe, expect, it } from "vitest";

import { calculateKeyboardScrollLeft } from "@/components/practice/keyboard-viewport";

describe("calculateKeyboardScrollLeft", () => {
  it("centers the highlighted range inside the viewport when possible", () => {
    expect(
      calculateKeyboardScrollLeft({
        activeRangeStart: 640,
        activeRangeEnd: 760,
        contentWidth: 2200,
        viewportWidth: 600,
      }),
    ).toBe(400);
  });

  it("clamps to the left edge when the active range is near the beginning", () => {
    expect(
      calculateKeyboardScrollLeft({
        activeRangeStart: 80,
        activeRangeEnd: 140,
        contentWidth: 2200,
        viewportWidth: 600,
      }),
    ).toBe(0);
  });

  it("clamps to the right edge when the active range is near the end", () => {
    expect(
      calculateKeyboardScrollLeft({
        activeRangeStart: 2080,
        activeRangeEnd: 2140,
        contentWidth: 2200,
        viewportWidth: 600,
      }),
    ).toBe(1600);
  });

  it("falls back to a stable default practice zone when no note is selected", () => {
    expect(
      calculateKeyboardScrollLeft({
        activeRangeStart: null,
        activeRangeEnd: null,
        contentWidth: 2200,
        viewportWidth: 600,
      }),
    ).toBe(712);
  });
});
