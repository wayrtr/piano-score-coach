import { parseNoteName } from "@/lib/music/notes";

/**
 * Real-instrument sample playback. Replaces the additive synth for the two
 * timbres that have recorded samples: each semitone (MIDI 21-108) ships as its
 * own `.mp3` under `public/samples/<instrument>/<midi>.mp3` (see
 * `scripts/build-instrument-samples.mjs`). Because every note is sampled we can
 * play the buffer straight — no pitch-shifting — so pitch is exact and the
 * timbre is the genuine instrument.
 */
export type SampledInstrument = "piano" | "guitar-steel";

/** Lowest/highest sampled note; matches the FluidR3 piano range we shipped. */
const MIN_SAMPLE_MIDI = 21;
const MAX_SAMPLE_MIDI = 108;

/** Extra ring-out after a note's notated length, so releases sound natural. */
const RELEASE_SEC: Record<SampledInstrument, number> = {
  piano: 0.18,
  "guitar-steel": 0.32,
};

/** Tame per-note level so stacked chords don't clip the master bus. */
const SAMPLE_GAIN = 0.85;
const SILENCE = 0.0005;

/** Note name → the MIDI key whose sample we play, or null when off-range. */
export function noteNameToSampleMidi(noteName: string): number | null {
  const parsed = parseNoteName(noteName);

  if (!parsed) {
    return null;
  }

  if (parsed.midi < MIN_SAMPLE_MIDI || parsed.midi > MAX_SAMPLE_MIDI) {
    return null;
  }

  return parsed.midi;
}

function sampleUrl(instrument: SampledInstrument, midi: number) {
  return `/samples/${instrument}/${midi}.mp3`;
}

// Decoded buffers are cached per (instrument, midi). AudioBuffers are cheap to
// reuse across playbacks; keyed by instrument so switching timbres is instant
// once each has loaded. In-flight decodes are cached too, so a burst of
// requests for the same note doesn't fetch it more than once.
const bufferCache = new Map<string, AudioBuffer>();
const pendingCache = new Map<string, Promise<AudioBuffer | null>>();

function cacheKey(instrument: SampledInstrument, midi: number) {
  return `${instrument}:${midi}`;
}

async function loadSample(
  context: AudioContext,
  instrument: SampledInstrument,
  midi: number,
): Promise<AudioBuffer | null> {
  const key = cacheKey(instrument, midi);
  const cached = bufferCache.get(key);

  if (cached) {
    return cached;
  }

  const pending = pendingCache.get(key);

  if (pending) {
    return pending;
  }

  const request = (async () => {
    try {
      const response = await fetch(sampleUrl(instrument, midi));

      if (!response.ok) {
        return null;
      }

      const encoded = await response.arrayBuffer();
      const buffer = await context.decodeAudioData(encoded);
      bufferCache.set(key, buffer);
      return buffer;
    } catch {
      // A missing/unsupported sample should not break playback; the caller
      // falls back to the synth.
      return null;
    } finally {
      pendingCache.delete(key);
    }
  })();

  pendingCache.set(key, request);
  return request;
}

/**
 * Fetch + decode every distinct note up front so playback never stalls waiting
 * on the first sample of a note. Returns once all are resolved (missing ones
 * resolve to null and are simply skipped at play time).
 */
export async function preloadSamples(
  context: AudioContext,
  instrument: SampledInstrument,
  noteNames: Iterable<string>,
): Promise<void> {
  const midis = new Set<number>();

  for (const noteName of noteNames) {
    const midi = noteNameToSampleMidi(noteName);

    if (midi !== null) {
      midis.add(midi);
    }
  }

  await Promise.all([...midis].map((midi) => loadSample(context, instrument, midi)));
}

/**
 * Play one already-loaded sample. Returns the source node so the caller can
 * stop it early (e.g. on Stop), or null when the note isn't sampled/loaded —
 * the caller then decides whether to fall back to the synth.
 */
export function playSample(
  context: AudioContext,
  input: {
    instrument: SampledInstrument;
    noteName: string;
    startTime: number;
    durationSec: number;
    velocity?: number;
  },
): AudioBufferSourceNode | null {
  const midi = noteNameToSampleMidi(input.noteName);

  if (midi === null) {
    return null;
  }

  const buffer = bufferCache.get(cacheKey(input.instrument, midi));

  if (!buffer) {
    return null;
  }

  try {
    const start = Math.max(input.startTime, context.currentTime);
    const velocity = clamp01(input.velocity ?? 1);
    const peak = Math.max(SAMPLE_GAIN * velocity, SILENCE * 2);
    const release = RELEASE_SEC[input.instrument];
    // Let the note ring for its notated length, then fade over the release so
    // fast passages don't smear into each other. The recorded sample already
    // carries the instrument's own attack/decay, so we only shape the tail.
    const bodyEnd = start + Math.max(input.durationSec, 0.05);
    const releaseEnd = bodyEnd + release;

    const envelope = context.createGain();
    envelope.gain.setValueAtTime(peak, start);
    envelope.gain.setValueAtTime(peak, bodyEnd);
    envelope.gain.exponentialRampToValueAtTime(SILENCE, releaseEnd);
    envelope.connect(context.destination);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(envelope);
    source.start(start);
    source.stop(releaseEnd + 0.02);

    return source;
  } catch {
    return null;
  }
}

/** Test seam: drop cached buffers so a fresh context re-decodes. */
export function __clearSampleCache() {
  bufferCache.clear();
  pendingCache.clear();
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(1, Math.max(0, value));
}
