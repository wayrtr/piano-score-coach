"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  STANDARD_TUNING,
  type GuitarStringNumber,
  type GuitarTuning,
} from "@/lib/music/guitar";
import {
  createGuitarStringTracker,
  detectPitch,
  getCentsOffset,
  getTuningTargetFrequency,
} from "@/lib/music/tuner";

type TunerStatus = "idle" | "requesting" | "listening" | "error";

type GuitarTunerProps = {
  tuning?: GuitarTuning;
};

const STRING_NUMBERS = [1, 2, 3, 4, 5, 6] as const satisfies readonly GuitarStringNumber[];
const CENTS_IN_TUNE = 5;
const READ_INTERVAL_MS = 80;

type AudioResources = {
  context: AudioContext;
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  frame: number | null;
};

export function GuitarTuner({ tuning = STANDARD_TUNING }: GuitarTunerProps) {
  const [selectedString, setSelectedString] = useState<GuitarStringNumber>(6);
  const [status, setStatus] = useState<TunerStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [detectedFrequency, setDetectedFrequency] = useState<number | null>(null);
  const [clarity, setClarity] = useState<number | null>(null);
  const resourcesRef = useRef<AudioResources | null>(null);
  const operationRef = useRef(0);
  const mountedRef = useRef(true);
  const tuningRef = useRef(tuning);
  const stringTrackerRef = useRef<
    ReturnType<typeof createGuitarStringTracker> | null
  >(null);

  if (stringTrackerRef.current === null) {
    stringTrackerRef.current = createGuitarStringTracker();
  }

  const targetNote = tuning[selectedString] ?? STANDARD_TUNING[selectedString];
  const targetFrequency = useMemo(
    () => getTuningTargetFrequency(targetNote),
    [targetNote],
  );
  const cents =
    detectedFrequency !== null && targetFrequency !== null
      ? getCentsOffset(detectedFrequency, targetFrequency)
      : null;
  const tuningState = getTuningState(cents);
  const meterPosition = cents === null ? 50 : Math.max(0, Math.min(100, 50 + cents));

  useEffect(() => {
    tuningRef.current = tuning;
  }, [tuning]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      operationRef.current += 1;
      stopAudioResources(resourcesRef);
    };
  }, []);

  function resetReading() {
    setDetectedFrequency(null);
    setClarity(null);
  }

  function stopListening() {
    operationRef.current += 1;
    stopAudioResources(resourcesRef);
    stringTrackerRef.current?.reset();
    resetReading();
    setStatus("idle");
    setErrorMessage(null);
  }

  async function startListening() {
    if (status === "listening" || status === "requesting") {
      stopListening();
      return;
    }

    const mediaDevices = navigator.mediaDevices;
    const AudioContextConstructor = getAudioContextConstructor();

    if (!mediaDevices?.getUserMedia || !AudioContextConstructor) {
      setStatus("error");
      setErrorMessage("当前浏览器无法使用麦克风，请改用最新版 Chrome 或 Safari。");
      return;
    }

    const operation = operationRef.current + 1;
    operationRef.current = operation;
    setStatus("requesting");
    setErrorMessage(null);
    stringTrackerRef.current?.reset();
    resetReading();
    let pendingStream: MediaStream | null = null;
    let pendingContext: AudioContext | null = null;

    // Create and resume the AudioContext synchronously, while we still hold the
    // click's activation gesture. If we created it AFTER `await getUserMedia`,
    // Safari would leave it suspended and `resume()` would never resolve —
    // stranding the UI on "正在请求权限…" even after the mic is granted.
    let context: AudioContext;
    try {
      context = new AudioContextConstructor();
    } catch (error) {
      setStatus("error");
      setErrorMessage(getMicrophoneErrorMessage(error));
      return;
    }
    pendingContext = context;
    resumeContextQuietly(context);

    try {
      const stream = await mediaDevices.getUserMedia({
        audio: {
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
        },
      });
      pendingStream = stream;

      if (!mountedRef.current || operationRef.current !== operation) {
        stopTracks(stream);
        closeAudioContext(context);
        return;
      }

      const analyser = context.createAnalyser();
      analyser.fftSize = 4_096;
      analyser.smoothingTimeConstant = 0;
      const source = context.createMediaStreamSource(stream);
      resourcesRef.current = {
        context,
        stream,
        source,
        analyser,
        frame: null,
      };
      pendingStream = null;
      pendingContext = null;
      source.connect(analyser);

      // Nudge the context in case it started suspended; don't await it (that
      // is the call that hangs on Safari post-gesture).
      resumeContextQuietly(context);

      setStatus("listening");
      const samples = new Float32Array(analyser.fftSize);
      let lastReadAt = -Infinity;

      const readMicrophone = (timestamp: number) => {
        const resources = resourcesRef.current;

        if (
          !resources ||
          resources.analyser !== analyser ||
          operationRef.current !== operation
        ) {
          return;
        }

        if (timestamp - lastReadAt >= READ_INTERVAL_MS) {
          analyser.getFloatTimeDomainData(samples);
          const reading = detectPitch(samples, context.sampleRate);
          const trackedString = stringTrackerRef.current?.update(
            reading,
            tuningRef.current,
          );

          if (trackedString !== null && trackedString !== undefined) {
            setSelectedString(trackedString);
          }

          setDetectedFrequency(reading?.frequency ?? null);
          setClarity(reading?.clarity ?? null);
          lastReadAt = timestamp;
        }

        resources.frame = requestAnimationFrame(readMicrophone);
      };

      resourcesRef.current.frame = requestAnimationFrame(readMicrophone);
    } catch (error) {
      stopAudioResources(resourcesRef);
      if (pendingStream) {
        stopTracks(pendingStream);
      }
      if (pendingContext) {
        closeAudioContext(pendingContext);
      }

      if (!mountedRef.current || operationRef.current !== operation) {
        return;
      }

      setStatus("error");
      setErrorMessage(getMicrophoneErrorMessage(error));
    }
  }

  return (
    <section className="guitar-tuner" aria-label="吉他调音器">
      <div className="guitar-tuner-heading">
        <div>
          <strong>麦克风调音器</strong>
        </div>
        <button
          type="button"
          className={status === "listening" ? "secondary-button is-active" : "secondary-button"}
          onClick={() => void startListening()}
        >
          {status === "listening"
            ? "停止听音"
            : status === "requesting"
              ? "正在请求权限…"
              : "开始听音"}
        </button>
      </div>

      <div
        className="guitar-tuner-strings"
        role="group"
        aria-label="自动识别琴弦，也可手动选择"
      >
        {STRING_NUMBERS.map((stringNumber) => {
          const noteName = tuning[stringNumber] ?? STANDARD_TUNING[stringNumber];

          return (
            <button
              key={stringNumber}
              type="button"
              className={
                selectedString === stringNumber
                  ? "guitar-tuner-string is-selected"
                  : "guitar-tuner-string"
              }
              aria-label={`${stringNumber} 弦 · ${noteName}`}
              aria-pressed={selectedString === stringNumber}
              onClick={() => {
                stringTrackerRef.current?.reset();
                setSelectedString(stringNumber);
                resetReading();
              }}
            >
              <strong>{stringNumber} 弦</strong>
              <span>{noteName}</span>
            </button>
          );
        })}
      </div>

      <div className="guitar-tuner-reading" aria-live="polite">
        <div className="guitar-tuner-target">
          <span>目标</span>
          <strong>{targetNote}</strong>
          {targetFrequency !== null ? <small>{targetFrequency.toFixed(1)} Hz</small> : null}
        </div>
        <div className={`guitar-tuner-state is-${tuningState.kind}`}>
          <strong>{tuningState.label}</strong>
          <span>
            {cents === null
              ? status === "listening"
                ? "请拨响任意一根空弦"
                : "点击“开始听音”后拨弦"
              : `${cents > 0 ? "+" : ""}${cents.toFixed(1)} 音分`}
          </span>
        </div>
        <div className="guitar-tuner-detected">
          <span>检测</span>
          <strong>
            {detectedFrequency === null ? "—" : `${detectedFrequency.toFixed(1)} Hz`}
          </strong>
          {clarity !== null ? <small>{Math.round(clarity * 100)}% 稳定度</small> : null}
        </div>
      </div>

      <div
        className="guitar-tuner-meter"
        role="img"
        aria-label={
          cents === null
            ? "尚未检测到琴弦声音"
            : `音准偏差 ${cents.toFixed(1)} 音分`
        }
      >
        <span className="guitar-tuner-meter-track">
          <span
            className="guitar-tuner-meter-marker"
            style={{ left: `${meterPosition}%` }}
          />
          <span className="guitar-tuner-meter-center" />
        </span>
        <div className="guitar-tuner-meter-labels">
          <span>偏低</span>
          <span>准</span>
          <span>偏高</span>
        </div>
      </div>

      {errorMessage ? <p className="inline-error">{errorMessage}</p> : null}
    </section>
  );
}

function getTuningState(cents: number | null) {
  if (cents === null) {
    return { kind: "waiting", label: "等待拨弦" } as const;
  }

  if (Math.abs(cents) <= CENTS_IN_TUNE) {
    return { kind: "in-tune", label: "音准" } as const;
  }

  return cents < 0
    ? ({ kind: "flat", label: "偏低" } as const)
    : ({ kind: "sharp", label: "偏高" } as const);
}

function stopAudioResources(resourcesRef: { current: AudioResources | null }) {
  const resources = resourcesRef.current;

  if (!resources) {
    return;
  }

  resourcesRef.current = null;

  if (resources.frame !== null) {
    try {
      cancelAnimationFrame(resources.frame);
    } catch {
      // Cleanup must continue even if a browser shim rejects the frame id.
    }
  }

  try {
    resources.source.disconnect();
  } catch {
    // The source may already be disconnected after a partial startup.
  }

  stopTracks(resources.stream);
  closeAudioContext(resources.context);
}

function stopTracks(stream: MediaStream) {
  let tracks: MediaStreamTrack[];

  try {
    tracks = stream.getTracks();
  } catch {
    return;
  }

  for (const track of tracks) {
    try {
      track.stop();
    } catch {
      // Continue releasing the remaining tracks and audio context.
    }
  }
}

function closeAudioContext(context: AudioContext) {
  try {
    void context.close().catch(() => undefined);
  } catch {
    // Some browser shims can throw synchronously while closing.
  }
}

function resumeContextQuietly(context: AudioContext) {
  try {
    const result = context.resume?.();
    if (result && typeof result.catch === "function") {
      result.catch(() => undefined);
    }
  } catch {
    // resume() may throw synchronously on older shims; the read loop will
    // still run and the context usually starts once audio flows.
  }
}

function getAudioContextConstructor() {
  if (typeof window === "undefined") {
    return null;
  }

  const windowWithWebkit = window as Window & {
    webkitAudioContext?: typeof AudioContext;
  };

  return window.AudioContext ?? windowWithWebkit.webkitAudioContext ?? null;
}

function getMicrophoneErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "麦克风权限被拒绝了，请在浏览器地址栏中允许麦克风后再试。";
  }

  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "没有找到可用的麦克风，请检查系统输入设备。";
  }

  return "麦克风启动失败，请检查浏览器权限和系统输入设备。";
}
