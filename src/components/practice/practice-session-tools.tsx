"use client";

import { useEffect, useEffectEvent, useMemo, useSyncExternalStore } from "react";

import {
  DEFAULT_METRONOME_VOLUME,
  METRONOME_METERS,
  clampMetronomeVolume,
  getDefaultMetronomePattern,
  getMetronomeAccentGain,
  normalizeMetronomeMeter,
  normalizeMetronomePattern,
  type MetronomeAccentLevel,
  type MetronomeMeter,
} from "@/lib/music/metronome";
import {
  DEFAULT_PRACTICE_TEMPO,
  clampPracticeTempo,
  practiceSessionStorageKey,
} from "@/lib/practice/session-settings";

type PracticeSessionToolsProps = {
  workId: string;
  suggestedMeter?: string | null;
};

type SessionState = {
  tempo: number;
  metronome: boolean;
  metronomeVolume: number;
  metronomeMeter: MetronomeMeter;
  metronomePattern: MetronomeAccentLevel[];
};

const DEFAULT_TEMPO = DEFAULT_PRACTICE_TEMPO;
const METER_LABELS = {
  "2/4": "2/4",
  "3/4": "3/4",
  "4/4": "4/4",
  "5/4": "5/4",
  "6/8": "6/8",
  "7/8": "7/8",
  "9/8": "9/8",
  "12/8": "12/8",
} as const satisfies Record<MetronomeMeter, string>;

export function PracticeSessionTools({
  workId,
  suggestedMeter = null,
}: PracticeSessionToolsProps) {
  const defaults = useMemo(
    () => createDefaultState(suggestedMeter),
    [suggestedMeter],
  );
  const snapshot = usePracticeSessionSnapshot(workId, defaults);
  const session = useMemo(
    () => parseSessionState(snapshot, defaults),
    [defaults, snapshot],
  );
  const metronomeBeatCount = session.metronomePattern.length;
  const playCurrentMetronomeBeat = useEffectEvent((beatIndex: number) => {
    const accent = session.metronomePattern[beatIndex] ?? "normal";

    document.documentElement.classList.add("metronome-tick");
    window.setTimeout(() => document.documentElement.classList.remove("metronome-tick"), 100);
    playMetronomeTick(session.metronomeVolume, accent);
  });

  useEffect(() => {
    if (!session.metronome) {
      return;
    }

    let beatIndex = 0;
    const tick = () => {
      playCurrentMetronomeBeat(beatIndex);
      beatIndex = (beatIndex + 1) % metronomeBeatCount;
    };

    tick();
    const interval = window.setInterval(tick, Math.round(60_000 / session.tempo));

    return () => window.clearInterval(interval);
  }, [metronomeBeatCount, session.metronome, session.tempo]);

  function updateSession(patch: Partial<SessionState>) {
    writeSessionState(workId, { ...session, ...patch });
  }

  function commitTempo(input: HTMLInputElement) {
    const tempo = clampTempo(Number(input.value));

    input.value = String(tempo);
    updateSession({ tempo });
  }

  function updateMetronomeMeter(meter: MetronomeMeter) {
    updateSession({
      metronomeMeter: meter,
      metronomePattern: simplifyPattern(getDefaultMetronomePattern(meter)),
    });
  }

  function toggleBeatStrength(index: number) {
    const metronomePattern = session.metronomePattern.map((accent, beatIndex) =>
      beatIndex === index ? (accent === "strong" ? "normal" : "strong") : accent,
    );

    updateSession({ metronomePattern });
  }

  return (
    <section className="metronome-bar" aria-label="节拍器">
      <div className="metronome-bar-heading">
        <h2>节拍器</h2>
        <button
          type="button"
          className={`secondary-button session-toggle-button${session.metronome ? " is-active" : ""}`}
          aria-pressed={session.metronome}
          onClick={() => updateSession({ metronome: !session.metronome })}
        >
          {session.metronome ? "关闭" : "开启"}
        </button>
      </div>

      <label className="metronome-compact-control metronome-tempo-control">
        <span>速度</span>
        <input
          key={session.tempo}
          aria-label="速度（BPM）"
          name="practice-tempo"
          autoComplete="off"
          type="number"
          inputMode="numeric"
          min={30}
          max={240}
          step={1}
          defaultValue={session.tempo}
          onBlur={(event) => commitTempo(event.currentTarget)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }

            if (event.key === "Escape") {
              event.currentTarget.value = String(session.tempo);
              event.currentTarget.blur();
            }
          }}
        />
        <small>BPM</small>
      </label>

      <label className="metronome-compact-control metronome-volume-control">
        <span>音量</span>
        <input
          aria-label="节拍器音量"
          type="range"
          min={0}
          max={100}
          step={5}
          value={session.metronomeVolume}
          onChange={(event) =>
            updateSession({
              metronomeVolume: clampMetronomeVolume(event.target.value),
            })
          }
        />
        <output>{`${session.metronomeVolume}%`}</output>
      </label>

      <label className="metronome-compact-control metronome-meter-control">
        <span>拍号</span>
        <select
          aria-label="节拍器拍号"
          value={session.metronomeMeter}
          onChange={(event) =>
            updateMetronomeMeter(event.target.value as MetronomeMeter)
          }
        >
          {METRONOME_METERS.map((meter) => (
            <option key={meter} value={meter}>
              {METER_LABELS[meter]}
            </option>
          ))}
        </select>
      </label>

      <div className="metronome-pattern-control">
        <span className="control-label">强弱拍</span>
        <div className="metronome-beats" role="group" aria-label="节拍强弱编辑">
          {session.metronomePattern.map((accent, index) => {
            const isStrong = accent === "strong";

            return (
              <button
                key={`${session.metronomeMeter}-${index}`}
                type="button"
                className={`metronome-beat ${isStrong ? "is-strong" : "is-normal"}`}
                aria-label={`第 ${index + 1} 拍，${isStrong ? "强拍" : "弱拍"}`}
                aria-pressed={isStrong}
                onClick={() => toggleBeatStrength(index)}
              >
                <strong>{index + 1}</strong>
                <span>{isStrong ? "强" : "弱"}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function usePracticeSessionSnapshot(workId: string, defaults: SessionState) {
  const key = storageKey(workId);
  return useSyncExternalStore(
    (onStoreChange) => subscribeToSession(key, onStoreChange),
    () => readSessionSnapshot(key, defaults),
    () => JSON.stringify(defaults),
  );
}

function createDefaultState(suggestedMeter: string | null): SessionState {
  const metronomeMeter = normalizeMetronomeMeter(suggestedMeter);

  return {
    tempo: DEFAULT_TEMPO,
    metronome: false,
    metronomeVolume: DEFAULT_METRONOME_VOLUME,
    metronomeMeter,
    metronomePattern: simplifyPattern(getDefaultMetronomePattern(metronomeMeter)),
  };
}

function parseSessionState(snapshot: string, defaults: SessionState) {
  try {
    const parsed = JSON.parse(snapshot) as Partial<SessionState>;
    const metronomeMeter = normalizeMetronomeMeter(
      parsed.metronomeMeter ?? defaults.metronomeMeter,
    );

    return {
      tempo: clampTempo(parsed.tempo ?? defaults.tempo),
      metronome: parsed.metronome === true,
      metronomeVolume: clampMetronomeVolume(
        parsed.metronomeVolume ?? defaults.metronomeVolume,
      ),
      metronomeMeter,
      metronomePattern: simplifyPattern(
        normalizeMetronomePattern(parsed.metronomePattern, metronomeMeter),
      ),
    } satisfies SessionState;
  } catch {
    return defaults;
  }
}

function simplifyPattern(pattern: readonly MetronomeAccentLevel[]) {
  return pattern.map((accent) => (accent === "strong" ? "strong" : "normal"));
}

function subscribeToSession(key: string, onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(`piano-session:${key}`, onStoreChange);

  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(`piano-session:${key}`, onStoreChange);
  };
}

function readSessionSnapshot(key: string, defaults: SessionState) {
  if (typeof window === "undefined") {
    return JSON.stringify(defaults);
  }

  try {
    return window.localStorage.getItem(key) ?? JSON.stringify(defaults);
  } catch {
    return JSON.stringify(defaults);
  }
}

function writeSessionState(workId: string, state: SessionState) {
  if (typeof window === "undefined") {
    return;
  }

  const key = storageKey(workId);
  const value = JSON.stringify(state);
  try {
    window.localStorage.setItem(key, value);
    window.dispatchEvent(new Event(`piano-session:${key}`));
  } catch {
    // Private browsing or a full quota should not interrupt the practice flow.
  }
}

let metronomeAudioContext: AudioContext | null = null;

function playMetronomeTick(
  volume: number,
  accent: MetronomeAccentLevel,
) {
  const peakGain = getMetronomeAccentGain(volume, accent);

  if (peakGain <= 0) {
    return;
  }

  const AudioContextConstructor = window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextConstructor) {
    return;
  }

  try {
    const context =
      metronomeAudioContext && metronomeAudioContext.state !== "closed"
        ? metronomeAudioContext
        : new AudioContextConstructor();

    metronomeAudioContext = context;
    if (context.state === "suspended") {
      void context.resume().catch(() => undefined);
    }

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    // A square downbeat (rich odd harmonics) cuts through piano/guitar; the
    // weaker beats use a triangle so the "1" still stands out by timbre, not
    // only volume. Sine was too soft to hear while playing.
    oscillator.type = accent === "normal" ? "triangle" : "square";
    oscillator.frequency.value = accent === "strong" ? 1_320 : 880;
    // Instant attack + fast decay = a percussive click instead of a soft beep.
    gain.gain.setValueAtTime(peakGain, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.045);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.05);
  } catch {
    // Audio is optional; the controls remain usable without it.
  }
}

function storageKey(workId: string) {
  return practiceSessionStorageKey(workId);
}

function clampTempo(value: number) {
  return clampPracticeTempo(value);
}
