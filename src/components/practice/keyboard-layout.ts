import { buildPianoKeys, type PianoKey } from "@/lib/music/piano";

export const MIN_WHITE_KEY_WIDTH = 22;
export const KEYBOARD_REGION_PADDING = 20;
export const KEYBOARD_REGION_GAP = 28;

const pianoKeys = buildPianoKeys();
const whiteKeys = pianoKeys.filter((key) => !key.isBlack);
type Range = { start: number; end: number };

export type KeyboardLayoutRow = {
  regions: PianoKey[][];
  whiteKeyWidth: number;
};

function rangeKeys(range: Range) {
  return pianoKeys.filter(
    (key) => key.midi >= whiteKeys[range.start].midi && key.midi <= whiteKeys[range.end].midi,
  );
}

function minimumRowWidth(ranges: Range[]) {
  return ranges.reduce(
    (width, range) => width + (range.end - range.start + 1) * MIN_WHITE_KEY_WIDTH + KEYBOARD_REGION_PADDING,
    Math.max(0, ranges.length - 1) * KEYBOARD_REGION_GAP,
  );
}

/** Keep complete local key patterns, dropping only unselected gaps when needed. */
export function getCompactKeyboardLayout(
  midiValues: ReadonlySet<number>,
  viewportWidth: number,
): KeyboardLayoutRow[] {
  const width = viewportWidth > 0 ? viewportWidth : 600;
  const notes = [...midiValues]
    .filter((midi) => midi >= 21 && midi <= 108)
    .sort((a, b) => a - b);
  const startMidi = notes.length > 0 ? notes[0] - 7 : 48;
  const endMidi = notes.length > 0 ? notes.at(-1)! + 7 : 72;
  const contextualRange = {
    start: Math.max(0, whiteKeys.findIndex((key) => key.midi >= startMidi)),
    end: whiteKeys.findLastIndex((key) => key.midi <= endMidi),
  };
  const makeRow = (ranges: Range[], lowerBound = 0, upperBound = whiteKeys.length - 1): KeyboardLayoutRow => {
    const expanded = ranges.map((range) => ({ ...range }));
    const limits = ranges.map((range, index) => {
      const previous = ranges[index - 1];
      const next = ranges[index + 1];
      return {
        start: Math.min(range.start, previous ? Math.floor((previous.end + range.start + 1) / 2) : lowerBound),
        end: Math.max(range.end, next ? Math.floor((range.end + next.start - 1) / 2) : upperBound),
      };
    });
    let whiteCount = ranges.reduce((sum, range) => sum + range.end - range.start + 1, 0);
    const availableWidth = width - ranges.length * KEYBOARD_REGION_PADDING - (ranges.length - 1) * KEYBOARD_REGION_GAP;
    const targetCount = Math.round(availableWidth / 34);
    // Fill unused space with real neighbouring keys before widening the keys.
    // Shared gap boundaries keep separate rows and regions from overlapping.
    while (whiteCount < targetCount) {
      let grew = false;
      for (let index = 0; index < expanded.length && whiteCount < targetCount; index += 1) {
        const range = expanded[index];
        if (range.start > limits[index].start) {
          range.start -= 1;
          whiteCount += 1;
          grew = true;
        }
        if (whiteCount < targetCount && range.end < limits[index].end) {
          range.end += 1;
          whiteCount += 1;
          grew = true;
        }
      }
      if (!grew) break;
    }
    const continuous: Range[] = [];
    for (const range of expanded) {
      const previous = continuous.at(-1);
      if (previous && range.start <= previous.end + 1) previous.end = range.end;
      else continuous.push(range);
    }
    whiteCount = continuous.reduce((sum, range) => sum + range.end - range.start + 1, 0);
    return {
      regions: continuous.map(rangeKeys),
      whiteKeyWidth: Math.max(MIN_WHITE_KEY_WIDTH,
        (width - continuous.length * KEYBOARD_REGION_PADDING - (continuous.length - 1) * KEYBOARD_REGION_GAP) / whiteCount,
      ),
    };
  };
  const makeRows = (rows: Range[][]) => {
    const boundaries = rows.slice(0, -1).map((row, index) => Math.max(
      row.at(-1)!.end,
      Math.min(rows[index + 1][0].start - 1, Math.round(whiteKeys.length * (index + 1) / rows.length) - 1),
    ));
    return rows.map((row, index) => {
      const continuous = { start: row[0].start, end: row.at(-1)!.end };
      return makeRow(
        minimumRowWidth([continuous]) <= width ? [continuous] : row,
        index > 0 ? boundaries[index - 1] + 1 : 0,
        boundaries[index],
      );
    });
  };

  if (minimumRowWidth([contextualRange]) <= width) {
    return [makeRow([contextualRange])];
  }

  const selectedRanges = (padding: number) => {
    const ranges: Range[] = [];
    for (const midi of notes) {
      const before = whiteKeys.findLastIndex((key) => key.midi <= midi);
      const after = whiteKeys.findIndex((key) => key.midi >= midi);
      const range = {
        start: Math.max(0, before - padding),
        end: Math.min(whiteKeys.length - 1, after + padding),
      };
      const previous = ranges.at(-1);
      if (previous && range.start <= previous.end + 1) {
        previous.end = Math.max(previous.end, range.end);
      } else {
        ranges.push(range);
      }
    }
    return ranges;
  };
  let ranges = selectedRanges(1);
  if (minimumRowWidth(ranges) - KEYBOARD_REGION_GAP > 2 * width) {
    ranges = selectedRanges(0);
  }
  if (ranges.length === 0) {
    // A small idle keyboard does not need to occupy a second row.
    const maxCount = Math.max(2, Math.floor((width - KEYBOARD_REGION_PADDING) / MIN_WHITE_KEY_WIDTH));
    return [makeRow([{ start: contextualRange.start, end: Math.min(contextualRange.end, contextualRange.start + maxCount - 1) }])];
  }

  // Split dense ranges at B/C or E/F boundaries, so a black key is never lost
  // between rows. Extremely narrow containers may share one boundary white key.
  const maxCount = Math.min(
    Math.ceil(whiteKeys.length / 2),
    Math.max(2, Math.floor((width - KEYBOARD_REGION_PADDING) / MIN_WHITE_KEY_WIDTH)),
  );
  const regions: Range[] = [];
  for (const range of ranges) {
    let start = range.start;
    while (range.end - start + 1 > maxCount) {
      let end = start + maxCount - 1;
      while (end > start && whiteKeys[end + 1].midi - whiteKeys[end].midi > 1) end -= 1;
      if (end === start && whiteKeys[end + 1].midi - whiteKeys[end].midi > 1) {
        end = start + maxCount - 1;
        regions.push({ start, end });
        start = end;
      } else {
        regions.push({ start, end });
        start = end + 1;
      }
    }
    regions.push({ start, end: range.end });
  }

  let rows: Range[][] = [];
  let bestWidth = Number.POSITIVE_INFINITY;
  let bestOversize = Number.POSITIVE_INFINITY;
  // Prefer two balanced rows when the continuous selection is too wide.
  for (let split = 1; split < regions.length; split += 1) {
    const candidate = [regions.slice(0, split), regions.slice(split)];
    const widest = Math.max(...candidate.map(minimumRowWidth));
    if (widest > width) continue;
    const oversize = Math.max(0, ...makeRows(candidate).map((row) => row.whiteKeyWidth - 36));
    if (oversize < bestOversize || (oversize === bestOversize && widest < bestWidth)) {
      rows = candidate;
      bestWidth = widest;
      bestOversize = oversize;
    }
  }
  if (rows.length === 0) {
    for (const region of regions) {
      const row = rows.at(-1);
      if (row && minimumRowWidth([...row, region]) <= width) row.push(region);
      else rows.push([region]);
    }
  }

  return makeRows(rows);
}
