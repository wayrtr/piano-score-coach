"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { noteNameToFrequency, playNote, type NoteTimbre } from "@/lib/music/note-synth";
import {
  playSample,
  preloadSamples,
  type SampledInstrument,
} from "@/lib/music/note-samples";
import type { PlaybackStep } from "@/lib/music/playback-timeline";

export type PlaybackStatus = "idle" | "playing" | "paused";

/** Map the reference-instrument toggle to the sampled instrument we ship. */
const SAMPLE_INSTRUMENT: Record<NoteTimbre, SampledInstrument> = {
  piano: "piano",
  guitar: "guitar-steel",
};

/** Distinct note names across every voice of every step. */
function collectNoteNames(steps: PlaybackStep[]): string[] {
  const names = new Set<string>();

  for (const step of steps) {
    for (const voice of step.voices) {
      for (const note of voice.notes) {
        names.add(note);
      }
    }
  }

  return [...names];
}

type UsePlaybackInput = {
  /** Built fresh at play time so it reflects the current page + tempo. */
  getSteps: () => PlaybackStep[];
  /** Where to begin within the freshly built steps (e.g. current selection). */
  resolveStartIndex?: (steps: PlaybackStep[]) => number;
  timbre: NoteTimbre;
  /** Highlight this step (null when playback finishes/stops). */
  onActiveStep: (step: PlaybackStep | null) => void;
};

const LOOKAHEAD_SEC = 0.05;

export function usePlayback({
  getSteps,
  resolveStartIndex,
  timbre,
  onActiveStep,
}: UsePlaybackInput) {
  const [status, setStatus] = useState<PlaybackStatus>("idle");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [isLoadingSamples, setIsLoadingSamples] = useState(false);

  const contextRef = useRef<AudioContext | null>(null);
  const stepsRef = useRef<PlaybackStep[]>([]);
  const indexRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  // Both oscillators (synth fallback) and buffer sources (samples) are
  // AudioScheduledSourceNodes, so Stop can cut either short the same way.
  const liveNodesRef = useRef<AudioScheduledSourceNode[]>([]);
  // Bumped on every play/pause/stop so an in-flight sample preload can tell it
  // was superseded and bail instead of starting stale playback.
  const loadTokenRef = useRef(0);
  // Holds the latest runStep so the scheduled timeout can recurse without the
  // callback referencing itself before it is declared.
  const runStepRef = useRef<() => void>(() => {});

  // Keep mutable callbacks/props fresh for the timer chain without re-arming it.
  const timbreRef = useRef(timbre);
  const onActiveStepRef = useRef(onActiveStep);
  const getStepsRef = useRef(getSteps);
  const resolveStartIndexRef = useRef(resolveStartIndex);

  useEffect(() => {
    timbreRef.current = timbre;
  }, [timbre]);
  useEffect(() => {
    onActiveStepRef.current = onActiveStep;
  }, [onActiveStep]);
  useEffect(() => {
    getStepsRef.current = getSteps;
  }, [getSteps]);
  useEffect(() => {
    resolveStartIndexRef.current = resolveStartIndex;
  }, [resolveStartIndex]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopLiveNodes = useCallback(() => {
    for (const node of liveNodesRef.current) {
      try {
        node.stop();
      } catch {
        // Already stopped/ended.
      }
    }

    liveNodesRef.current = [];
  }, []);

  const soundStep = useCallback((step: PlaybackStep) => {
    const context = contextRef.current;

    if (!context) {
      return;
    }

    const startTime = context.currentTime + LOOKAHEAD_SEC;
    const instrument = SAMPLE_INSTRUMENT[timbreRef.current];

    for (const voice of step.voices) {
      for (const note of voice.notes) {
        // Prefer the real recorded sample; it's exact-pitch and authentic.
        const sampleNode = playSample(context, {
          instrument,
          noteName: note,
          startTime,
          durationSec: voice.durationSec,
        });

        if (sampleNode) {
          liveNodesRef.current.push(sampleNode);
          continue;
        }

        // Sample missing/off-range/failed → fall back to the synth so playback
        // never goes silent.
        const frequency = noteNameToFrequency(note);

        if (frequency === null) {
          continue;
        }

        const oscillators = playNote(context, {
          frequency,
          startTime,
          durationSec: voice.durationSec,
          timbre: timbreRef.current,
        });

        liveNodesRef.current.push(...oscillators);
      }
    }
  }, []);

  const runStep = useCallback(() => {
    const steps = stepsRef.current;
    const index = indexRef.current;

    if (index >= steps.length) {
      clearTimer();
      setStatus("idle");
      setActiveIndex(null);
      onActiveStepRef.current(null);
      return;
    }

    const step = steps[index];

    setActiveIndex(index);
    onActiveStepRef.current(step);
    soundStep(step);

    timerRef.current = window.setTimeout(() => {
      indexRef.current = index + 1;
      runStepRef.current();
    }, Math.max(30, step.stepDurationSec * 1000));
  }, [clearTimer, soundStep]);

  useEffect(() => {
    runStepRef.current = runStep;
  }, [runStep]);

  const ensureContext = useCallback(() => {
    if (contextRef.current && contextRef.current.state !== "closed") {
      return contextRef.current;
    }

    const AudioContextConstructor =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioContextConstructor) {
      return null;
    }

    try {
      contextRef.current = new AudioContextConstructor();
    } catch {
      contextRef.current = null;
    }

    return contextRef.current;
  }, []);

  const play = useCallback(async () => {
    const context = ensureContext();

    if (context?.state === "suspended") {
      void context.resume().catch(() => undefined);
    }

    const token = loadTokenRef.current + 1;
    loadTokenRef.current = token;

    // Resume from a pause; otherwise (re)build the step list and pick a start.
    if (status !== "paused") {
      const steps = getStepsRef.current();

      if (steps.length === 0) {
        return;
      }

      stepsRef.current = steps;
      const requested = resolveStartIndexRef.current?.(steps) ?? 0;
      indexRef.current = Math.min(Math.max(0, requested), steps.length - 1);

      // Decode this page's notes up front so playback opens on a real sample
      // rather than the synth fallback. Cached notes resolve instantly.
      if (context) {
        setIsLoadingSamples(true);
        try {
          await preloadSamples(
            context,
            SAMPLE_INSTRUMENT[timbreRef.current],
            collectNoteNames(steps),
          );
        } catch {
          // Preload is best-effort; soundStep falls back to the synth.
        }

        // A stop/pause/replay during the await wins — don't start stale audio.
        if (loadTokenRef.current !== token) {
          return;
        }

        setIsLoadingSamples(false);
      }
    }

    if (stepsRef.current.length === 0) {
      return;
    }

    clearTimer();
    setStatus("playing");
    runStep();
  }, [clearTimer, ensureContext, runStep, status]);

  const pause = useCallback(() => {
    // Cancel any in-flight preload so it doesn't auto-start after we pause.
    loadTokenRef.current += 1;
    setIsLoadingSamples(false);

    if (status !== "playing") {
      return;
    }

    clearTimer();
    stopLiveNodes();
    setStatus("paused");
  }, [clearTimer, status, stopLiveNodes]);

  const stop = useCallback(() => {
    loadTokenRef.current += 1;
    setIsLoadingSamples(false);
    clearTimer();
    stopLiveNodes();
    indexRef.current = 0;
    setActiveIndex(null);
    setStatus("idle");
  }, [clearTimer, stopLiveNodes]);

  const toggle = useCallback(() => {
    if (status === "playing") {
      pause();
    } else {
      void play();
    }
  }, [pause, play, status]);

  useEffect(() => {
    return () => {
      loadTokenRef.current += 1;
      clearTimer();
      stopLiveNodes();

      if (contextRef.current && contextRef.current.state !== "closed") {
        void contextRef.current.close().catch(() => undefined);
      }
    };
  }, [clearTimer, stopLiveNodes]);

  return { status, activeIndex, isLoadingSamples, play, pause, stop, toggle };
}
