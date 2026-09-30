"use client";

import type { ReactNode } from "react";
import { Guitar, Piano } from "lucide-react";

import type { InstrumentMode } from "@/lib/domain/types";

import { GuitarModeToggle } from "@/components/practice/guitar-mode-toggle";
import { GuitarTuner } from "@/components/practice/guitar-tuner";
import {
  GUITAR_TUNING_NOTE_OPTIONS,
  GUITAR_TUNING_PRESETS,
  STANDARD_TUNING,
  areGuitarTuningsEqual,
  normalizeGuitarTuning,
  type GuitarStringNumber,
  type GuitarTuning,
} from "@/lib/music/guitar";

type InstrumentControlsProps = {
  instrumentMode: InstrumentMode;
  guitarTuning?: GuitarTuning;
  onInstrumentModeChange: (mode: InstrumentMode) => void;
  onGuitarTuningChange?: (tuning: GuitarTuning) => void;
  /** Render the selector as a compact toolbar inside the instrument display. */
  compact?: boolean;
};

const instrumentOptions = [
  {
    value: "piano",
    label: "钢琴",
    icon: <Piano size={16} strokeWidth={1.8} />,
  },
  {
    value: "guitar",
    label: "吉他",
    icon: <Guitar size={16} strokeWidth={1.8} />,
  },
] as const satisfies readonly {
  value: InstrumentMode;
  label: string;
  icon: ReactNode;
}[];

export function InstrumentControls({
  instrumentMode,
  guitarTuning = STANDARD_TUNING,
  onInstrumentModeChange,
  onGuitarTuningChange,
  compact = false,
}: InstrumentControlsProps) {
  return (
    <section
      className={`instrument-controls-panel${compact ? " instrument-controls-inline" : ""}`}
      aria-label="乐器设置"
    >
      <div className="instrument-primary-controls">
        <GuitarModeToggle
          label="参考乐器"
          value={instrumentMode}
          options={instrumentOptions}
          onChange={onInstrumentModeChange}
        />
      </div>

      {instrumentMode === "guitar" ? (
        <details className="guitar-setup-details">
          <summary>调弦与调音器</summary>
          <div className="guitar-setup-content">
            <GuitarTuningEditor
              tuning={guitarTuning}
              onChange={onGuitarTuningChange}
            />
            <GuitarTuner tuning={guitarTuning} />
          </div>
        </details>
      ) : null}
    </section>
  );
}

type GuitarTuningEditorProps = {
  tuning: GuitarTuning;
  onChange?: (tuning: GuitarTuning) => void;
};

const GUITAR_STRING_NUMBERS = [1, 2, 3, 4, 5, 6] as const satisfies readonly GuitarStringNumber[];

function formatTuningOptionLabel(noteName: string) {
  const match = noteName.match(/^([A-G])(#?)(-?\d+)$/);

  if (!match || match[2] !== "#") {
    return noteName;
  }

  const flatEquivalent: Record<string, string> = {
    "C#": "D♭",
    "D#": "E♭",
    "F#": "G♭",
    "G#": "A♭",
    "A#": "B♭",
  };
  const pitch = `${match[1]}#`;

  return `${noteName} / ${flatEquivalent[pitch] ?? pitch}${match[3]}`;
}

export function GuitarTuningEditor({ tuning, onChange }: GuitarTuningEditorProps) {
  const preset = GUITAR_TUNING_PRESETS.find((candidate) =>
    areGuitarTuningsEqual(candidate.tuning, tuning),
  );
  const presetValue = preset?.value ?? "custom";

  function updateString(stringNumber: GuitarStringNumber, noteName: string) {
    onChange?.(
      normalizeGuitarTuning({
        ...tuning,
        [stringNumber]: noteName,
      }),
    );
  }

  return (
    <div className="guitar-tuning-editor" aria-label="吉他调弦">
      <div className="guitar-tuning-heading">
        <span className="control-label">吉他调弦</span>
      </div>
      <label className="guitar-tuning-preset">
        <span>预设</span>
        <select
          aria-label="吉他调弦预设"
          value={presetValue}
          onChange={(event) => {
            const selected = GUITAR_TUNING_PRESETS.find(
              (candidate) => candidate.value === event.target.value,
            );

            if (selected) {
              onChange?.(selected.tuning);
            }
          }}
        >
          {GUITAR_TUNING_PRESETS.map((candidate) => (
            <option key={candidate.value} value={candidate.value}>
              {candidate.label}
            </option>
          ))}
          <option value="custom">自定义</option>
        </select>
      </label>
      <div className="guitar-tuning-strings">
        {GUITAR_STRING_NUMBERS.map((stringNumber) => (
          <label key={stringNumber}>
            <span>{`${stringNumber}弦`}</span>
            <select
              aria-label={`第 ${stringNumber} 弦调弦`}
              value={tuning[stringNumber]}
              onChange={(event) => updateString(stringNumber, event.target.value)}
            >
              {GUITAR_TUNING_NOTE_OPTIONS.map((noteName) => (
                <option key={noteName} value={noteName}>
                  {formatTuningOptionLabel(noteName)}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </div>
  );
}
