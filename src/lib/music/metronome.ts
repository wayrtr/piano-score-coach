export const METRONOME_METERS = [
  "2/4",
  "3/4",
  "4/4",
  "5/4",
  "6/8",
  "7/8",
  "9/8",
  "12/8",
] as const;

export type MetronomeMeter = (typeof METRONOME_METERS)[number];

export const METRONOME_ACCENT_LEVELS = [
  "silent",
  "normal",
  "accent",
  "strong",
] as const;

export type MetronomeAccentLevel = (typeof METRONOME_ACCENT_LEVELS)[number];

export const DEFAULT_METRONOME_METER: MetronomeMeter = "4/4";
export const DEFAULT_METRONOME_VOLUME = 75;

const MAX_METRONOME_GAIN = 0.3;

const BEAT_COUNT_BY_METER = {
  "2/4": 2,
  "3/4": 3,
  "4/4": 4,
  "5/4": 5,
  "6/8": 6,
  "7/8": 7,
  "9/8": 9,
  "12/8": 12,
} as const satisfies Record<MetronomeMeter, number>;

const DEFAULT_PATTERN_BY_METER = {
  "2/4": ["strong", "normal"],
  "3/4": ["strong", "normal", "normal"],
  "4/4": ["strong", "normal", "accent", "normal"],
  "5/4": ["strong", "normal", "accent", "normal", "normal"],
  "6/8": ["strong", "normal", "normal", "accent", "normal", "normal"],
  "7/8": ["strong", "normal", "accent", "normal", "accent", "normal", "normal"],
  "9/8": ["strong", "normal", "normal", "accent", "normal", "normal", "accent", "normal", "normal"],
  "12/8": [
    "strong",
    "normal",
    "normal",
    "accent",
    "normal",
    "normal",
    "accent",
    "normal",
    "normal",
    "accent",
    "normal",
    "normal",
  ],
} as const satisfies Record<MetronomeMeter, readonly MetronomeAccentLevel[]>;

const GAIN_MULTIPLIER_BY_ACCENT = {
  silent: 0,
  normal: 0.5,
  accent: 0.75,
  strong: 1,
} as const satisfies Record<MetronomeAccentLevel, number>;

export function normalizeMetronomeMeter(value: unknown): MetronomeMeter {
  return typeof value === "string" &&
    (METRONOME_METERS as readonly string[]).includes(value)
    ? (value as MetronomeMeter)
    : DEFAULT_METRONOME_METER;
}

export function getMetronomeBeatCount(meter: unknown) {
  return BEAT_COUNT_BY_METER[normalizeMetronomeMeter(meter)];
}

export function getDefaultMetronomePattern(
  meter: unknown,
): MetronomeAccentLevel[] {
  return [...DEFAULT_PATTERN_BY_METER[normalizeMetronomeMeter(meter)]];
}

export function normalizeMetronomePattern(
  value: unknown,
  meter: unknown,
): MetronomeAccentLevel[] {
  const defaults = getDefaultMetronomePattern(meter);

  if (!Array.isArray(value)) {
    return defaults;
  }

  return defaults.map((fallback, index) => {
    const candidate = value[index];

    return isMetronomeAccentLevel(candidate) ? candidate : fallback;
  });
}

export function clampMetronomeVolume(value: unknown) {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_METRONOME_VOLUME;
  }

  return Math.min(100, Math.max(0, Math.round(numericValue)));
}

export function getMetronomeAccentGain(
  volume: unknown,
  accentLevel: unknown,
) {
  const normalizedAccent = isMetronomeAccentLevel(accentLevel)
    ? accentLevel
    : "normal";

  return (
    MAX_METRONOME_GAIN *
    (clampMetronomeVolume(volume) / 100) *
    GAIN_MULTIPLIER_BY_ACCENT[normalizedAccent]
  );
}

function isMetronomeAccentLevel(
  value: unknown,
): value is MetronomeAccentLevel {
  return typeof value === "string" &&
    (METRONOME_ACCENT_LEVELS as readonly string[]).includes(value);
}
