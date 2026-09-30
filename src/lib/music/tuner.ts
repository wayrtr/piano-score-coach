import { parseNoteName } from "@/lib/music/notes";
import type {
  GuitarStringNumber,
  GuitarTuning,
} from "@/lib/music/guitar";

export type PitchDetection = {
  frequency: number;
  clarity: number;
};

export type GuitarStringDetection = {
  stringNumber: GuitarStringNumber;
  noteName: string;
  targetFrequency: number;
  cents: number;
};

const CONCERT_A_MIDI = 69;
const CONCERT_A_FREQUENCY = 440;
const DEFAULT_MIN_FREQUENCY = 28;
const DEFAULT_MAX_FREQUENCY = 600;
const MINIMUM_SIGNAL_RMS = 0.008;
const YIN_THRESHOLD = 0.14;
const MINIMUM_STRING_TRACKING_CLARITY = 0.8;
const REQUIRED_MATCHING_STRING_READINGS = 3;
const SILENT_READINGS_TO_RELEASE_STRING = 3;
const STRING_SWITCH_HYSTERESIS_CENTS = 30;
const TARGET_TIE_EPSILON_CENTS = 0.01;
const GUITAR_STRING_NUMBERS = [1, 2, 3, 4, 5, 6] as const satisfies readonly GuitarStringNumber[];

export function getTuningTargetFrequency(noteName: string) {
  const parsed = parseNoteName(noteName);

  if (!parsed) {
    return null;
  }

  return (
    CONCERT_A_FREQUENCY *
    2 ** ((parsed.midi - CONCERT_A_MIDI) / 12)
  );
}

export function getCentsOffset(frequency: number, targetFrequency: number) {
  if (
    !Number.isFinite(frequency) ||
    !Number.isFinite(targetFrequency) ||
    frequency <= 0 ||
    targetFrequency <= 0
  ) {
    return null;
  }

  return 1_200 * Math.log2(frequency / targetFrequency);
}

/**
 * Map a detected pitch to the nearest open-string target in cents. A current
 * string gets a small Schmitt-style margin so noise around a boundary does not
 * make the UI alternate between adjacent strings. Exact ties are ambiguous on
 * a cold start because frequency alone cannot identify the physical string.
 */
export function getClosestGuitarString(
  frequency: number,
  tuning: GuitarTuning,
  currentString: GuitarStringNumber | null = null,
): GuitarStringDetection | null {
  if (!Number.isFinite(frequency) || frequency <= 0) {
    return null;
  }

  const detections: GuitarStringDetection[] = [];

  for (const stringNumber of GUITAR_STRING_NUMBERS) {
    const noteName = tuning[stringNumber];
    const targetFrequency = getTuningTargetFrequency(noteName);
    const cents =
      targetFrequency === null
        ? null
        : getCentsOffset(frequency, targetFrequency);

    if (targetFrequency === null || cents === null) {
      continue;
    }

    const detection = { stringNumber, noteName, targetFrequency, cents };

    detections.push(detection);
  }

  if (detections.length === 0) {
    return null;
  }

  const closestDistance = Math.min(
    ...detections.map((detection) => Math.abs(detection.cents)),
  );
  const closestMatches = detections.filter(
    (detection) =>
      Math.abs(Math.abs(detection.cents) - closestDistance) <=
      TARGET_TIE_EPSILON_CENTS,
  );
  const current =
    currentString === null
      ? null
      : detections.find(
          (detection) => detection.stringNumber === currentString,
        ) ?? null;
  const closest =
    closestMatches.length === 1
      ? closestMatches[0]
      : current !== null &&
          closestMatches.some(
            (detection) => detection.stringNumber === current.stringNumber,
          )
        ? current
        : null;

  if (closest === null) {
    return null;
  }

  if (
    current !== null &&
    closest.stringNumber !== current.stringNumber &&
    Math.abs(current.cents) - Math.abs(closest.cents) <
      STRING_SWITCH_HYSTERESIS_CENTS
  ) {
    return current;
  }

  return closest;
}

/**
 * Keep automatic string selection stable across microphone frames. Pitch
 * clarity gates candidates, three matching frames confirm a switch, and three
 * silent frames release the internal lock for the next pluck.
 */
export function createGuitarStringTracker() {
  let selectedString: GuitarStringNumber | null = null;
  let candidateString: GuitarStringNumber | null = null;
  let matchingReadings = 0;
  let silentReadings = 0;
  let tuningSignature: string | null = null;

  function resetReadings() {
    selectedString = null;
    candidateString = null;
    matchingReadings = 0;
    silentReadings = 0;
  }

  return {
    update(reading: PitchDetection | null, tuning: GuitarTuning) {
      const nextTuningSignature = GUITAR_STRING_NUMBERS.map(
        (stringNumber) => tuning[stringNumber],
      ).join("\u0000");

      if (nextTuningSignature !== tuningSignature) {
        resetReadings();
        tuningSignature = nextTuningSignature;
      }

      if (reading === null) {
        silentReadings += 1;
        candidateString = null;
        matchingReadings = 0;

        if (silentReadings >= SILENT_READINGS_TO_RELEASE_STRING) {
          selectedString = null;
        }

        return selectedString;
      }

      if (
        !Number.isFinite(reading.clarity) ||
        reading.clarity < MINIMUM_STRING_TRACKING_CLARITY
      ) {
        candidateString = null;
        matchingReadings = 0;
        return selectedString;
      }

      silentReadings = 0;

      const detection = getClosestGuitarString(
        reading.frequency,
        tuning,
        selectedString,
      );

      if (detection === null || detection.stringNumber === selectedString) {
        candidateString = null;
        matchingReadings = 0;
        return selectedString;
      }

      if (detection.stringNumber === candidateString) {
        matchingReadings += 1;
      } else {
        candidateString = detection.stringNumber;
        matchingReadings = 1;
      }

      if (matchingReadings >= REQUIRED_MATCHING_STRING_READINGS) {
        selectedString = detection.stringNumber;
        candidateString = null;
        matchingReadings = 0;
      }

      return selectedString;
    },
    reset() {
      resetReadings();
    },
  };
}

/**
 * Detect a monophonic fundamental with the YIN cumulative-difference method.
 * The limited guitar range keeps this fast enough for a throttled browser
 * microphone loop while avoiding the octave mistakes of a simple FFT peak.
 */
export function detectPitch(
  samples: Float32Array,
  sampleRate: number,
  options: {
    minFrequency?: number;
    maxFrequency?: number;
  } = {},
): PitchDetection | null {
  if (samples.length < 32 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return null;
  }

  const minFrequency = Math.max(
    1,
    options.minFrequency ?? DEFAULT_MIN_FREQUENCY,
  );
  const maxFrequency = Math.max(
    minFrequency,
    options.maxFrequency ?? DEFAULT_MAX_FREQUENCY,
  );
  const minLag = Math.max(2, Math.floor(sampleRate / maxFrequency));
  const maxLag = Math.min(
    Math.floor(sampleRate / minFrequency),
    Math.floor(samples.length / 2),
  );

  if (minLag >= maxLag) {
    return null;
  }

  let squareSum = 0;

  for (const sample of samples) {
    squareSum += sample * sample;
  }

  const rms = Math.sqrt(squareSum / samples.length);

  if (rms < MINIMUM_SIGNAL_RMS) {
    return null;
  }

  const difference = new Float32Array(maxLag + 1);
  const comparisonLength = samples.length - maxLag;

  for (let lag = 1; lag <= maxLag; lag += 1) {
    let sum = 0;

    for (let index = 0; index < comparisonLength; index += 1) {
      const delta = samples[index] - samples[index + lag];
      sum += delta * delta;
    }

    difference[lag] = sum;
  }

  difference[0] = 1;
  let runningSum = 0;

  for (let lag = 1; lag <= maxLag; lag += 1) {
    runningSum += difference[lag];
    difference[lag] = runningSum === 0 ? 1 : (difference[lag] * lag) / runningSum;
  }

  let bestLag = -1;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    if (difference[lag] >= YIN_THRESHOLD) {
      continue;
    }

    bestLag = lag;

    while (
      bestLag + 1 <= maxLag &&
      difference[bestLag + 1] < difference[bestLag]
    ) {
      bestLag += 1;
    }

    break;
  }

  if (bestLag < 0) {
    let smallestDifference = Number.POSITIVE_INFINITY;

    for (let lag = minLag; lag <= maxLag; lag += 1) {
      if (difference[lag] < smallestDifference) {
        smallestDifference = difference[lag];
        bestLag = lag;
      }
    }

    if (bestLag < 0 || smallestDifference > 0.28) {
      return null;
    }
  }

  const refinedLag = refineLagWithParabola(difference, bestLag, maxLag);

  return {
    frequency: sampleRate / refinedLag,
    clarity: Math.max(0, Math.min(1, 1 - difference[bestLag])),
  };
}

function refineLagWithParabola(
  difference: Float32Array,
  lag: number,
  maxLag: number,
) {
  if (lag <= 1 || lag >= maxLag) {
    return lag;
  }

  const left = difference[lag - 1];
  const center = difference[lag];
  const right = difference[lag + 1];
  const denominator = left - 2 * center + right;

  if (Math.abs(denominator) < Number.EPSILON) {
    return lag;
  }

  const offset = 0.5 * (left - right) / denominator;

  return lag + Math.max(-1, Math.min(1, offset));
}
