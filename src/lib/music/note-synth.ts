import { parseNoteName } from "@/lib/music/notes";

export type NoteTimbre = "piano" | "guitar";

const CONCERT_A_MIDI = 69;
const CONCERT_A_FREQUENCY = 440;

/** Note name → frequency in Hz (equal temperament, A4 = 440), or null. */
export function noteNameToFrequency(noteName: string): number | null {
  const parsed = parseNoteName(noteName);

  if (!parsed) {
    return null;
  }

  return CONCERT_A_FREQUENCY * 2 ** ((parsed.midi - CONCERT_A_MIDI) / 12);
}

type Partial = { ratio: number; gain: number };

// Additive recipes: a handful of partials shape the timbre. Piano leans on a
// strong fundamental with a quick, glassy decay; guitar adds brighter upper
// partials for a plucked-string edge and rings a touch longer.
const TIMBRE: Record<
  NoteTimbre,
  {
    oscillator: OscillatorType;
    partials: Partial[];
    /** Time to rise from silence to the peak. */
    attackSec: number;
    /** Time to fall from the peak down to the sustain level. */
    decaySec: number;
    /** Held level as a fraction of the peak — this is what makes notes ring. */
    sustain: number;
    /** Extra time the note keeps fading after its notated length ends. */
    releaseSec: number;
    peakGain: number;
  }
> = {
  piano: {
    oscillator: "sine",
    partials: [
      { ratio: 1, gain: 1 },
      { ratio: 2, gain: 0.5 },
      { ratio: 3, gain: 0.26 },
      { ratio: 4, gain: 0.12 },
    ],
    attackSec: 0.006,
    decaySec: 0.12,
    // Hold most of the note's body so quarter/eighth notes actually connect
    // instead of dying into a click. A gentle body drift adds piano character.
    sustain: 0.62,
    releaseSec: 0.14,
    peakGain: 0.17,
  },
  guitar: {
    oscillator: "triangle",
    partials: [
      { ratio: 1, gain: 1 },
      { ratio: 2, gain: 0.62 },
      { ratio: 3, gain: 0.4 },
      { ratio: 4, gain: 0.22 },
    ],
    attackSec: 0.004,
    decaySec: 0.1,
    sustain: 0.6,
    releaseSec: 0.2,
    peakGain: 0.16,
  },
};

const MIN_RING_SEC = 0.16;
const MAX_RING_SEC = 6;
/** Floor for exponential ramps (they cannot reach true zero). */
const SILENCE = 0.0005;

/**
 * Schedule a single note on the given AudioContext. Best-effort: any Web Audio
 * failure is swallowed so playback control never breaks. Returns the oscillator
 * nodes so a caller can stop them early (e.g. on Stop); [] when nothing played.
 */
export function playNote(
  context: AudioContext,
  input: {
    frequency: number;
    startTime: number;
    durationSec: number;
    timbre: NoteTimbre;
    velocity?: number;
  },
): OscillatorNode[] {
  const { frequency, startTime, durationSec, timbre } = input;

  if (!Number.isFinite(frequency) || frequency <= 0) {
    return [];
  }

  const recipe = TIMBRE[timbre];
  const velocity = clamp01(input.velocity ?? 1);
  const body = Math.min(MAX_RING_SEC, Math.max(MIN_RING_SEC, durationSec));
  const start = Math.max(startTime, context.currentTime);
  const peak = Math.max(recipe.peakGain * velocity, SILENCE * 2);
  const sustainLevel = Math.max(peak * recipe.sustain, SILENCE * 2);

  try {
    // ADSR: rise to the peak, drop to a sustain level, HOLD that level across
    // the note's body (with a slight downward drift for realism), then release.
    // Holding the sustain is what gives the note continuity — the previous
    // envelope decayed straight to silence, which sounded like a metronome tick.
    const attackEnd = start + recipe.attackSec;
    const decayEnd = attackEnd + recipe.decaySec;
    const bodyEnd = Math.max(start + body, decayEnd + 0.02);
    const releaseEnd = bodyEnd + recipe.releaseSec;

    const envelope = context.createGain();
    envelope.gain.setValueAtTime(SILENCE, start);
    envelope.gain.exponentialRampToValueAtTime(peak, attackEnd);
    envelope.gain.exponentialRampToValueAtTime(sustainLevel, decayEnd);
    // Gentle drift down to 82% of sustain by the end of the body — keeps it
    // alive and natural rather than a flat organ tone.
    envelope.gain.exponentialRampToValueAtTime(
      Math.max(sustainLevel * 0.82, SILENCE * 2),
      bodyEnd,
    );
    envelope.gain.exponentialRampToValueAtTime(SILENCE, releaseEnd);
    envelope.connect(context.destination);

    const oscillators: OscillatorNode[] = [];

    for (const partial of recipe.partials) {
      const oscillator = context.createOscillator();
      const partialGain = context.createGain();

      oscillator.type = recipe.oscillator;
      oscillator.frequency.setValueAtTime(frequency * partial.ratio, start);
      partialGain.gain.setValueAtTime(partial.gain, start);
      oscillator.connect(partialGain);
      partialGain.connect(envelope);
      oscillator.start(start);
      oscillator.stop(releaseEnd + 0.02);
      oscillators.push(oscillator);
    }

    return oscillators;
  } catch {
    // Audio is optional; playback control stays usable without sound.
    return [];
  }
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(1, Math.max(0, value));
}
