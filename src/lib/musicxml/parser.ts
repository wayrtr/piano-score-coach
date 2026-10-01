import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";

import {
  MUSICXML_OBJECT_ID_ATTRIBUTE,
  buildMusicXmlObjectId,
  musicXmlStaffNumberToLabel,
} from "@/lib/musicxml/shared";

export type ParsedMusicXmlObject = {
  id: string;
  annotatedObjectIds: string[];
  type: "note" | "chord";
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  staff: string;
  measure: number;
  onset: number;
  pageIndex: number;
  voiceNumber: number;
  notes: string[];
  confidence: number;
  source: "model";
};

export type ParsedMusicXmlPage = {
  pageIndex: number;
  measureStart: number;
  measureEnd: number;
  objects: ParsedMusicXmlObject[];
};

export type ParsedMusicXmlDocument = {
  annotatedXmlText: string;
  currentKey: string;
  objects: ParsedMusicXmlObject[];
  pages: ParsedMusicXmlPage[];
  pageCount: number;
  title: string | null;
};

const MAX_MUSICXML_BYTES = 32 * 1024 * 1024;
const MAX_CONTAINER_BYTES = 1024 * 1024;
const noteNameCollator = new Intl.Collator("en", { numeric: true });

type MeasureGroup = {
  staffNumber: number;
  staffLabel: string;
  voiceNumber: number;
  onset: number;
  encounterOrder: number;
  notes: Set<string>;
  noteElements: Element[];
};

export function extractMusicXmlSource(input: {
  buffer: Buffer;
  fileName: string;
}) {
  const lowerName = input.fileName.toLowerCase();

  if (!lowerName.endsWith(".mxl")) {
    assertXmlSize(input.buffer.byteLength, MAX_MUSICXML_BYTES);
    return {
      fileName: input.fileName,
      xmlText: input.buffer.toString("utf8"),
    };
  }

  const archiveBytes = toUint8Array(input.buffer);
  const fileNames: string[] = [];
  // Inspect the directory without inflating images, audio, or other attachments.
  // Limits are checked before fflate allocates an entry's decompressed buffer.
  const metadata = unzipSync(archiveBytes, {
    filter(entry) {
      fileNames.push(entry.name);
      if (entry.name !== "META-INF/container.xml") {
        return false;
      }
      assertXmlSize(entry.compression === 0 ? Math.max(entry.originalSize, entry.size) : entry.originalSize, MAX_CONTAINER_BYTES);
      return true;
    },
  });
  const containerXml = metadata["META-INF/container.xml"];
  if (containerXml) {
    assertXmlSize(containerXml.byteLength, MAX_CONTAINER_BYTES);
  }
  const fallbackRootFile = findFallbackMusicXmlEntry(fileNames);
  const rootFile = containerXml
    ? extractRootFilePath(strFromU8(containerXml)) ?? fallbackRootFile
    : fallbackRootFile;

  if (!rootFile) {
    throw new Error("Invalid MXL archive: missing root MusicXML file.");
  }

  const score = unzipSync(archiveBytes, {
    filter(entry) {
      if (entry.name !== rootFile) {
        return false;
      }
      assertXmlSize(entry.compression === 0 ? Math.max(entry.originalSize, entry.size) : entry.originalSize, MAX_MUSICXML_BYTES);
      return true;
    },
  });
  const rootContent = score[rootFile];

  if (!rootContent) {
    throw new Error(`Invalid MXL archive: missing ${rootFile}.`);
  }

  assertXmlSize(rootContent.byteLength, MAX_MUSICXML_BYTES);
  return {
    fileName: rootFile,
    xmlText: strFromU8(rootContent),
  };
}

export function parseMusicXmlDocument(xmlText: string): ParsedMusicXmlDocument {
  assertXmlSize(Buffer.byteLength(xmlText, "utf8"), MAX_MUSICXML_BYTES);
  const document = parseXmlDocument(xmlText);
  if (document.documentElement?.tagName !== "score-partwise") {
    throw new Error("Unsupported MusicXML: expected <score-partwise> content.");
  }
  const parts = Array.from(document.getElementsByTagName("part"));

  if (parts.length === 0) {
    throw new Error("Unsupported MusicXML: missing <part> content.");
  }

  const title =
    getTextContent(firstElement(document.getElementsByTagName("work-title"))) ??
    getTextContent(firstElement(document.getElementsByTagName("movement-title")));

  let staffOffset = 0;
  const partStates = parts.map((part) => {
    const state = {
      measures: directChildElementsByTagName(part, "measure"),
      staffOffset,
      divisions: 1,
      staffLabels: new Map<number, string>(),
    };
    let staffCount = 1;
    for (const tag of ["staves", "staff"]) {
      const elements = part.getElementsByTagName(tag);
      for (let index = 0; index < elements.length; index += 1) {
        staffCount = Math.max(staffCount, parseInteger(getTextContent(elements[index])) ?? 1);
      }
    }
    staffOffset += staffCount;

    return state;
  });
  // Shared integer ticks keep simultaneous notes aligned across part divisions.
  const commonDivisions = Array.from(document.getElementsByTagName("divisions"))
    .map((element) => parseTimingValue(getTextContent(element), 1))
    .reduce(leastCommonMultiple, 1);
  const measureCount = partStates.reduce((maximum, part) => Math.max(maximum, part.measures.length), 0);
  const objects: ParsedMusicXmlObject[] = [];
  const pages: ParsedMusicXmlPage[] = [];
  let currentKey = "C major";
  let hasSeenKey = false;
  let currentPageIndex = 0;
  let currentPageMeasureStart = 0;
  let currentPageObjects: ParsedMusicXmlObject[] = [];
  let previousMeasureNumber: number | null = null;

  const finalizeCurrentPage = (measureEnd: number) => {
    pages.push({
      pageIndex: currentPageIndex,
      measureStart: currentPageMeasureStart,
      measureEnd,
      objects: currentPageObjects,
    });
  };

  for (let measureIndex = 0; measureIndex < measureCount; measureIndex += 1) {
    const measureElements = partStates.flatMap((part) =>
      part.measures[measureIndex] ? [part.measures[measureIndex]] : [],
    );
    const measureElement = measureElements[0];
    const measureSequence = measureIndex + 1;
    const measureNumber =
      parseInteger(measureElement.getAttribute("number")) ?? measureSequence;
    const startsNewPage = measureIndex > 0 && measureElements.some(measureStartsNewPage);

    if (measureIndex === 0) {
      currentPageMeasureStart = measureSequence;
    } else if (startsNewPage && previousMeasureNumber !== null) {
      finalizeCurrentPage(previousMeasureNumber);
      currentPageIndex += 1;
      currentPageMeasureStart = measureSequence;
      currentPageObjects = [];
    }

    const measureGroups = new Map<string, MeasureGroup>();
    let encounterOrder = 0;

    for (const part of partStates) {
      const partMeasure = part.measures[measureIndex];

      if (!partMeasure) {
        continue;
      }

      let currentPosition = 0;
      const lastOnsetByVoice = new Map<string, number>();

      for (const child of directChildElements(partMeasure)) {
        if (child.tagName === "attributes") {
          const divisionsText = getTextContent(firstDirectChild(child, "divisions"));
          if (divisionsText !== null) {
            part.divisions = parseTimingValue(divisionsText, 1);
          }

          for (const clef of directChildElementsByTagName(child, "clef")) {
            const staffNumber = parseInteger(clef.getAttribute("number")) ?? 1;
            const sign = getTextContent(firstDirectChild(clef, "sign"));

            part.staffLabels.set(
              staffNumber,
              sign === "F"
                ? "bass"
                : sign === "G"
                  ? "treble"
                  : musicXmlStaffNumberToLabel(staffNumber),
            );
          }
        }

        if (child.tagName === "attributes" && !hasSeenKey) {
          const keyElement = firstDirectChild(child, "key");
          const fifths = parseInteger(
            getTextContent(firstDirectChild(keyElement, "fifths")),
          );
          const mode =
            getTextContent(firstDirectChild(keyElement, "mode"))?.toLowerCase() ??
            "major";

          if (fifths !== null) {
            currentKey = circleOfFifthsToKeyName(fifths, mode);
            hasSeenKey = true;
          }
        }

        const duration =
          parseTimingValue(getTextContent(firstDirectChild(child, "duration")), 0) *
          (commonDivisions / part.divisions);
        if (!Number.isSafeInteger(duration) || !Number.isSafeInteger(currentPosition + duration)) {
          throw new Error("Unsupported MusicXML: timing resolution exceeds safe integer precision.");
        }

        if (child.tagName === "backup") {
          currentPosition = Math.max(0, currentPosition - duration);
          continue;
        }

        if (child.tagName === "forward") {
          currentPosition += duration;
          continue;
        }

        if (child.tagName !== "note") {
          continue;
        }

        const localStaffNumber = parseInteger(
          getTextContent(firstDirectChild(child, "staff")),
        ) ?? 1;
        const staffNumber = part.staffOffset + localStaffNumber;
        const voiceNumber = parseInteger(
          getTextContent(firstDirectChild(child, "voice")),
        ) ?? 1;
        const hasChordTag = Boolean(firstDirectChild(child, "chord"));
        const voiceKey = `${staffNumber}:${voiceNumber}`;
        const onset = hasChordTag
          ? (lastOnsetByVoice.get(voiceKey) ?? currentPosition)
          : currentPosition;
        const noteName = parsePitchName(child);

        if (!noteName) {
          if (!hasChordTag) {
            currentPosition += duration;
          }

          continue;
        }

        const groupKey = `${staffNumber}:${voiceNumber}:${onset}`;
        const group =
          measureGroups.get(groupKey) ??
          (() => {
            const nextGroup = {
              staffNumber,
              staffLabel:
                part.staffLabels.get(localStaffNumber) ??
                musicXmlStaffNumberToLabel(localStaffNumber),
              voiceNumber,
              onset,
              encounterOrder,
              notes: new Set<string>(),
              noteElements: [] as Element[],
            };

            measureGroups.set(groupKey, nextGroup);
            encounterOrder += 1;

            return nextGroup;
          })();

        group.notes.add(noteName);
        group.noteElements.push(child);
        lastOnsetByVoice.set(voiceKey, onset);

        if (!hasChordTag) {
          currentPosition += duration;
        }
      }
    }

    const groupsByStaffAndVoice = new Map<string, MeasureGroup[]>();
    const measureObjects: ParsedMusicXmlObject[] = [];

    for (const group of measureGroups.values()) {
      const groups =
        groupsByStaffAndVoice.get(`${group.staffNumber}:${group.voiceNumber}`) ?? [];
      groups.push(group);
      groupsByStaffAndVoice.set(`${group.staffNumber}:${group.voiceNumber}`, groups);
    }

    for (const groups of groupsByStaffAndVoice.values()) {
      const sortedGroups = groups.toSorted(
        (left, right) => left.onset - right.onset || left.encounterOrder - right.encounterOrder,
      );

      for (let index = 0; index < sortedGroups.length; index += 1) {
        const group = sortedGroups[index];
        const objectId = buildMusicXmlObjectId({
          measureNumber: measureSequence,
          staffNumber: group.staffNumber,
          voiceNumber: group.voiceNumber,
          ordinal: index + 1,
        });
        const annotatedObjectIds = [
          ...new Set(
            group.noteElements.flatMap((noteElement) => {
              const annotatedObjectId = noteElement
                .getAttribute(MUSICXML_OBJECT_ID_ATTRIBUTE)
                ?.trim();

              return annotatedObjectId ? [annotatedObjectId] : [];
            }),
          ),
        ];

        for (const noteElement of group.noteElements) {
          noteElement.setAttribute(MUSICXML_OBJECT_ID_ATTRIBUTE, objectId);
        }

        const object = {
          id: objectId,
          annotatedObjectIds,
          type: group.notes.size > 1 ? "chord" : "note",
          bbox: {
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
          staff: group.staffLabel,
          measure: measureNumber,
          onset: group.onset,
          pageIndex: currentPageIndex,
          voiceNumber: group.voiceNumber,
          notes: [...group.notes].sort(compareNoteNames),
          confidence: 1,
          source: "model",
        } satisfies ParsedMusicXmlObject;

        measureObjects.push(object);
      }
    }

    measureObjects.sort((left, right) => left.onset - right.onset);
    objects.push(...measureObjects);
    currentPageObjects.push(...measureObjects);

    previousMeasureNumber = measureSequence;
  }

  if (previousMeasureNumber !== null) {
    finalizeCurrentPage(previousMeasureNumber);
  }

  return {
    annotatedXmlText: new XMLSerializer().serializeToString(document),
    currentKey,
    objects,
    pages,
    pageCount: pages.length,
    title,
  };
}

function leastCommonMultiple(left: number, right: number) {
  let a = left;
  let b = right;

  while (b !== 0) {
    [a, b] = [b, a % b];
  }

  const resolution = (left / a) * right;
  if (!Number.isSafeInteger(resolution)) {
    throw new Error("Unsupported MusicXML: timing resolution exceeds safe integer precision.");
  }
  return resolution;
}

function circleOfFifthsToKeyName(fifths: number, mode: string) {
  const majorKeys = [
    "Cb major",
    "Gb major",
    "Db major",
    "Ab major",
    "Eb major",
    "Bb major",
    "F major",
    "C major",
    "G major",
    "D major",
    "A major",
    "E major",
    "B major",
    "F# major",
    "C# major",
  ];
  const minorKeys = [
    "Ab minor",
    "Eb minor",
    "Bb minor",
    "F minor",
    "C minor",
    "G minor",
    "D minor",
    "A minor",
    "E minor",
    "B minor",
    "F# minor",
    "C# minor",
    "G# minor",
    "D# minor",
    "A# minor",
  ];
  const clampedIndex = Math.max(-7, Math.min(7, fifths)) + 7;

  return mode === "minor" ? minorKeys[clampedIndex] : majorKeys[clampedIndex];
}

function parsePitchName(noteElement: Element) {
  if (firstDirectChild(noteElement, "rest")) {
    return null;
  }

  const pitchElement = firstDirectChild(noteElement, "pitch");

  if (!pitchElement) {
    return null;
  }

  const step = getTextContent(firstDirectChild(pitchElement, "step"));
  const octave = getTextContent(firstDirectChild(pitchElement, "octave"));

  if (!step || !octave) {
    throw new Error("Invalid MusicXML pitch: missing step or octave.");
  }

  const alterText = getTextContent(firstDirectChild(pitchElement, "alter"));
  const alter = alterText === null ? 0 : Number(alterText);
  const octaveNumber = Number(octave);
  if (
    !/^[A-G]$/i.test(step) ||
    !/^-?\d+$/.test(octave) ||
    !Number.isSafeInteger(octaveNumber) ||
    !Number.isSafeInteger(12 * (octaveNumber + 1) + alter) ||
    !Number.isInteger(alter) || alter < -2 || alter > 2
  ) {
    throw new Error("Unsupported MusicXML pitch: expected an integer octave and a semitone alteration from -2 to 2.");
  }

  return `${step.toUpperCase()}${accidentalFromAlter(alter)}${octave}`;
}

function accidentalFromAlter(alter: number) {
  if (alter === -2) {
    return "bb";
  }

  if (alter === -1) {
    return "b";
  }

  if (alter === 1) {
    return "#";
  }

  if (alter === 2) {
    return "##";
  }

  return "";
}

function compareNoteNames(left: string, right: string) {
  return noteNameCollator.compare(left, right);
}

function firstElement<T extends Element>(items: ArrayLike<T>) {
  return items.length > 0 ? items[0] ?? null : null;
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

function directChildElementsByTagName(parent: Element, tagName: string) {
  return directChildElements(parent).filter((child) => child.tagName === tagName);
}

function firstDirectChild(parent: Element | null, tagName: string) {
  if (!parent) {
    return null;
  }

  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1 && (child as Element).tagName === tagName) {
      return child as Element;
    }
  }
  return null;
}

function getTextContent(element: Element | null) {
  const value = element?.textContent?.trim();
  return value ? value : null;
}

function parseInteger(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function measureStartsNewPage(measureElement: Element) {
  return directChildElementsByTagName(measureElement, "print").some(
    (printElement) => printElement.getAttribute("new-page")?.toLowerCase() === "yes",
  );
}

function findFallbackMusicXmlEntry(fileNames: string[]) {
  const scoreNames = fileNames.filter((fileName) => !fileName.toUpperCase().startsWith("META-INF/"));
  return (
    scoreNames.find((fileName) => fileName.toLowerCase().endsWith(".musicxml")) ??
    scoreNames.find((fileName) => fileName.toLowerCase().endsWith(".xml")) ??
    null
  );
}

function toUint8Array(buffer: Buffer) {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function extractRootFilePath(containerXmlText: string) {
  const document = parseXmlDocument(containerXmlText);
  const rootFileElement =
    firstElement(document.getElementsByTagName("rootfile")) ??
    findElementByLocalName(document.documentElement, "rootfile");
  const fullPath = rootFileElement?.getAttribute("full-path")?.trim();

  return fullPath ? fullPath : null;
}

function findElementByLocalName(root: Element | null, localName: string): Element | null {
  if (!root) {
    return null;
  }

  if (matchesLocalName(root, localName)) {
    return root;
  }

  for (const child of directChildElements(root)) {
    const found = findElementByLocalName(child, localName);

    if (found) {
      return found;
    }
  }

  return null;
}

function matchesLocalName(element: Element, localName: string) {
  const candidate = element.localName ?? element.tagName;
  return candidate === localName || candidate.endsWith(`:${localName}`);
}


function assertXmlSize(bytes: number, limit: number) {
  if (bytes > limit) {
    throw new Error(`MusicXML document exceeds the ${limit / (1024 * 1024)} MiB size limit.`);
  }
}

function parseXmlDocument(xmlText: string) {
  let invalid = false;
  const markInvalid = () => { invalid = true; };
  const document = new DOMParser({
    errorHandler: {
      warning: markInvalid,
      error: markInvalid,
      fatalError: markInvalid,
    },
  }).parseFromString(xmlText, "application/xml");
  if (invalid || !document?.documentElement) {
    throw new Error("Invalid MusicXML: malformed XML document.");
  }
  return document;
}

function parseTimingValue(value: string | null, minimum: number) {
  if (value === null) {
    return minimum;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error("Unsupported MusicXML timing resolution: expected nonnegative integer durations and positive integer divisions.");
  }
  return parsed;
}
