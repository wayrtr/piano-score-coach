import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import { MusicXmlScoreView } from "@/components/practice/musicxml-score-view";
import { buildMusicXmlObjectId, scopeMusicXmlObjectId } from "@/lib/musicxml/shared";
import type { PracticeMusicXmlPage, PracticeScoreObject } from "@/lib/practice/types";

type FakeMusicXmlNote = {
  isRest: () => boolean;
  _key: string;
  _chordNotes: FakeMusicXmlNote[];
  _vfnoteIndex: number;
  _renderGroup?: SVGGElement;
  _noteheadElements?: SVGGElement[];
  Pitch: {
    ToStringShort: (octaveOffset?: number) => string;
  };
};

type FakeMeasure = {
  MeasureNumber?: number;
  measureListIndex: number;
  CompleteNumberOfStaves?: number;
  getEntriesPerStaff: (staffIndex: number) => Array<{ VoiceEntries: Array<{ Notes: FakeMusicXmlNote[]; ParentVoice?: { VoiceId: number } }> } | null | undefined>;
};

const mockOsmdState = {
  stageElement: null as HTMLDivElement | null,
  measures: [] as FakeMeasure[],
  noteElements: [] as SVGGElement[],
  loadGate: null as Promise<void> | null,
  loadGatesByXml: new Map<string, Promise<void>>(),
  loadCalls: [] as string[],
  loadStarted: false,
  renderCalls: 0,
  noteRect: null as DOMRect | null,
  options: {} as Record<string, unknown>,
};

vi.mock("opensheetmusicdisplay", () => {
  class FakeOpenSheetMusicDisplay {
    Zoom = 1;
    EngravingRules = {};
    private loadedXml = "";
    Sheet = {
      get SourceMeasures() {
        return mockOsmdState.measures;
      },
    };

    constructor(private hostElement: HTMLDivElement, options: Record<string, unknown>) {
      mockOsmdState.options = options;
      mockOsmdState.stageElement = hostElement;
      hostElement.innerHTML = "";
    }

    async load(xmlText: string) {
      this.loadedXml = xmlText;
      mockOsmdState.loadStarted = true;
      mockOsmdState.loadCalls.push(xmlText);
      await (mockOsmdState.loadGatesByXml.get(xmlText) ?? mockOsmdState.loadGate);
    }

    render() {
      mockOsmdState.renderCalls += 1;
      this.hostElement.dataset.renderedScore = this.loadedXml;
    }
  }

  const getOrCreateElements = (note: FakeMusicXmlNote) => {
    const chordNotes = note._chordNotes;
    const anchorNote = chordNotes[0];

    if (anchorNote._renderGroup && anchorNote._noteheadElements) {
      if (
        mockOsmdState.stageElement &&
        !mockOsmdState.stageElement.contains(anchorNote._renderGroup)
      ) {
        mockOsmdState.stageElement.appendChild(anchorNote._renderGroup);
      }

      return {
        group: anchorNote._renderGroup,
        noteheads: anchorNote._noteheadElements,
      };
    }

    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.classList.add(chordNotes.length > 1 ? "vf-stavenote" : "vf-note");
    const noteheads = chordNotes.map((chordNote) => {
      const notehead = document.createElementNS("http://www.w3.org/2000/svg", "g");
      notehead.classList.add("vf-notehead");
      notehead.dataset.noteKey = chordNote._key;
      group.appendChild(notehead);
      return notehead;
    });

    if (mockOsmdState.noteRect) {
      group.getBoundingClientRect = () => mockOsmdState.noteRect as DOMRect;
    }
    if (mockOsmdState.stageElement && !mockOsmdState.stageElement.contains(group)) {
      mockOsmdState.stageElement.appendChild(group);
    }
    mockOsmdState.noteElements.push(...noteheads);
    chordNotes.forEach((chordNote) => {
      chordNote._renderGroup = group;
      chordNote._noteheadElements = noteheads;
    });

    return { group, noteheads };
  };

  return {
    OpenSheetMusicDisplay: FakeOpenSheetMusicDisplay,
    GraphicalNote: {
      FromNote(note: FakeMusicXmlNote) {
        const { group, noteheads } = getOrCreateElements(note);
        return {
          vfnoteIndex: note._vfnoteIndex,
          getSVGGElement: () => group,
          getNoteheadSVGs: note._key.startsWith("note-without-noteheads")
            ? undefined
            : () => noteheads,
        };
      },
    },
    Pitch: {
      OctaveXmlDifference: 3,
    },
  };
});

const originalFetch = globalThis.fetch;

function createFakeNote(key: string, noteName = "C4"): FakeMusicXmlNote {
  const note = {
    _key: key,
    _chordNotes: [] as FakeMusicXmlNote[],
    _vfnoteIndex: 0,
    isRest: () => false,
    Pitch: {
      ToStringShort: (octaveOffset = 0) =>
        noteName.replace(/(-?\d+)$/, (octave) =>
          String(Number(octave) + octaveOffset - 3),
        ),
    },
  };

  note._chordNotes = [note];
  return note;
}

function linkFakeChord(notes: FakeMusicXmlNote[]) {
  notes.forEach((note, index) => {
    note._chordNotes = notes;
    note._vfnoteIndex = index;
  });

  return notes;
}

function createFakeMeasure(
  noteKeys: string[],
  measureListIndex = 0,
  noteNames: string[] = [],
): FakeMeasure {
  const notes = linkFakeChord(
    noteKeys.map((key, index) => createFakeNote(key, noteNames[index] ?? "C4")),
  );

  return {
    MeasureNumber: measureListIndex + 1,
    measureListIndex,
    CompleteNumberOfStaves: 1,
    getEntriesPerStaff: () => [
      {
        VoiceEntries: [
          {
            Notes: notes,
            ParentVoice: { VoiceId: 1 },
          },
        ],
      },
    ],
  };
}

function createFakeGrandStaffMeasure(upperNoteKey: string, lowerNoteKey: string): FakeMeasure {
  const notesByStaff = [
    [createFakeNote(upperNoteKey, "C4")],
    [createFakeNote(lowerNoteKey, "C3")],
  ];

  return {
    MeasureNumber: 1,
    measureListIndex: 0,
    CompleteNumberOfStaves: 2,
    getEntriesPerStaff: (staffIndex) => [
      {
        VoiceEntries: [
          {
            Notes: notesByStaff[staffIndex] ?? [],
            ParentVoice: { VoiceId: 1 },
          },
        ],
      },
    ],
  };
}

function createFakeMultiVoiceMeasure(
  firstNoteKey: string,
  secondNoteKey: string,
  nextEntryNoteKey: string,
): FakeMeasure {
  return {
    MeasureNumber: 1,
    measureListIndex: 0,
    CompleteNumberOfStaves: 1,
    getEntriesPerStaff: () => [
      {
        VoiceEntries: [
          {
            Notes: [createFakeNote(firstNoteKey)],
            ParentVoice: { VoiceId: 1 },
          },
          {
            Notes: [createFakeNote(secondNoteKey)],
            ParentVoice: { VoiceId: 2 },
          },
        ],
      },
      {
        VoiceEntries: [
          {
            Notes: [createFakeNote(nextEntryNoteKey)],
            ParentVoice: { VoiceId: 1 },
          },
        ],
      },
    ],
  };
}

function setMockSourceMeasures(measures: FakeMeasure[]) {
  mockOsmdState.measures = measures;
}

function createScoreObject(id: string, measure = 1): PracticeScoreObject {
  return {
    id,
    measure,
    type: "note",
    staff: "treble",
    source: "model",
    notes: ["C4"],
    confidence: 1,
    bbox: { x: 0, y: 0, width: 1, height: 1 },
  };
}

function createMapBackedObjects(objects: PracticeScoreObject[]): PracticeMusicXmlPage["objects"] {
  const map = new Map<string, PracticeScoreObject>();
  objects.forEach((object) => map.set(object.id, object));
  (map as unknown as { map: (callback: (value: PracticeScoreObject) => PracticeScoreObject) => PracticeScoreObject[] }).map = function (callback) {
    return Array.from(map.values()).map(callback);
  };
  return map as unknown as PracticeMusicXmlPage["objects"];
}

function buildMusicXmlPage(objects: PracticeScoreObject[] | PracticeMusicXmlPage["objects"]): PracticeMusicXmlPage {
  return {
    id: "page-1",
    pageIndex: 0,
    recognitionStatus: "succeeded",
    renderMode: "musicxml",
    musicXmlSrc: "/scores/musicxml",
    measureStart: 1,
    measureEnd: 1,
    objects: objects as PracticeScoreObject[],
  };
}

async function waitForRenderedTarget(container: HTMLElement) {
  const stage = container.querySelector(".musicxml-sheet-canvas");

  if (!(stage instanceof HTMLDivElement)) {
    throw new Error("MusicXML stage missing");
  }

  await waitFor(() => {
    if (!stage.querySelector("[data-musicxml-object-id]")) {
      throw new Error("click targets not ready");
    }
  });

  const clickable = stage.querySelector("[data-musicxml-object-id]") as HTMLElement | null;

  if (!clickable) {
    throw new Error("clickable target disappeared");
  }

  return { stage, clickable };
}

describe("MusicXmlScoreView", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setMockSourceMeasures([]);
    mockOsmdState.noteElements = [];
    mockOsmdState.stageElement = null;
    mockOsmdState.loadGate = null;
    mockOsmdState.loadGatesByXml.clear();
    mockOsmdState.loadCalls = [];
    mockOsmdState.loadStarted = false;
    mockOsmdState.renderCalls = 0;
    mockOsmdState.noteRect = null;
    mockOsmdState.options = {};
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        text: () => Promise.resolve("<score/>"),
      }) as Promise<Response>,
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("maps the vocal melody and both piano staves without discarding lyric XML", async () => {
    const xmlWithLyrics = '<score-partwise><part id="voice"><measure number="1"><note><lyric><text>测试</text></lyric></note></measure></part><part id="piano" /></score-partwise>';
    vi.mocked(fetch).mockResolvedValue({ ok: true, text: async () => xmlWithLyrics } as Response);
    const pitches = ["C5", "E4", "C3"];
    const ids = pitches.map((_, index) => scopeMusicXmlObjectId("page-1", buildMusicXmlObjectId({
      measureNumber: 1, staffNumber: index + 1, voiceNumber: 1, ordinal: 1,
    })));
    setMockSourceMeasures([{
      MeasureNumber: 1,
      measureListIndex: 0,
      CompleteNumberOfStaves: 3,
      getEntriesPerStaff: (staffIndex) => [{ VoiceEntries: [{
        Notes: [createFakeNote(`part-staff-${staffIndex}`, pitches[staffIndex])],
        ParentVoice: { VoiceId: 1 },
      }] }],
    }]);
    const page = buildMusicXmlPage(ids.map((id, index) => ({
      ...createScoreObject(id), notes: [pitches[index]], staff: index === 2 ? "bass" : "treble",
    })));
    const onSelectObject = vi.fn();
    const { container } = render(<MusicXmlScoreView page={page} selectedObjectId={null} zoom={1} onSelectObject={onSelectObject} />);
    await waitForRenderedTarget(container);

    for (const id of ids) {
      const target = container.querySelector(`[data-musicxml-object-id="${id}"]`);
      expect(target).not.toBeNull();
      fireEvent.click(target!);
      expect(onSelectObject).toHaveBeenLastCalledWith({ pageIndex: 0, objectId: id });
    }
    expect(mockOsmdState.loadCalls).toContain(xmlWithLyrics);
    expect(mockOsmdState.options.drawLyrics).toBe(true);
  });

  it("rebuilt object maps even when page.objects behaves like a Map", async () => {
    const objectId = buildMusicXmlObjectId({
      measureNumber: 1,
      staffNumber: 1,
      voiceNumber: 1,
      ordinal: 1,
    });

    setMockSourceMeasures([createFakeMeasure(["note-map"])]);
    const page = buildMusicXmlPage(createMapBackedObjects([createScoreObject(objectId)]));

    const onSelectObject = vi.fn();
    const { container } = render(
      <MusicXmlScoreView
        page={page}
        selectedObjectId={null}
        zoom={1}
        onSelectObject={onSelectObject}
        inlineGuitarGuide={undefined}
      />,
    );

    const { clickable } = await waitForRenderedTarget(container);

    fireEvent.click(clickable);

    await waitFor(() =>
      expect(onSelectObject).toHaveBeenCalledWith({
        pageIndex: page.pageIndex,
        objectId,
      }),
    );
  });

  it("returns scoped object ids when the page objects expose scoped ids", async () => {
    const rawId = buildMusicXmlObjectId({
      measureNumber: 1,
      staffNumber: 1,
      voiceNumber: 1,
      ordinal: 1,
    });
    const scopedId = scopeMusicXmlObjectId("page-1", rawId);

    setMockSourceMeasures([createFakeMeasure(["note-scoped"])]);
    const page = buildMusicXmlPage([createScoreObject(scopedId)]);

    const onSelectObject = vi.fn();
    const { container } = render(
      <MusicXmlScoreView
        page={page}
        selectedObjectId={null}
        zoom={1}
        onSelectObject={onSelectObject}
        inlineGuitarGuide={undefined}
      />,
    );

    const { clickable } = await waitForRenderedTarget(container);

    expect(clickable.getAttribute("data-musicxml-object-id")).toBe(scopedId);
    fireEvent.click(clickable);

    await waitFor(() =>
      expect(onSelectObject).toHaveBeenCalledWith({
        pageIndex: page.pageIndex,
        objectId: scopedId,
      }),
    );
  });

  it("returns legacy unscoped object ids when the page objects only have legacy ids", async () => {
    const rawId = buildMusicXmlObjectId({
      measureNumber: 1,
      staffNumber: 1,
      voiceNumber: 1,
      ordinal: 1,
    });

    setMockSourceMeasures([createFakeMeasure(["note-legacy"])]);
    const page = buildMusicXmlPage([createScoreObject(rawId)]);

    const onSelectObject = vi.fn();
    const { container } = render(
      <MusicXmlScoreView
        page={page}
        selectedObjectId={null}
        zoom={1}
        onSelectObject={onSelectObject}
        inlineGuitarGuide={undefined}
      />,
    );

    const { clickable } = await waitForRenderedTarget(container);

    expect(clickable.getAttribute("data-musicxml-object-id")).toBe(rawId);
    fireEvent.click(clickable);

    await waitFor(() =>
      expect(onSelectObject).toHaveBeenCalledWith({
        pageIndex: page.pageIndex,
        objectId: rawId,
      }),
    );
  });

  it("maps every voice in one rendered entry to the matching legacy object", async () => {
    const firstLegacyObjectId = "mxo-0001-1-0001";
    const secondLegacyObjectId = "mxo-0001-1-0002";
    const onSelectObject = vi.fn();

    setMockSourceMeasures([
      createFakeMultiVoiceMeasure(
        "legacy-first-voice",
        "legacy-second-voice",
        "legacy-next-entry",
      ),
    ]);
    const page = buildMusicXmlPage([
      {
        ...createScoreObject(secondLegacyObjectId),
        onset: 6,
        notes: ["G4"],
      },
      {
        ...createScoreObject(firstLegacyObjectId),
        onset: 0,
        type: "chord",
        notes: ["C4", "E4"],
      },
    ]);
    const { container } = render(
      <MusicXmlScoreView
        page={page}
        selectedObjectId={null}
        zoom={1}
        onSelectObject={onSelectObject}
        inlineGuitarGuide={undefined}
      />,
    );

    await waitFor(() => {
      expect(
        container.querySelectorAll(
          `[data-musicxml-object-id="${firstLegacyObjectId}"]`,
        ),
      ).toHaveLength(2);
      expect(
        container.querySelectorAll(
          `[data-musicxml-object-id="${secondLegacyObjectId}"]`,
        ),
      ).toHaveLength(1);
    });

    const targets = container.querySelectorAll(
      `[data-musicxml-object-id="${firstLegacyObjectId}"]`,
    );
    expect(targets[0]).toHaveAttribute("data-musicxml-primary-target");
    expect(targets[1]).not.toHaveAttribute("data-musicxml-primary-target");

    fireEvent.click(targets[1]);

    await waitFor(() =>
      expect(onSelectObject).toHaveBeenCalledWith({
        pageIndex: page.pageIndex,
        objectId: firstLegacyObjectId,
      }),
    );
  });

  it("updates difficult-note decoration and accessible labels without rerendering the score", async () => {
    const objectId = buildMusicXmlObjectId({
      measureNumber: 1,
      staffNumber: 1,
      voiceNumber: 1,
      ordinal: 1,
    });
    const page = buildMusicXmlPage([createScoreObject(objectId)]);

    setMockSourceMeasures([createFakeMeasure(["note-difficult"])]);
    const { rerender, container } = render(
      <MusicXmlScoreView
        page={page}
        selectedObjectId={null}
        difficultObjectIds={[]}
        zoom={1}
        onSelectObject={() => undefined}
        inlineGuitarGuide={undefined}
      />,
    );

    const { clickable } = await waitForRenderedTarget(container);
    expect(clickable).not.toHaveClass("musicxml-click-target-difficult");

    rerender(
      <MusicXmlScoreView
        page={page}
        selectedObjectId={null}
        difficultObjectIds={[objectId]}
        zoom={1}
        onSelectObject={() => undefined}
        inlineGuitarGuide={undefined}
      />,
    );

    await waitFor(() => {
      expect(clickable).toHaveClass("musicxml-click-target-difficult");
      expect(clickable).toHaveAttribute(
        "aria-label",
        "定位到第 1 页第 1 小节 C4，已标记难点",
      );
    });
  });

  it("marks every object in the next grand-staff event as a preview", async () => {
    const upperObjectId = buildMusicXmlObjectId({
      measureNumber: 1,
      staffNumber: 1,
      voiceNumber: 1,
      ordinal: 1,
    });
    const lowerObjectId = buildMusicXmlObjectId({
      measureNumber: 1,
      staffNumber: 2,
      voiceNumber: 1,
      ordinal: 1,
    });
    const lowerObject = {
      ...createScoreObject(lowerObjectId),
      staff: "bass",
      notes: ["C3"],
    };

    setMockSourceMeasures([createFakeGrandStaffMeasure("preview-upper", "preview-lower")]);
    const page = buildMusicXmlPage([
      createScoreObject(upperObjectId),
      lowerObject,
    ]);
    const { container } = render(
      <MusicXmlScoreView
        page={page}
        selectedObjectId={null}
        previewObjectIds={[upperObjectId, lowerObjectId]}
        zoom={1}
        onSelectObject={() => undefined}
        inlineGuitarGuide={undefined}
      />,
    );

    await waitForRenderedTarget(container);

    await waitFor(() => {
      const upperTarget = container.querySelector(
        `[data-musicxml-object-id="${upperObjectId}"]`,
      );
      const lowerTarget = container.querySelector(
        `[data-musicxml-object-id="${lowerObjectId}"]`,
      );

      expect(upperTarget).toHaveClass("musicxml-click-target-preview");
      expect(
        upperTarget?.querySelector('[data-note-key="preview-upper"]'),
      ).toHaveAttribute("data-note-color", "0");
      expect(upperTarget).toHaveAttribute(
        "aria-label",
        "定位到第 1 页第 1 小节 C4，下一音",
      );
      expect(lowerTarget).toHaveClass("musicxml-click-target-preview");
      expect(
        lowerTarget?.querySelector('[data-note-key="preview-lower"]'),
      ).toHaveAttribute("data-note-color", "1");
      expect(lowerTarget).toHaveAttribute(
        "aria-label",
        "定位到第 1 页第 1 小节 C3，下一音",
      );
    });
  });

  it("marks every object in the current grand-staff event as active", async () => {
    const upperObjectId = buildMusicXmlObjectId({
      measureNumber: 1,
      staffNumber: 1,
      voiceNumber: 1,
      ordinal: 1,
    });
    const lowerObjectId = buildMusicXmlObjectId({
      measureNumber: 1,
      staffNumber: 2,
      voiceNumber: 1,
      ordinal: 1,
    });
    const lowerObject = {
      ...createScoreObject(lowerObjectId),
      staff: "bass",
      notes: ["C3"],
    };

    setMockSourceMeasures([createFakeGrandStaffMeasure("active-upper", "active-lower")]);
    const page = buildMusicXmlPage([
      createScoreObject(upperObjectId),
      lowerObject,
    ]);
    const { container } = render(
      <MusicXmlScoreView
        page={page}
        selectedObjectId={upperObjectId}
        selectedObjectIds={[upperObjectId, lowerObjectId]}
        zoom={1}
        onSelectObject={() => undefined}
        inlineGuitarGuide={undefined}
      />,
    );

    await waitForRenderedTarget(container);

    await waitFor(() => {
      expect(
        container.querySelector(`[data-musicxml-object-id="${upperObjectId}"]`),
      ).toHaveClass("musicxml-click-target-active");
      expect(
        container.querySelector(`[data-musicxml-object-id="${lowerObjectId}"]`),
      ).toHaveClass("musicxml-click-target-active");
    });
  });

  it("uses the shared instrument color map for every current score note", async () => {
    const upperObjectId = buildMusicXmlObjectId({
      measureNumber: 1,
      staffNumber: 1,
      voiceNumber: 1,
      ordinal: 1,
    });
    const lowerObjectId = buildMusicXmlObjectId({
      measureNumber: 1,
      staffNumber: 2,
      voiceNumber: 1,
      ordinal: 1,
    });
    const upperObject = {
      ...createScoreObject(upperObjectId),
      notes: ["C4"],
    };
    const lowerObject = {
      ...createScoreObject(lowerObjectId),
      staff: "bass",
      notes: ["C3"],
    };

    setMockSourceMeasures([
      createFakeGrandStaffMeasure("colored-upper", "colored-lower"),
    ]);
    const page = buildMusicXmlPage([upperObject, lowerObject]);
    const { container } = render(
      <MusicXmlScoreView
        page={page}
        selectedObjectId={upperObjectId}
        selectedObjectIds={[upperObjectId, lowerObjectId]}
        noteColors={new Map([[60, 4], [48, 1]])}
        zoom={1}
        onSelectObject={() => undefined}
        inlineGuitarGuide={undefined}
      />,
    );

    await waitForRenderedTarget(container);

    const upperNote = mockOsmdState.noteElements.find(
      (element) => element.dataset.noteKey === "colored-upper",
    );
    const lowerNote = mockOsmdState.noteElements.find(
      (element) => element.dataset.noteKey === "colored-lower",
    );

    expect(upperNote).toHaveAttribute("data-note-color", "4");
    expect(upperNote).toHaveAttribute("data-note-midi", "60");
    expect(lowerNote).toHaveAttribute("data-note-color", "1");
    expect(lowerNote).toHaveAttribute("data-note-midi", "48");
  });

  it("colors every chord note by MIDI even when render order differs", async () => {
    const objectId = buildMusicXmlObjectId({
      measureNumber: 1,
      staffNumber: 1,
      voiceNumber: 1,
      ordinal: 1,
    });
    const chord = {
      ...createScoreObject(objectId),
      type: "chord" as const,
      notes: ["C4", "E4", "G4"],
    };

    setMockSourceMeasures([
      createFakeMeasure(
        ["chord-g", "chord-c", "chord-e"],
        0,
        ["G4", "C4", "E4"],
      ),
    ]);
    const { container } = render(
      <MusicXmlScoreView
        page={buildMusicXmlPage([chord])}
        selectedObjectId={objectId}
        zoom={1}
        onSelectObject={() => undefined}
        inlineGuitarGuide={undefined}
      />,
    );

    await waitForRenderedTarget(container);

    expect(
      mockOsmdState.noteElements.find(
        (element) => element.dataset.noteKey === "chord-g",
      ),
    ).toHaveAttribute("data-note-color", "2");
    expect(
      mockOsmdState.noteElements.find(
        (element) => element.dataset.noteKey === "chord-g",
      ),
    ).toHaveAttribute("data-note-midi", "67");
    expect(
      mockOsmdState.noteElements.find(
        (element) => element.dataset.noteKey === "chord-c",
      ),
    ).toHaveAttribute("data-note-color", "0");
    expect(
      mockOsmdState.noteElements.find(
        (element) => element.dataset.noteKey === "chord-c",
      ),
    ).toHaveAttribute("data-note-midi", "60");
    expect(
      mockOsmdState.noteElements.find(
        (element) => element.dataset.noteKey === "chord-e",
      ),
    ).toHaveAttribute("data-note-color", "1");
    expect(
      mockOsmdState.noteElements.find(
        (element) => element.dataset.noteKey === "chord-e",
      ),
    ).toHaveAttribute("data-note-midi", "64");
  });

  it("colors an explicitly natural OSMD pitch with its instrument MIDI", async () => {
    const objectId = buildMusicXmlObjectId({
      measureNumber: 1,
      staffNumber: 1,
      voiceNumber: 1,
      ordinal: 1,
    });

    setMockSourceMeasures([
      createFakeMeasure(["natural-c"], 0, ["Cn4"]),
    ]);
    const { container } = render(
      <MusicXmlScoreView
        page={buildMusicXmlPage([createScoreObject(objectId)])}
        selectedObjectId={objectId}
        zoom={1}
        onSelectObject={() => undefined}
        inlineGuitarGuide={undefined}
      />,
    );

    await waitForRenderedTarget(container);

    const naturalNote = mockOsmdState.noteElements.find(
      (element) => element.dataset.noteKey === "natural-c",
    );

    expect(naturalNote).toHaveAttribute("data-note-midi", "60");
    expect(naturalNote).toHaveAttribute("data-note-color", "0");
  });

  it("keeps an active fallback role when an OSMD pitch cannot map to MIDI", async () => {
    const objectId = buildMusicXmlObjectId({
      measureNumber: 1,
      staffNumber: 1,
      voiceNumber: 1,
      ordinal: 1,
    });
    const invalidObject = {
      ...createScoreObject(objectId),
      notes: ["H4"],
    };

    setMockSourceMeasures([
      createFakeMeasure(["invalid-pitch"], 0, ["H4"]),
    ]);
    const { container } = render(
      <MusicXmlScoreView
        page={buildMusicXmlPage([invalidObject])}
        selectedObjectId={objectId}
        zoom={1}
        onSelectObject={() => undefined}
        inlineGuitarGuide={undefined}
      />,
    );

    await waitForRenderedTarget(container);

    const invalidNote = mockOsmdState.noteElements.find(
      (element) => element.dataset.noteKey === "invalid-pitch",
    );

    expect(invalidNote).toHaveAttribute("data-note-role", "current");
    expect(invalidNote).not.toHaveAttribute("data-note-color");
    expect(invalidNote).not.toHaveAttribute("data-note-midi");
  });

  it("rerenders the score when the viewport changes", async () => {
    const objectId = buildMusicXmlObjectId({
      measureNumber: 1,
      staffNumber: 1,
      voiceNumber: 1,
      ordinal: 1,
    });

    mockOsmdState.noteRect = {
      top: 900,
      right: 140,
      bottom: 940,
      left: 100,
    } as DOMRect;
    setMockSourceMeasures([createFakeMeasure(["resize-note"])]);
    const page = buildMusicXmlPage([createScoreObject(objectId)]);
    const { container } = render(
      <div className="score-stage">
        <MusicXmlScoreView
          page={page}
          selectedObjectId={objectId}
          zoom={1}
          onSelectObject={() => undefined}
          inlineGuitarGuide={undefined}
        />
      </div>,
    );

    await waitForRenderedTarget(container);
    const scoreStage = container.querySelector(".score-stage") as HTMLDivElement;
    const scrollTo = vi.fn();

    Object.defineProperties(scoreStage, {
      clientHeight: { configurable: true, value: 420 },
      clientWidth: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, value: 1400 },
      scrollWidth: { configurable: true, value: 600 },
      scrollTo: { configurable: true, value: scrollTo },
    });
    scoreStage.getBoundingClientRect = vi.fn(() =>
      ({ top: 0, right: 600, bottom: 420, left: 0 } as DOMRect),
    );
    const renderCallsBeforeResize = mockOsmdState.renderCalls;

    window.dispatchEvent(new Event("resize"));

    await waitFor(() => {
      expect(mockOsmdState.renderCalls).toBeGreaterThan(renderCallsBeforeResize);
      expect(scrollTo).toHaveBeenCalledWith(
        expect.objectContaining({ top: 710 }),
      );
    });
  });

  it("reveals an offscreen selection inside the score viewport", async () => {
    const objectId = buildMusicXmlObjectId({
      measureNumber: 1,
      staffNumber: 1,
      voiceNumber: 1,
      ordinal: 1,
    });
    const page = buildMusicXmlPage([createScoreObject(objectId)]);
    const renderView = (selectedObjectId: string | null) => (
      <div className="score-stage">
        <MusicXmlScoreView
          page={page}
          selectedObjectId={selectedObjectId}
          zoom={1}
          onSelectObject={() => undefined}
          inlineGuitarGuide={undefined}
        />
      </div>
    );

    setMockSourceMeasures([createFakeMeasure(["offscreen-note"])]);
    const { container, rerender } = render(renderView(null));
    const { clickable } = await waitForRenderedTarget(container);
    const scoreStage = container.querySelector(".score-stage") as HTMLDivElement;
    const scrollTo = vi.fn();

    Object.defineProperties(scoreStage, {
      clientHeight: { configurable: true, value: 420 },
      clientWidth: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, value: 1400 },
      scrollWidth: { configurable: true, value: 600 },
      scrollTo: { configurable: true, value: scrollTo },
    });
    scoreStage.getBoundingClientRect = vi.fn(() =>
      ({ top: 0, right: 600, bottom: 420, left: 0 } as DOMRect),
    );
    clickable.getBoundingClientRect = vi.fn(() =>
      ({ top: 900, right: 140, bottom: 940, left: 100 } as DOMRect),
    );

    rerender(renderView(objectId));

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith(
        expect.objectContaining({ top: 710 }),
      );
    });
  });

  it("uses the latest selection when MusicXML loading finishes", async () => {
    const upperObjectId = buildMusicXmlObjectId({
      measureNumber: 1,
      staffNumber: 1,
      voiceNumber: 1,
      ordinal: 1,
    });
    const lowerObjectId = buildMusicXmlObjectId({
      measureNumber: 1,
      staffNumber: 2,
      voiceNumber: 1,
      ordinal: 1,
    });
    let releaseLoad!: () => void;

    mockOsmdState.loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    setMockSourceMeasures([createFakeGrandStaffMeasure("latest-upper", "latest-lower")]);
    const page = buildMusicXmlPage([
      createScoreObject(upperObjectId),
      {
        ...createScoreObject(lowerObjectId),
        staff: "bass",
        notes: ["C3"],
      },
    ]);
    const { container, rerender } = render(
      <MusicXmlScoreView
        page={page}
        selectedObjectId={upperObjectId}
        previewObjectIds={[lowerObjectId]}
        zoom={1}
        onSelectObject={() => undefined}
        inlineGuitarGuide={undefined}
      />,
    );

    await waitFor(() => expect(mockOsmdState.loadStarted).toBe(true));

    rerender(
      <MusicXmlScoreView
        page={page}
        selectedObjectId={lowerObjectId}
        previewObjectIds={[upperObjectId]}
        zoom={1}
        onSelectObject={() => undefined}
        inlineGuitarGuide={undefined}
      />,
    );
    releaseLoad();

    await waitForRenderedTarget(container);

    await waitFor(() => {
      const upperTarget = container.querySelector(
        `[data-musicxml-object-id="${upperObjectId}"]`,
      );
      const lowerTarget = container.querySelector(
        `[data-musicxml-object-id="${lowerObjectId}"]`,
      );

      expect(upperTarget).not.toHaveClass("musicxml-click-target-active");
      expect(upperTarget).toHaveClass("musicxml-click-target-preview");
      expect(lowerTarget).toHaveClass("musicxml-click-target-active");
      expect(lowerTarget).not.toHaveClass("musicxml-click-target-preview");
    });
  });

  it("does not rerender the previous page while the next page is loading", async () => {
    const objectId = buildMusicXmlObjectId({
      measureNumber: 1,
      staffNumber: 1,
      voiceNumber: 1,
      ordinal: 1,
    });
    const oldXml = "<ready-old-score/>";
    const newXml = "<loading-new-score/>";
    let releaseNewLoad!: () => void;
    const newLoadGate = new Promise<void>((resolve) => {
      releaseNewLoad = resolve;
    });

    mockOsmdState.loadGatesByXml.set(newXml, newLoadGate);
    setMockSourceMeasures([createFakeMeasure(["ready-old-note"])]);
    globalThis.fetch = vi.fn((input) =>
      Promise.resolve({
        ok: true,
        text: () => Promise.resolve(String(input).includes("new") ? newXml : oldXml),
      }) as Promise<Response>,
    );

    const oldPage = {
      ...buildMusicXmlPage([createScoreObject(objectId)]),
      id: "ready-old-page",
      musicXmlSrc: "/scores/old",
    };
    const newPage = {
      ...buildMusicXmlPage([createScoreObject(objectId)]),
      id: "loading-new-page",
      pageIndex: 1,
      musicXmlSrc: "/scores/new",
    };
    const renderView = (page: PracticeMusicXmlPage) => (
      <MusicXmlScoreView
        page={page}
        selectedObjectId={objectId}
        zoom={1}
        onSelectObject={() => undefined}
        inlineGuitarGuide={undefined}
      />
    );
    const { container, rerender } = render(renderView(oldPage));
    const { stage } = await waitForRenderedTarget(container);

    await waitFor(() => {
      expect(stage).toHaveAttribute("data-rendered-score", oldXml);
    });
    const renderCallsBeforeSwitch = mockOsmdState.renderCalls;

    setMockSourceMeasures([createFakeMeasure(["loading-new-note"])]);
    rerender(renderView(newPage));

    await waitFor(() => expect(mockOsmdState.loadCalls).toContain(newXml));
    expect(stage.querySelectorAll("[data-musicxml-object-id]")).toHaveLength(0);

    await act(async () => {
      window.dispatchEvent(new Event("resize"));
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    expect(mockOsmdState.renderCalls).toBe(renderCallsBeforeSwitch);

    await act(async () => {
      releaseNewLoad();
      await newLoadGate;
    });
    await waitFor(() => {
      expect(stage).toHaveAttribute("data-rendered-score", newXml);
      expect(stage.querySelector(`[data-musicxml-object-id="${objectId}"]`)).toBeTruthy();
    });
  });

  it("ignores an obsolete page load that finishes after the current page", async () => {
    const objectId = buildMusicXmlObjectId({
      measureNumber: 1,
      staffNumber: 1,
      voiceNumber: 1,
      ordinal: 1,
    });
    const oldXml = "<old-score/>";
    const newXml = "<new-score/>";
    let releaseOldLoad!: () => void;
    let releaseNewLoad!: () => void;
    const oldLoadGate = new Promise<void>((resolve) => {
      releaseOldLoad = resolve;
    });
    const newLoadGate = new Promise<void>((resolve) => {
      releaseNewLoad = resolve;
    });

    mockOsmdState.loadGatesByXml.set(oldXml, oldLoadGate);
    mockOsmdState.loadGatesByXml.set(newXml, newLoadGate);
    setMockSourceMeasures([createFakeMeasure(["page-race"])]);
    globalThis.fetch = vi.fn((input) =>
      Promise.resolve({
        ok: true,
        text: () => Promise.resolve(String(input).includes("new") ? newXml : oldXml),
      }) as Promise<Response>,
    );

    const oldPage = {
      ...buildMusicXmlPage([createScoreObject(objectId)]),
      id: "old-page",
      musicXmlSrc: "/scores/old",
    };
    const newPage = {
      ...buildMusicXmlPage([createScoreObject(objectId)]),
      id: "new-page",
      pageIndex: 1,
      musicXmlSrc: "/scores/new",
    };
    const { container, rerender } = render(
      <MusicXmlScoreView
        page={oldPage}
        selectedObjectId={null}
        zoom={1}
        onSelectObject={() => undefined}
        inlineGuitarGuide={undefined}
      />,
    );

    await waitFor(() => expect(mockOsmdState.loadCalls).toContain(oldXml));

    rerender(
      <MusicXmlScoreView
        page={newPage}
        selectedObjectId={objectId}
        zoom={1}
        onSelectObject={() => undefined}
        inlineGuitarGuide={undefined}
      />,
    );

    await waitFor(() => expect(mockOsmdState.loadCalls).toContain(newXml));
    releaseNewLoad();

    const { stage } = await waitForRenderedTarget(container);
    await waitFor(() => {
      expect(stage).toHaveAttribute("data-rendered-score", newXml);
      expect(stage.querySelector(`[data-musicxml-object-id="${objectId}"]`)).toHaveClass(
        "musicxml-click-target-active",
      );
    });

    await act(async () => {
      releaseOldLoad();
      await oldLoadGate;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(stage).toHaveAttribute("data-rendered-score", newXml);
    expect(stage.querySelectorAll("[data-musicxml-object-id]")).toHaveLength(1);
    expect(stage.querySelector(`[data-musicxml-object-id="${objectId}"]`)).toHaveClass(
      "musicxml-click-target-active",
    );
  });

  it("does not color a shared chord group when OSMD cannot expose exact noteheads", async () => {
    const pageOneObjectId = buildMusicXmlObjectId({
      measureNumber: 1,
      staffNumber: 1,
      voiceNumber: 1,
      ordinal: 1,
    });
    const pageTwoObjectId = buildMusicXmlObjectId({
      measureNumber: 2,
      staffNumber: 1,
      voiceNumber: 1,
      ordinal: 1,
    });
    const onSelectObject = vi.fn();

    setMockSourceMeasures([createFakeMeasure(["note-safe"], 0)]);
    const { rerender, container } = render(
      <MusicXmlScoreView
        page={buildMusicXmlPage([createScoreObject(pageOneObjectId, 1)])}
        selectedObjectId={pageOneObjectId}
        zoom={1}
        onSelectObject={onSelectObject}
        inlineGuitarGuide={undefined}
      />,
    );

    await waitForRenderedTarget(container);

    setMockSourceMeasures([
      createFakeMeasure(
        ["note-without-noteheads-c", "note-without-noteheads-e"],
        1,
        ["C4", "E4"],
      ),
    ]);

    const pageTwoObject = {
      ...createScoreObject(pageTwoObjectId, 2),
      type: "chord" as const,
      notes: ["C4", "E4"],
    };

    rerender(
      <MusicXmlScoreView
        page={{
          ...buildMusicXmlPage([pageTwoObject]),
          id: "page-2",
          pageIndex: 1,
          measureStart: 2,
          measureEnd: 2,
        }}
        selectedObjectId={pageTwoObjectId}
        zoom={1}
        onSelectObject={onSelectObject}
        inlineGuitarGuide={undefined}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector(".inline-error")).not.toBeInTheDocument();
      expect(
        container.querySelector(`[data-musicxml-object-id="${pageTwoObjectId}"]`),
      ).toHaveClass("musicxml-click-target-active");
    });

    const sharedChordGroup = container.querySelector(
      `[data-musicxml-object-id="${pageTwoObjectId}"]`,
    );

    expect(sharedChordGroup).toHaveClass("vf-stavenote");
    expect(sharedChordGroup).not.toHaveAttribute("data-note-color");
    expect(sharedChordGroup).not.toHaveAttribute("data-note-midi");
    expect(sharedChordGroup?.querySelector("[data-note-color]")).toBeNull();
  });
});
