"use client";

import { LoaderCircle, Pause, Play, Square } from "lucide-react";

import type { InstrumentMode } from "@/lib/domain/types";
import type { PlaybackStatus } from "@/components/practice/use-playback";

type PlaybackControlsProps = {
  status: PlaybackStatus;
  instrumentMode: InstrumentMode;
  /** No selectable notes on this page (e.g. a broken import). */
  disabled?: boolean;
  /** Decoding this page's samples before playback starts. */
  isLoadingSamples?: boolean;
  onToggle: () => void;
  onStop: () => void;
  /** Render controls inline with the score page toolbar instead of as a card. */
  compact?: boolean;
};

const INSTRUMENT_LABEL: Record<InstrumentMode, string> = {
  piano: "钢琴",
  guitar: "吉他",
};

export function PlaybackControls({
  status,
  instrumentMode,
  disabled = false,
  isLoadingSamples = false,
  onToggle,
  onStop,
  compact = false,
}: PlaybackControlsProps) {
  const isPlaying = status === "playing";
  const isActive = status !== "idle";
  const ToggleIcon = isLoadingSamples ? LoaderCircle : isPlaying ? Pause : Play;
  const toggleLabel = isLoadingSamples
    ? "音色加载中…"
    : isPlaying
      ? "暂停"
      : status === "paused"
        ? "继续"
        : "播放";

  return (
    <section
      className={`playback-controls${compact ? " playback-controls-inline" : ""}`}
      aria-label="播放乐谱"
    >
      {!compact ? (
        <div className="playback-controls-heading">
          <span className="control-label">播放</span>
          <span className="practice-muted">{`${INSTRUMENT_LABEL[instrumentMode]}音色`}</span>
        </div>
      ) : null}

      <div className="playback-controls-buttons">
        <button
          type="button"
          className={`secondary-button session-toggle-button${isPlaying ? " is-active" : ""}`}
          aria-pressed={isPlaying}
          aria-label={toggleLabel}
          title={toggleLabel}
          disabled={disabled || isLoadingSamples}
          onClick={onToggle}
        >
          <span
            className={`button-icon${isLoadingSamples ? " icon-spin" : ""}`}
            aria-hidden="true"
          >
            <ToggleIcon size={16} strokeWidth={1.8} />
          </span>
          {toggleLabel}
        </button>
        <button
          type="button"
          className="ghost-button"
          disabled={disabled || (!isActive && !isLoadingSamples)}
          onClick={onStop}
          aria-label="停止"
          title="停止"
        >
          <span className="button-icon" aria-hidden="true">
            <Square size={15} strokeWidth={1.8} />
          </span>
          停止
        </button>
      </div>
    </section>
  );
}
