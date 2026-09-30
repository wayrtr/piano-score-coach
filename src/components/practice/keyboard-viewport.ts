const DEFAULT_FALLBACK_CENTER_RATIO = 0.46;

type CalculateKeyboardViewportInput = {
  activeRangeStart: number | null;
  activeRangeEnd: number | null;
  contentWidth: number;
  viewportWidth: number;
  fallbackCenterRatio?: number;
};

export function calculateKeyboardScrollLeft(
  input: CalculateKeyboardViewportInput,
) {
  const maxScrollLeft = Math.max(0, input.contentWidth - input.viewportWidth);

  if (maxScrollLeft === 0) {
    return 0;
  }

  if (
    input.activeRangeStart === null ||
    input.activeRangeEnd === null ||
    Number.isNaN(input.activeRangeStart) ||
    Number.isNaN(input.activeRangeEnd)
  ) {
    const fallbackCenter =
      input.contentWidth *
      (input.fallbackCenterRatio ?? DEFAULT_FALLBACK_CENTER_RATIO);

    return clampScrollLeft(fallbackCenter - input.viewportWidth / 2, maxScrollLeft);
  }

  const rangeCenter = (input.activeRangeStart + input.activeRangeEnd) / 2;

  return clampScrollLeft(rangeCenter - input.viewportWidth / 2, maxScrollLeft);
}

function clampScrollLeft(value: number, maxScrollLeft: number) {
  return Math.min(Math.max(0, Math.round(value)), maxScrollLeft);
}
