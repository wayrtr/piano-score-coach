import { MUSICXML_OBJECT_ID_ATTRIBUTE } from "@/lib/musicxml/shared";
import type { PracticeSelectionEvent } from "@/lib/practice/navigation";

/**
 * Timing extracted from the annotated MusicXML, keyed by the (unscoped) object
 * id the parser stamps on every note. Positions are expressed in quarter notes
 * so the value is tempo-independent; the caller multiplies by seconds-per-beat.
 *
 * `null` divisions means the source carried no `<divisions>` (e.g. an
 * AI-recognized image score), so real rhythm is unavailable and callers fall
 * back to an even step.
 */
export type MusicXmlTiming = {
  byObjectId: Map<string, { onsetQuarters: number; durationQuarters: number }>;
};

/** One note group that sounds together and rings for its own notated length. */
export type PlaybackVoice = {
  notes: string[];
  durationSec: number;
};

/** One step of the playhead: the notes to light up and when to sound them. */
export type PlaybackStep = {
  pageIndex: number;
  primaryObjectId: string;
  objectIds: string[];
  notes: string[];
  /** Seconds from playback start when this step begins. */
  startSec: number;
  /** How long until the playhead advances to the next step. */
  stepDurationSec: number;
  /** Per-object ring-out, so a held bass note keeps sounding under moving voices. */
  voices: PlaybackVoice[];
};

/**
 * Walk the annotated MusicXML and record, for every stamped object id, when it
 * starts and how long it lasts — both in quarter notes. Mirrors the parser's
 * position bookkeeping (`backup`/`forward`/`chord`) so cross-staff voices and
 * chords land on the right beat.
 */
export function extractMusicXmlTiming(xmlText: string): MusicXmlTiming {
  const byObjectId = new Map<
    string,
    { onsetQuarters: number; durationQuarters: number }
  >();

  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const part = doc.getElementsByTagName("part")[0] ?? null;

  if (!part) {
    return { byObjectId };
  }

  let divisions = 1;
  let measureStartQuarters = 0;

  for (const measure of directChildren(part, "measure")) {
    let position = 0;
    let measureMaxPosition = 0;
    const onsetByVoice = new Map<string, number>();

    for (const child of directChildElements(measure)) {
      if (child.tagName === "attributes") {
        const parsedDivisions = parseInt(textOf(firstChild(child, "divisions")));

        if (parsedDivisions && parsedDivisions > 0) {
          divisions = parsedDivisions;
        }

        continue;
      }

      if (child.tagName === "backup") {
        position = Math.max(0, position - parseInt(textOf(firstChild(child, "duration"))));
        continue;
      }

      if (child.tagName === "forward") {
        position += parseInt(textOf(firstChild(child, "duration")));
        measureMaxPosition = Math.max(measureMaxPosition, position);
        continue;
      }

      if (child.tagName !== "note") {
        continue;
      }

      const isChord = Boolean(firstChild(child, "chord"));
      const duration = parseInt(textOf(firstChild(child, "duration")));
      const voiceKey = textOf(firstChild(child, "voice")) || "1";
      const onset = isChord ? onsetByVoice.get(voiceKey) ?? position : position;
      const objectId = child.getAttribute(MUSICXML_OBJECT_ID_ATTRIBUTE);

      if (objectId) {
        const onsetQuarters = measureStartQuarters + onset / divisions;
        const durationQuarters = duration / divisions;
        const existing = byObjectId.get(objectId);

        // A chord shares one id across notes; keep the earliest onset and the
        // longest ring so the whole group is covered.
        byObjectId.set(objectId, {
          onsetQuarters: existing
            ? Math.min(existing.onsetQuarters, onsetQuarters)
            : onsetQuarters,
          durationQuarters: existing
            ? Math.max(existing.durationQuarters, durationQuarters)
            : durationQuarters,
        });
      }

      onsetByVoice.set(voiceKey, onset);

      if (!isChord) {
        position += duration;
        measureMaxPosition = Math.max(measureMaxPosition, position);
      }
    }

    measureStartQuarters += measureMaxPosition / divisions;
  }

  return { byObjectId };
}

/** DB object ids are scoped as `${pageId}::mxo-...`; the XML carries `mxo-...`. */
function unscopeObjectId(objectId: string) {
  const separatorIndex = objectId.lastIndexOf("::");

  return separatorIndex === -1 ? objectId : objectId.slice(separatorIndex + 2);
}

/**
 * Turn the ordered practice events into a real-rhythm timeline. When the source
 * has usable timing every step starts at its notated moment and each object
 * rings for its own length; otherwise we fall back to an even quarter-note step
 * so image scores still play (just without rhythm).
 */
export function buildPlaybackTimeline(input: {
  events: readonly PracticeSelectionEvent[];
  timing: MusicXmlTiming;
  bpm: number;
}): PlaybackStep[] {
  const { events, timing, bpm } = input;
  const secondsPerQuarter = 60 / clampBpm(bpm);

  if (events.length === 0) {
    return [];
  }

  const timedEvents = events.map((event) => ({
    event,
    onsetQuarters: eventOnsetQuarters(event, timing),
  }));

  const hasRealTiming = timedEvents.every((entry) => entry.onsetQuarters !== null);

  if (!hasRealTiming) {
    return buildEvenTimeline(events, secondsPerQuarter);
  }

  const steps: PlaybackStep[] = [];
  const baseQuarters = timedEvents[0].onsetQuarters ?? 0;

  for (let index = 0; index < timedEvents.length; index += 1) {
    const { event, onsetQuarters } = timedEvents[index];
    const startQuarters = (onsetQuarters ?? 0) - baseQuarters;
    const nextOnset = timedEvents[index + 1]?.onsetQuarters ?? null;
    // The step lasts until the next event, so the playhead advances in real
    // time even when a note is held longer than the gap (or released sooner).
    const stepQuarters =
      nextOnset !== null
        ? Math.max(nextOnset - (onsetQuarters ?? 0), MIN_STEP_QUARTERS)
        : maxVoiceDurationQuarters(event, timing);

    steps.push({
      pageIndex: event.pageIndex,
      primaryObjectId: event.primaryObjectId,
      objectIds: [...event.objectIds],
      notes: [...event.notes],
      startSec: startQuarters * secondsPerQuarter,
      stepDurationSec: stepQuarters * secondsPerQuarter,
      voices: buildVoices(event, timing, secondsPerQuarter),
    });
  }

  return steps;
}

function eventOnsetQuarters(
  event: PracticeSelectionEvent,
  timing: MusicXmlTiming,
): number | null {
  let earliest: number | null = null;

  for (const objectId of event.objectIds) {
    const entry = timing.byObjectId.get(unscopeObjectId(objectId));

    if (!entry) {
      continue;
    }

    earliest =
      earliest === null ? entry.onsetQuarters : Math.min(earliest, entry.onsetQuarters);
  }

  return earliest;
}

function maxVoiceDurationQuarters(
  event: PracticeSelectionEvent,
  timing: MusicXmlTiming,
) {
  let longest = MIN_STEP_QUARTERS;

  for (const objectId of event.objectIds) {
    const entry = timing.byObjectId.get(unscopeObjectId(objectId));

    if (entry) {
      longest = Math.max(longest, entry.durationQuarters);
    }
  }

  return longest;
}

/**
 * Group an event's notes by their source object so each object rings for its
 * own notated duration. Objects the timing map doesn't know about (or events
 * whose objects don't line up with `notes`) fall back to the whole note list
 * held for the longest known duration.
 */
function buildVoices(
  event: PracticeSelectionEvent,
  timing: MusicXmlTiming,
  secondsPerQuarter: number,
): PlaybackVoice[] {
  const voices: PlaybackVoice[] = [];

  for (const object of event.objects) {
    const entry = timing.byObjectId.get(unscopeObjectId(object.id));

    if (!entry || object.notes.length === 0) {
      continue;
    }

    voices.push({
      notes: [...object.notes],
      durationSec: Math.max(entry.durationQuarters, MIN_STEP_QUARTERS) * secondsPerQuarter,
    });
  }

  if (voices.length === 0) {
    voices.push({
      notes: [...event.notes],
      durationSec:
        maxVoiceDurationQuarters(event, timing) * secondsPerQuarter,
    });
  }

  return voices;
}

function buildEvenTimeline(
  events: readonly PracticeSelectionEvent[],
  secondsPerQuarter: number,
): PlaybackStep[] {
  return events.map((event, index) => ({
    pageIndex: event.pageIndex,
    primaryObjectId: event.primaryObjectId,
    objectIds: [...event.objectIds],
    notes: [...event.notes],
    startSec: index * secondsPerQuarter,
    stepDurationSec: secondsPerQuarter,
    voices: [{ notes: [...event.notes], durationSec: secondsPerQuarter }],
  }));
}

const MIN_STEP_QUARTERS = 1 / 16;

function clampBpm(bpm: number) {
  return Number.isFinite(bpm) && bpm > 0 ? Math.min(300, Math.max(20, bpm)) : 72;
}

function directChildElements(parent: Element) {
  const elements: Element[] = [];

  for (let index = 0; index < parent.childNodes.length; index += 1) {
    const node = parent.childNodes[index];

    if (node?.nodeType === 1) {
      elements.push(node as Element);
    }
  }

  return elements;
}

function directChildren(parent: Element, tagName: string) {
  return directChildElements(parent).filter((child) => child.tagName === tagName);
}

function firstChild(parent: Element | null, tagName: string) {
  if (!parent) {
    return null;
  }

  return directChildElements(parent).find((child) => child.tagName === tagName) ?? null;
}

function textOf(element: Element | null) {
  return element?.textContent?.trim() ?? "";
}

function parseInt(value: string) {
  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? parsed : 0;
}

