import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  getCompactKeyboardLayout,
  KEYBOARD_REGION_PADDING,
} from "@/components/practice/keyboard-layout";
import { calculateKeyboardScrollLeft } from "@/components/practice/keyboard-viewport";
import { buildPianoKeys, noteNameToMidi } from "@/lib/music/piano";
import { formatNoteWithSoundingEquivalent } from "@/lib/music/notes";
import { assignVisibleNoteColors } from "@/lib/music/note-colors";
import { getPreferredScrollBehavior } from "@/lib/ui/motion";

type KeyboardProps = {
  highlightedNotes?: readonly string[];
  /** Show the next score event without changing the current selection. */
  previewNotes?: readonly string[];
  /** Shared visible MIDI palette supplied by the practice workspace. */
  noteColors?: ReadonlyMap<number, number>;
  /** Show only the useful range around the selected notes in the practice dock. */
  compact?: boolean;
};

const pianoKeys = buildPianoKeys();

export function Keyboard({
  highlightedNotes = [],
  previewNotes = [],
  noteColors,
  compact = false,
}: KeyboardProps) {
  const [viewportWidth, setViewportWidth] = useState(600);
  const scrollShellRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const highlightedNotesKey = highlightedNotes.join("|");
  const previewNotesKey = previewNotes.join("|");
  const hasHighlightedNotes = highlightedNotes.length > 0 || previewNotes.length > 0;
  const activeMidiValues = new Set(
    highlightedNotes
      .map((note) => noteNameToMidi(note))
      .filter((value): value is number => value !== null),
  );
  const allPreviewMidiValues = new Set(
    previewNotes
      .map((note) => noteNameToMidi(note))
      .filter((value): value is number => value !== null),
  );
  const previewMidiValues = new Set(
    [...allPreviewMidiValues].filter((value) => !activeMidiValues.has(value)),
  );
  const visibleMidiValues = new Set([...activeMidiValues, ...previewMidiValues]);
  // One visible MIDI map keeps the current and next events consistent; fill vs.
  // ring carries the state distinction without changing a note's hue.
  const visibleColors =
    noteColors ?? assignVisibleNoteColors(highlightedNotes, previewNotes);
  const rows = compact
    ? getCompactKeyboardLayout(visibleMidiValues, viewportWidth)
    : [{ regions: [pianoKeys], whiteKeyWidth: 34 }];
  const hasOmittedRanges = rows.flatMap((row) => row.regions).some((region, index, regions) =>
    index > 0 && region[0].midi > regions[index - 1].at(-1)!.midi + 1,
  );

  useEffect(() => {
    const scrollShell = scrollShellRef.current;
    const stageElement = stageRef.current;

    if (!scrollShell || !stageElement) {
      return;
    }

    if (compact) {
      const measureWidth = () => {
        if (scrollShell.clientWidth > 0) setViewportWidth(scrollShell.clientWidth);
      };
      measureWidth();
      const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measureWidth) : null;
      observer?.observe(scrollShell);
      window.addEventListener("resize", measureWidth);
      return () => {
        observer?.disconnect();
        window.removeEventListener("resize", measureWidth);
      };
    }

    const centerActiveKeys = (behavior: ScrollBehavior) => {
      const activeKeys = [
        ...stageElement.querySelectorAll<HTMLElement>(
          ".piano-key.is-active, .piano-key.is-preview",
        ),
      ];
      const stageRect = stageElement.getBoundingClientRect();
      const activeRange =
        activeKeys.length > 0
          ? activeKeys.reduce(
              (range, key) => {
                const rect = key.getBoundingClientRect();
                const start = rect.left - stageRect.left;
                const end = rect.right - stageRect.left;

                return {
                  start: Math.min(range.start, start),
                  end: Math.max(range.end, end),
                };
              },
              {
                start: Number.POSITIVE_INFINITY,
                end: Number.NEGATIVE_INFINITY,
              },
            )
          : null;
      const nextScrollLeft = calculateKeyboardScrollLeft({
        activeRangeStart: activeRange?.start ?? null,
        activeRangeEnd: activeRange?.end ?? null,
        contentWidth: stageElement.scrollWidth,
        viewportWidth: scrollShell.clientWidth,
      });

      if (typeof scrollShell.scrollTo === "function") {
        scrollShell.scrollTo({ left: nextScrollLeft, behavior });
      } else {
        scrollShell.scrollLeft = nextScrollLeft;
      }
    };
    const handleResize = () => centerActiveKeys("auto");

    centerActiveKeys(hasHighlightedNotes ? getPreferredScrollBehavior() : "auto");
    window.addEventListener("resize", handleResize);

    const resizeObserver =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(handleResize)
        : null;
    resizeObserver?.observe(scrollShell);
    resizeObserver?.observe(stageElement);

    return () => {
      window.removeEventListener("resize", handleResize);
      resizeObserver?.disconnect();
    };
  }, [highlightedNotesKey, previewNotesKey, hasHighlightedNotes, compact]);

  return (
    <section className="practice-card keyboard-card" aria-label="钢琴键盘">
      {!compact || hasHighlightedNotes ? <div className="section-title">
        {!compact ? <h2>钢琴键盘</h2> : null}
        <div className="instrument-note-summary">
          {highlightedNotes.length > 0 ? (
            <span className="instrument-note-list">
              {highlightedNotes.map((note, index) => (
                <span
                  key={`current-${note}-${index}`}
                  className="instrument-note-chip"
                  data-note-color={colorIndexForNote(note, visibleColors)}
                >
                  {formatNoteWithSoundingEquivalent(note)}
                </span>
              ))}
            </span>
          ) : !compact ? <span>还没有选中音符</span> : null}
          {previewNotes.length > 0 ? (
            <span className="instrument-preview-label">
              <span className="instrument-preview-caption">下一音</span>
              {previewNotes.map((note, index) => (
                <span
                  key={`preview-${note}-${index}`}
                  className="instrument-note-chip"
                  data-note-color={colorIndexForNote(note, visibleColors)}
                >
                  {formatNoteWithSoundingEquivalent(note)}
                </span>
              ))}
            </span>
          ) : null}
        </div>
      </div> : null}

      <div ref={scrollShellRef} className="keyboard-scroll-shell">
        <div className="keyboard-layout" data-rows={rows.length}>
          {compact && hasOmittedRanges ? <p className="keyboard-layout-caption">中间音区省略</p> : null}
          {rows.map((row, rowIndex) => (
            <div className="keyboard-layout-row" key={rowIndex}>
              {row.regions.map((visiblePianoKeys, regionIndex) => {
                const whiteKeys = visiblePianoKeys.filter((key) => !key.isBlack);
                let boundary = 0;
                const blackKeys = visiblePianoKeys.flatMap((key) => {
                  if (!key.isBlack) {
                    boundary += 1;
                    return [];
                  }
                  return [{ ...key, boundaryAfterWhite: boundary }];
                });
                const regionWidth = whiteKeys.length * row.whiteKeyWidth + KEYBOARD_REGION_PADDING;
                const stageStyle = {
                  "--white-key-count": String(whiteKeys.length),
                  ...(compact ? { "--white-key-width": `${row.whiteKeyWidth}px`, width: `${regionWidth}px` } : {}),
                } as CSSProperties;
                return (
                  <Fragment key={visiblePianoKeys[0].midi}>
                    {regionIndex > 0 ? <span className="keyboard-region-gap" aria-label="中间音区已省略">⋯<small>省略</small></span> : null}
                    <div className="keyboard-region" style={compact ? { width: regionWidth } : undefined}>
                      {compact ? <div className="keyboard-region-label">{visiblePianoKeys[0].noteName} — {visiblePianoKeys.at(-1)!.noteName}</div> : null}
                      <div
                        ref={rowIndex === 0 && regionIndex === 0 ? stageRef : undefined}
                        className="keyboard-stage"
                        style={stageStyle}
                        aria-hidden="true"
                      >
                        <div className="keyboard-white-row">
                          {whiteKeys.map((key) => {
                            const isActive = activeMidiValues.has(key.midi);
                            const isPreview = !isActive && previewMidiValues.has(key.midi);
                            const isRepeatPreview = isActive && allPreviewMidiValues.has(key.midi);

                            return (
                              <span
                                key={key.midi}
                                className={`piano-key piano-key-white${isActive ? " is-active" : ""}${
                                  isPreview ? " is-preview" : ""
                                }${isRepeatPreview ? " is-repeat-preview" : ""}`}
                                data-active={isActive}
                                data-preview={isPreview}
                                data-next-repeat={isRepeatPreview}
                                data-note-role={isActive ? "current" : isPreview ? "preview" : "none"}
                                data-note-color={colorIndexForKey(
                                  key.midi,
                                  isActive,
                                  isPreview,
                                  visibleColors,
                                )}
                                data-midi={key.midi}
                              >
                                {shouldShowVisibleLabel(key.noteName, isActive, isPreview) ? (
                                  <span className="piano-key-label">{key.noteName}</span>
                                ) : null}
                              </span>
                            );
                          })}
                        </div>

                        <div className="keyboard-black-row">
                          {blackKeys.map((key) => {
                            const isActive = activeMidiValues.has(key.midi);
                            const isPreview = !isActive && previewMidiValues.has(key.midi);
                            const isRepeatPreview = isActive && allPreviewMidiValues.has(key.midi);

                            return (
                              <span
                                key={key.midi}
                                className={`piano-key piano-key-black${isActive ? " is-active" : ""}${
                                  isPreview ? " is-preview" : ""
                                }${isRepeatPreview ? " is-repeat-preview" : ""}`}
                                style={{
                                  left: `calc(var(--white-key-width) * ${key.boundaryAfterWhite})`,
                                }}
                                data-active={isActive}
                                data-preview={isPreview}
                                data-next-repeat={isRepeatPreview}
                                data-note-role={isActive ? "current" : isPreview ? "preview" : "none"}
                                data-note-color={colorIndexForKey(
                                  key.midi,
                                  isActive,
                                  isPreview,
                                  visibleColors,
                                )}
                                data-midi={key.midi}
                              >
                                {shouldShowVisibleLabel(key.noteName, isActive, isPreview) ? (
                                  <span className="piano-key-label">{key.noteName}</span>
                                ) : null}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </Fragment>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function shouldShowVisibleLabel(
  noteName: string,
  isActive: boolean,
  isPreview: boolean,
) {
  return (
    isActive ||
    isPreview ||
    noteName === "A0" ||
    noteName === "C8" ||
    noteName.startsWith("C")
  );
}

/** Color index for a header chip; undefined leaves the chip on the neutral fallback. */
function colorIndexForNote(
  noteName: string,
  colors: ReadonlyMap<number, number>,
) {
  const midi = noteNameToMidi(noteName);

  return midi !== null ? colors.get(midi) : undefined;
}

/**
 * Color index for a key in either visible event. A note that is both current
 * and repeated next keeps its current (solid) presentation and shared hue.
 */
function colorIndexForKey(
  midi: number,
  isActive: boolean,
  isPreview: boolean,
  visibleColors: ReadonlyMap<number, number>,
) {
  if (isActive || isPreview) {
    return visibleColors.get(midi);
  }

  return undefined;
}
