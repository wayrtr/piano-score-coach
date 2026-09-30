import { describe, expect, it } from "vitest";

import {
  buildPlaybackTimeline,
  extractMusicXmlTiming,
} from "@/lib/music/playback-timeline";
import type { PracticeSelectionEvent } from "@/lib/practice/navigation";

// Two 4/4 measures, divisions=4 (1 unit = a sixteenth... no: divisions = units
// per quarter, so 4 => 1 unit = a sixteenth is wrong; 1 quarter = 4 units).
// Measure 1: quarter C4 (dur 4) then two eighths E4,G4 (dur 2 each), then a
// quarter rest (dur 4) — total 12? No: fill to 16. We use a half note to fill.
// Layout kept simple and explicit below.
const SAMPLE_XML = `<?xml version="1.0"?>
<score-partwise>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions></attributes>
      <note data-piano-coach-object-id="mxo-m0001-s1-v1-o0001">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration><voice>1</voice><staff>1</staff>
      </note>
      <note data-piano-coach-object-id="mxo-m0001-s1-v1-o0002">
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>2</duration><voice>1</voice><staff>1</staff>
      </note>
      <note data-piano-coach-object-id="mxo-m0001-s1-v1-o0003">
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>2</duration><voice>1</voice><staff>1</staff>
      </note>
      <note data-piano-coach-object-id="mxo-m0001-s1-v1-o0004">
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>8</duration><voice>1</voice><staff>1</staff>
      </note>
      <backup><duration>16</duration></backup>
      <note data-piano-coach-object-id="mxo-m0001-s2-v2-o0001">
        <pitch><step>C</step><octave>3</octave></pitch>
        <duration>16</duration><voice>2</voice><staff>2</staff>
      </note>
    </measure>
    <measure number="2">
      <note data-piano-coach-object-id="mxo-m0002-s1-v1-o0001">
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>16</duration><voice>1</voice><staff>1</staff>
      </note>
    </measure>
  </part>
</score-partwise>`;

function makeEvent(
  objectId: string,
  notes: string[],
  overrides: Partial<PracticeSelectionEvent> = {},
): PracticeSelectionEvent {
  return {
    pageIndex: 0,
    measure: 1,
    onset: 0,
    primaryObjectId: objectId,
    objectIds: [objectId],
    notes,
    objects: [
      {
        id: objectId,
        type: notes.length > 1 ? "chord" : "note",
        bbox: { x: 0, y: 0, width: 1, height: 1 },
        staff: "treble",
        measure: 1,
        onset: 0,
        notes,
        confidence: 1,
        source: "model",
      },
    ],
    ...overrides,
  };
}

describe("extractMusicXmlTiming", () => {
  it("records each object's onset and duration in quarter notes", () => {
    const { byObjectId } = extractMusicXmlTiming(SAMPLE_XML);

    // divisions=4 => 1 quarter = 4 units.
    expect(byObjectId.get("mxo-m0001-s1-v1-o0001")).toEqual({
      onsetQuarters: 0,
      durationQuarters: 1, // quarter note
    });
    expect(byObjectId.get("mxo-m0001-s1-v1-o0002")).toEqual({
      onsetQuarters: 1,
      durationQuarters: 0.5, // eighth
    });
    expect(byObjectId.get("mxo-m0001-s1-v1-o0003")).toEqual({
      onsetQuarters: 1.5,
      durationQuarters: 0.5,
    });
    expect(byObjectId.get("mxo-m0001-s1-v1-o0004")).toEqual({
      onsetQuarters: 2,
      durationQuarters: 2, // half note
    });
  });

  it("places a backed-up cross-staff voice at the measure start", () => {
    const { byObjectId } = extractMusicXmlTiming(SAMPLE_XML);

    // The bass whole note starts at beat 0 of measure 1 despite following the
    // treble voice in document order (a <backup> resets the position).
    expect(byObjectId.get("mxo-m0001-s2-v2-o0001")).toEqual({
      onsetQuarters: 0,
      durationQuarters: 4,
    });
  });

  it("advances the measure origin by the measure length, not document order", () => {
    const { byObjectId } = extractMusicXmlTiming(SAMPLE_XML);

    // Measure 1 is a full 4/4 bar (16 units = 4 quarters), so measure 2's note
    // starts at quarter 4.
    expect(byObjectId.get("mxo-m0002-s1-v1-o0001")?.onsetQuarters).toBe(4);
  });

  it("returns an empty map when the source has no divisions/part", () => {
    expect(extractMusicXmlTiming("<score-partwise></score-partwise>").byObjectId.size).toBe(0);
  });
});

describe("buildPlaybackTimeline", () => {
  const timing = extractMusicXmlTiming(SAMPLE_XML);

  it("converts quarter positions to seconds at the given BPM", () => {
    // 120 BPM => 0.5s per quarter.
    const steps = buildPlaybackTimeline({
      events: [
        makeEvent("mxo-m0001-s1-v1-o0001", ["C4"]),
        makeEvent("mxo-m0001-s1-v1-o0002", ["E4"]),
        makeEvent("mxo-m0001-s1-v1-o0003", ["G4"]),
      ],
      timing,
      bpm: 120,
    });

    expect(steps[0].startSec).toBeCloseTo(0);
    expect(steps[0].stepDurationSec).toBeCloseTo(0.5); // quarter -> next at beat 1
    expect(steps[1].startSec).toBeCloseTo(0.5);
    expect(steps[1].stepDurationSec).toBeCloseTo(0.25); // eighth -> next at 1.5
    expect(steps[2].startSec).toBeCloseTo(0.75);
  });

  it("normalizes the first event to start at zero", () => {
    const steps = buildPlaybackTimeline({
      events: [
        makeEvent("mxo-m0002-s1-v1-o0001", ["D4"]),
      ],
      timing,
      bpm: 60,
    });

    // Even though this note sits at quarter 4 in the piece, playback from here
    // starts at t=0.
    expect(steps[0].startSec).toBeCloseTo(0);
    // Whole note held with no following event: rings its own 4 quarters = 4s.
    expect(steps[0].stepDurationSec).toBeCloseTo(4);
  });

  it("gives each object its own ring-out via voices", () => {
    const steps = buildPlaybackTimeline({
      events: [
        makeEvent("mxo-m0001-s1-v1-o0001", ["C4"]),
      ],
      timing,
      bpm: 60, // 1s per quarter
    });

    expect(steps[0].voices).toEqual([{ notes: ["C4"], durationSec: 1 }]);
  });

  it("falls back to an even quarter-note step when timing is unavailable", () => {
    const steps = buildPlaybackTimeline({
      events: [
        makeEvent("unknown-a", ["C4"]),
        makeEvent("unknown-b", ["D4"]),
      ],
      timing: { byObjectId: new Map() },
      bpm: 120, // 0.5s per quarter
    });

    expect(steps.map((step) => step.startSec)).toEqual([0, 0.5]);
    expect(steps.every((step) => step.stepDurationSec === 0.5)).toBe(true);
  });

  it("returns an empty timeline for no events", () => {
    expect(
      buildPlaybackTimeline({ events: [], timing, bpm: 100 }),
    ).toEqual([]);
  });
});
