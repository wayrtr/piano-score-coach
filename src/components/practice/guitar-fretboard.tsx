"use client";

import { useEffect, useMemo, useRef } from "react";

import {
  getGuitarGuidanceForNotes,
  STANDARD_TUNING,
  type GuitarPosition,
  type GuitarGuidance,
  type GuitarStringNumber,
  type GuitarTuning,
} from "@/lib/music/guitar";
import { noteNameToMidi } from "@/lib/music/piano";
import { formatNoteWithSoundingEquivalent } from "@/lib/music/notes";
import { assignVisibleNoteColors } from "@/lib/music/note-colors";
import { getPreferredScrollBehavior } from "@/lib/ui/motion";

type GuitarFretboardProps = {
  notes: readonly string[];
  previewNotes?: readonly string[];
  noteColors?: ReadonlyMap<number, number>;
  tuning?: GuitarTuning;
};

const FRET_NUMBERS = Array.from({ length: 13 }, (_, index) => index);
const STRING_NUMBERS = [1, 2, 3, 4, 5, 6] as const satisfies readonly GuitarStringNumber[];

type GuitarMarkerRole = "current" | "preview";

type GuitarMarker = {
  position: GuitarPosition;
  role: GuitarMarkerRole;
  /** Kept for auto-scroll (data-marker-role), no longer drives color. */
  isRoot: boolean;
  /** Per-note palette index; solid for current, ring for preview. */
  colorIndex: number | undefined;
};

function getLookupPositions(notes: readonly string[], guidance: GuitarGuidance) {
  const positions = [...guidance.recommended.positions];
  const covered = new Set(positions.map((position) => position.midi));

  for (const note of notes) {
    const candidate = guidance.allPositions.get(note.trim())?.[0];
    if (candidate && !covered.has(candidate.midi)) {
      positions.push(candidate);
      covered.add(candidate.midi);
    }
  }

  return positions;
}

export function GuitarFretboard({
  notes,
  previewNotes = [],
  noteColors,
  tuning = STANDARD_TUNING,
}: GuitarFretboardProps) {
  const recommendedShellRef = useRef<HTMLDivElement | null>(null);
  const recommendedGridRef = useRef<HTMLDivElement | null>(null);
  const tuningSignature = STRING_NUMBERS.map((stringNumber) => tuning[stringNumber]).join("|");
  const currentSignature = useMemo(
    () => `${notes.join("|")}:${previewNotes.join("|")}:${tuningSignature}`,
    [notes, previewNotes, tuningSignature],
  );

  useEffect(() => {
    const scrollShell = recommendedShellRef.current;
    const fretboard = recommendedGridRef.current;

    if (!scrollShell || !fretboard) {
      return;
    }

    const markers = [
      ...fretboard.querySelectorAll<HTMLElement>(".guitar-fret-marker"),
    ];
    const markerCells = markers
      .map((marker) => marker.closest<HTMLElement>(".guitar-fret-cell"))
      .filter((cell): cell is HTMLElement => cell !== null);

    if (markerCells.length === 0) {
      return;
    }

    const fretboardRect = fretboard.getBoundingClientRect();
    let activeRange = markerCells.reduce(
      (range, cell) => {
        const rect = cell.getBoundingClientRect();

        return {
          start: Math.min(range.start, rect.left - fretboardRect.left),
          end: Math.max(range.end, rect.right - fretboardRect.left),
        };
      },
      {
        start: Number.POSITIVE_INFINITY,
        end: Number.NEGATIVE_INFINITY,
      },
    );

    // When a very wide recommendation cannot fit in the viewport, centering
    // the whole range could hide every marker. Keep the root (or first tone)
    // visible instead; the compact cards above still list the other positions.
    if (activeRange.end - activeRange.start > scrollShell.clientWidth) {
      const preferredMarker =
        markers.find(
          (marker) =>
            marker.dataset.noteRole === "current" &&
            marker.dataset.markerRole === "root",
        ) ??
        markers.find((marker) => marker.dataset.noteRole === "current") ??
        markers[0];
      const preferredCell = preferredMarker?.closest<HTMLElement>(
        ".guitar-fret-cell",
      );

      if (preferredCell) {
        const rect = preferredCell.getBoundingClientRect();
        activeRange = {
          start: rect.left - fretboardRect.left,
          end: rect.right - fretboardRect.left,
        };
      }
    }

    const nextScrollLeft = calculateCenteredScrollLeft({
      activeRangeStart: activeRange.start,
      activeRangeEnd: activeRange.end,
      contentWidth: fretboard.scrollWidth,
      viewportWidth: scrollShell.clientWidth,
    });

    if (typeof scrollShell.scrollTo === "function") {
      scrollShell.scrollTo({
        left: nextScrollLeft,
        behavior: getPreferredScrollBehavior(),
      });
      return;
    }

    scrollShell.scrollLeft = nextScrollLeft;
  }, [currentSignature]);

  if (notes.length === 0 && previewNotes.length === 0) {
    return (
      <section className="practice-card guitar-card" aria-label="吉他指板">
        <div className="section-title">
          <h2>吉他指板</h2>
          <span>还没有选中音符</span>
        </div>
        <p className="practice-muted">
          点一个音或和弦，下面会显示吉他指板参考。
        </p>
      </section>
    );
  }

  const guidance = getGuitarGuidanceForNotes(notes, tuning);
  const previewGuidance =
    previewNotes.length > 0
      ? getGuitarGuidanceForNotes(previewNotes, tuning)
      : null;
  const currentMarkerPositions = getLookupPositions(notes, guidance);
  const previewMarkerPositions = previewGuidance
    ? getLookupPositions(previewNotes, previewGuidance)
    : [];
  // One visible MIDI map keeps score, cards, keys, and fret markers on the same
  // swatches. Solid vs. ring carries current/preview without changing hue.
  const visibleColors =
    noteColors ?? assignVisibleNoteColors(notes, previewNotes);
  const markers = [
    ...createMarkers(
      currentMarkerPositions,
      "current",
      guidance.recommended.rootNote,
      visibleColors,
    ),
    ...createMarkers(
      previewMarkerPositions,
      "preview",
      previewGuidance?.recommended.rootNote ?? null,
      visibleColors,
    ),
  ];
  const markerLookup = groupMarkersByCell(markers);
  const recommendedPositions = currentMarkerPositions;
  const previewRecommendedPositions = previewMarkerPositions;
  const missingNotes = notes.filter((note) =>
    !recommendedPositions.some((position) => position.midi === noteNameToMidi(note)),
  );
  const hasStringConflict = new Set(recommendedPositions.map((position) => position.stringNumber)).size < recommendedPositions.length;
  const helperText =
    recommendedPositions.length === 0
      ? null
      : [
          missingNotes.length > 0 ? `前 12 品无对应位置：${missingNotes.join("、")}` : null,
          hasStringConflict ? "逐音位置，不能同时按下" : null,
          missingNotes.length === 0 && !hasStringConflict ? guidance.recommended.message : null,
        ].filter(Boolean).join("；") || null;
  const unavailableMessage =
    guidance.recommended.message ?? "当前音组在这套调弦的前 12 品里没有可用参考。";
  const stringRows = STRING_NUMBERS.map((stringNumber) => ({
    stringNumber,
    openLabel: tuning[stringNumber] ?? STANDARD_TUNING[stringNumber],
  }));

  return (
    <section className="practice-card guitar-card" aria-label="吉他指板">
      <div className="section-title">
        <h2>吉他指板</h2>
        <div className="instrument-note-summary">
          <span className="instrument-note-list">
            {notes.map((note, index) => (
              <span
                key={`current-${note}-${index}`}
                className="instrument-note-chip"
                data-note-color={colorIndexForNote(note, visibleColors)}
              >
                {formatNoteWithSoundingEquivalent(note, {
                  style: "ascii",
                  equivalentLabel: "对应音高",
                })}
              </span>
            ))}
          </span>
          {previewNotes.length > 0 ? (
            <span className="instrument-preview-label">
              <span className="instrument-preview-caption">下一音</span>
              {previewNotes.map((note, index) => (
                <span
                  key={`preview-${note}-${index}`}
                  className="instrument-note-chip"
                  data-note-color={colorIndexForNote(note, visibleColors)}
                >
                  {formatNoteWithSoundingEquivalent(note, {
                    style: "ascii",
                    equivalentLabel: "对应音高",
                  })}
                </span>
              ))}
            </span>
          ) : null}
        </div>
      </div>

      {helperText ? (
        <p className="practice-muted guitar-summary-note" role="status">{helperText}</p>
      ) : null}

      {recommendedPositions.length === 0 &&
      previewRecommendedPositions.length === 0 ? (
        <p className="practice-muted">{unavailableMessage}</p>
      ) : (
        <>
          <div className="guitar-guidance-row">
            <CompactGuidance
              positions={recommendedPositions}
              role="current"
              label="当前音"
              colors={visibleColors}
            />

            {previewGuidance ? (
              <CompactGuidance
                positions={previewRecommendedPositions}
                role="preview"
                label="下一音"
                colors={visibleColors}
              />
            ) : null}
          </div>

          <div className="guitar-recommended-board">
            <div ref={recommendedShellRef} className="guitar-fretboard-shell">
              <div
                ref={recommendedGridRef}
                className="guitar-fretboard-grid"
                role="img"
                aria-label="吉他音符位置图"
              >
                <div className="guitar-fretboard-corner" />
                {FRET_NUMBERS.map((fretNumber) => (
                  <div
                    key={`recommended-fret-${fretNumber}`}
                    className="guitar-fret-number"
                    data-fret={fretNumber}
                  >
                    {fretNumber}
                  </div>
                ))}

                {stringRows.map((stringRow) => (
                  <Row
                    key={`recommended-${stringRow.stringNumber}`}
                    openLabel={stringRow.openLabel}
                    stringNumber={stringRow.stringNumber}
                    markerLookup={markerLookup}
                  />
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

type CompactGuidanceProps = {
  positions: readonly GuitarPosition[];
  role: GuitarMarkerRole;
  label: string;
  colors: ReadonlyMap<number, number>;
};

function CompactGuidance({
  positions,
  role,
  label,
  colors,
}: CompactGuidanceProps) {
  if (positions.length === 0) {
    return null;
  }

  return (
    <div className={`guitar-guidance-group is-${role}`}>
      <span className="guitar-guidance-label">{label}</span>
      <div className="guitar-compact-strip" aria-label={`${label}吉他位置`}>
        {positions.map((position) => (
          <div
            key={`${position.stringNumber}-${position.fret}-${position.noteName}`}
            className={`guitar-compact-pill${role === "preview" ? " is-preview" : ""}`}
            data-note-color={colors.get(position.midi)}
          >
            <strong>{position.noteName}</strong>
            <span>{`${position.stringNumber}弦·${position.fret}品`}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

type RowProps = {
  openLabel: string;
  stringNumber: GuitarPosition["stringNumber"];
  markerLookup: Map<string, GuitarMarker[]>;
};

function Row({
  openLabel,
  stringNumber,
  markerLookup,
}: RowProps) {
  return (
    <>
      <div className="guitar-string-label" data-string-number={stringNumber}>
        <span>{stringNumber} 弦</span>
        <small>{openLabel} 空弦</small>
      </div>

      {FRET_NUMBERS.map((fretNumber) => {
        const cellPositions = markerLookup.get(`${stringNumber}-${fretNumber}`) ?? [];

        return (
          <div
            key={`${stringNumber}-${fretNumber}`}
            className="guitar-fret-cell"
            data-string-number={stringNumber}
            data-fret={fretNumber}
          >
            {cellPositions.map((marker) => (
              <span
                key={`${marker.role}-${marker.position.stringNumber}-${marker.position.fret}-${marker.position.noteName}`}
                className={`guitar-fret-marker${
                  marker.role === "preview" ? " is-preview" : ""
                }`}
                aria-hidden="true"
                data-marker-role={marker.isRoot ? "root" : "tone"}
                data-note-role={marker.role}
                data-note-color={marker.colorIndex}
                title={marker.position.noteName}
              >
                {marker.position.noteName.replace(/\d+$/, "")}
              </span>
            ))}
          </div>
        );
      })}
    </>
  );
}

function createMarkers(
  positions: readonly GuitarPosition[],
  role: GuitarMarkerRole,
  rootNote: string | null,
  colors: ReadonlyMap<number, number>,
) {
  return positions.map((position) => ({
    position,
    role,
    isRoot: rootNote !== null && notesSharePitch(position.noteName, rootNote),
    colorIndex: colors.get(position.midi),
  })) satisfies GuitarMarker[];
}

/** Color index for a header chip; undefined leaves it on the neutral fallback. */
function colorIndexForNote(
  noteName: string,
  colors: ReadonlyMap<number, number>,
) {
  const midi = noteNameToMidi(noteName);

  return midi !== null ? colors.get(midi) : undefined;
}

function groupMarkersByCell(markers: readonly GuitarMarker[]) {
  const lookup = new Map<string, GuitarMarker[]>();

  for (const marker of markers) {
    const key = `${marker.position.stringNumber}-${marker.position.fret}`;
    const existing = lookup.get(key) ?? [];

    existing.push(marker);
    lookup.set(key, existing);
  }

  return lookup;
}

function notesSharePitch(left: string, right: string) {
  const leftMidi = noteNameToMidi(left);
  const rightMidi = noteNameToMidi(right);

  return leftMidi !== null && rightMidi !== null && leftMidi === rightMidi;
}

function calculateCenteredScrollLeft(input: {
  activeRangeStart: number;
  activeRangeEnd: number;
  contentWidth: number;
  viewportWidth: number;
}) {
  const maxScrollLeft = Math.max(0, input.contentWidth - input.viewportWidth);
  const activeCenter = (input.activeRangeStart + input.activeRangeEnd) / 2;

  return Math.min(
    Math.max(0, Math.round(activeCenter - input.viewportWidth / 2)),
    maxScrollLeft,
  );
}
