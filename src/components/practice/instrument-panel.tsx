"use client";

import type { InstrumentMode } from "@/lib/domain/types";
import type { GuitarTuning } from "@/lib/music/guitar";

import { GuitarFretboard } from "@/components/practice/guitar-fretboard";
import { Keyboard } from "@/components/practice/keyboard";

type InstrumentPanelProps = {
  instrumentMode: InstrumentMode;
  highlightedNotes: readonly string[];
  previewNotes?: readonly string[];
  noteColors?: ReadonlyMap<number, number>;
  guitarTuning?: GuitarTuning;
};

export function InstrumentPanel({
  instrumentMode,
  highlightedNotes,
  previewNotes = [],
  noteColors,
  guitarTuning,
}: InstrumentPanelProps) {
  if (instrumentMode === "piano") {
    return (
      <PianoReference
        highlightedNotes={highlightedNotes}
        previewNotes={previewNotes}
        noteColors={noteColors}
      />
    );
  }

  return (
    <div id="instrument-reference" className="instrument-reference-stack">
      <GuitarFretboard
        notes={highlightedNotes}
        previewNotes={previewNotes}
        noteColors={noteColors}
        tuning={guitarTuning}
      />
    </div>
  );
}

function PianoReference({
  highlightedNotes,
  previewNotes,
  noteColors,
}: {
  highlightedNotes: readonly string[];
  previewNotes: readonly string[];
  noteColors?: ReadonlyMap<number, number>;
}) {
  return (
    <div id="instrument-reference" className="instrument-reference-stack">
      <Keyboard
        highlightedNotes={highlightedNotes}
        previewNotes={previewNotes}
        noteColors={noteColors}
        compact
      />
    </div>
  );
}
