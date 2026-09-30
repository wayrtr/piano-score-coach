import { describe, expect, it } from "vitest";

import {
  getAdjacentPracticeSelection,
  getNextPracticeEvent,
  getNextPracticeSelection,
  getPracticePageEvents,
  getPracticeSelectionEvent,
  type PracticeNavigationDirection,
} from "@/lib/practice/navigation";
import type { PracticePage } from "@/lib/practice/types";

const pages: PracticePage[] = [
  {
    id: "page_1",
    pageIndex: 0,
    renderMode: "musicxml",
    musicXmlSrc: "/api/works/work_1/musicxml",
    measureStart: 1,
    measureEnd: 2,
    recognitionStatus: "succeeded",
    objects: [
      {
        id: "treble_1",
        type: "note",
        bbox: { x: 0, y: 0, width: 1, height: 1 },
        staff: "treble",
        measure: 1,
        notes: ["C5"],
        confidence: 1,
        source: "model",
      },
      {
        id: "treble_2",
        type: "note",
        bbox: { x: 0, y: 0, width: 1, height: 1 },
        staff: "treble",
        measure: 1,
        notes: ["E5"],
        confidence: 1,
        source: "model",
      },
      {
        id: "bass_1",
        type: "note",
        bbox: { x: 0, y: 0, width: 1, height: 1 },
        staff: "bass",
        measure: 1,
        notes: ["C3"],
        confidence: 1,
        source: "model",
      },
      {
        id: "treble_3",
        type: "note",
        bbox: { x: 0, y: 0, width: 1, height: 1 },
        staff: "treble",
        measure: 2,
        notes: ["G5"],
        confidence: 1,
        source: "model",
      },
      {
        id: "bass_2",
        type: "note",
        bbox: { x: 0, y: 0, width: 1, height: 1 },
        staff: "bass",
        measure: 2,
        notes: ["G3"],
        confidence: 1,
        source: "model",
      },
    ],
  },
  {
    id: "page_2",
    pageIndex: 1,
    renderMode: "musicxml",
    musicXmlSrc: "/api/works/work_1/musicxml?page=2",
    measureStart: 3,
    measureEnd: 3,
    recognitionStatus: "succeeded",
    objects: [
      {
        id: "treble_4",
        type: "note",
        bbox: { x: 0, y: 0, width: 1, height: 1 },
        staff: "treble",
        measure: 3,
        notes: ["A5"],
        confidence: 1,
        source: "model",
      },
    ],
  },
];

function navigate(
  direction: PracticeNavigationDirection,
  selectedObjectId: string | null,
  currentPageIndex = 0,
) {
  return getAdjacentPracticeSelection({
    pages,
    currentPageIndex,
    selectedObjectId,
    direction,
  });
}

describe("practice keyboard navigation", () => {
  it("returns no preview when there is no current selection", () => {
    expect(
      getNextPracticeSelection({
        pages,
        currentPageIndex: 0,
        selectedObjectId: null,
      }),
    ).toBeNull();
  });

  it("uses reading order to find the next selected object", () => {
    expect(
      getNextPracticeSelection({
        pages,
        currentPageIndex: 0,
        selectedObjectId: "bass_2",
      }),
    ).toEqual({
      pageIndex: 1,
      objectId: "treble_4",
    });
  });

  it("moves left and right through the reading order across pages", () => {
    expect(navigate("next", "bass_2")).toEqual({
      pageIndex: 1,
      objectId: "treble_4",
    });
    expect(navigate("previous", "treble_4", 1)).toEqual({
      pageIndex: 0,
      objectId: "bass_2",
    });
  });

  it("moves down from treble to the nearest bass note in the same measure", () => {
    expect(navigate("down_staff", "treble_2")).toEqual({
      pageIndex: 0,
      objectId: "bass_1",
    });
  });

  it("moves up from bass to the nearest treble note in the same measure", () => {
    expect(navigate("up_staff", "bass_2")).toEqual({
      pageIndex: 0,
      objectId: "treble_3",
    });
  });

  it("does not move further upward when already on the upper staff", () => {
    expect(navigate("up_staff", "treble_3")).toBeNull();
  });

  it("falls back to the current page's first object when nothing is selected", () => {
    expect(navigate("next", null)).toEqual({
      pageIndex: 0,
      objectId: "treble_1",
    });
  });

  it("follows MusicXML onset order across staves and keeps a chord as one event", () => {
    const grandStaffPage = {
      id: "grand_staff_page",
      pageIndex: 0,
      renderMode: "musicxml",
      musicXmlSrc: "/api/works/work_1/musicxml",
      measureStart: 1,
      measureEnd: 1,
      recognitionStatus: "succeeded",
      objects: [
        {
          id: "treble_late",
          type: "note",
          bbox: { x: 20, y: 10, width: 1, height: 1 },
          staff: "treble",
          measure: 1,
          onset: 4,
          notes: ["E5"],
          confidence: 1,
          source: "model",
        },
        {
          id: "bass_early",
          type: "note",
          bbox: { x: 10, y: 100, width: 1, height: 1 },
          staff: "bass",
          measure: 1,
          onset: 0,
          notes: ["C3"],
          confidence: 1,
          source: "model",
        },
        {
          id: "treble_chord",
          type: "chord",
          bbox: { x: 30, y: 10, width: 1, height: 1 },
          staff: "treble",
          measure: 1,
          onset: 8,
          notes: ["G4", "B4", "D5"],
          confidence: 1,
          source: "model",
        },
      ],
    } as PracticePage;

    expect(
      getNextPracticeSelection({
        pages: [grandStaffPage],
        currentPageIndex: 0,
        selectedObjectId: "bass_early",
      }),
    ).toEqual({
      pageIndex: 0,
      objectId: "treble_late",
    });

    expect(
      getNextPracticeSelection({
        pages: [grandStaffPage],
        currentPageIndex: 0,
        selectedObjectId: "treble_late",
      }),
    ).toEqual({
      pageIndex: 0,
      objectId: "treble_chord",
    });
  });

  it("groups every staff and voice at the same MusicXML onset into one practice event", () => {
    const grandStaffPage = {
      id: "grand_staff_page",
      pageIndex: 0,
      renderMode: "musicxml",
      musicXmlSrc: "/api/works/work_1/musicxml",
      measureStart: 1,
      measureEnd: 1,
      recognitionStatus: "succeeded",
      objects: [
        {
          id: "treble_now",
          type: "chord",
          bbox: { x: 10, y: 10, width: 1, height: 1 },
          staff: "treble",
          measure: 1,
          onset: 0,
          notes: ["E4", "G4"],
          confidence: 1,
          source: "model",
        },
        {
          id: "bass_now",
          type: "note",
          bbox: { x: 10, y: 100, width: 1, height: 1 },
          staff: "bass",
          measure: 1,
          onset: 0,
          notes: ["C3"],
          confidence: 1,
          source: "model",
        },
        {
          id: "treble_next",
          type: "note",
          bbox: { x: 20, y: 10, width: 1, height: 1 },
          staff: "treble",
          measure: 1,
          onset: 4,
          notes: ["F4"],
          confidence: 1,
          source: "model",
        },
        {
          id: "bass_next",
          type: "note",
          bbox: { x: 20, y: 100, width: 1, height: 1 },
          staff: "bass",
          measure: 1,
          onset: 4,
          notes: ["D3", "F4"],
          confidence: 1,
          source: "model",
        },
      ],
    } as PracticePage;

    for (const objectId of ["treble_now", "bass_now"]) {
      expect(
        getPracticeSelectionEvent({
          pages: [grandStaffPage],
          pageIndex: 0,
          objectId,
        }),
      ).toMatchObject({
        pageIndex: 0,
        measure: 1,
        onset: 0,
        primaryObjectId: "treble_now",
        objectIds: ["treble_now", "bass_now"],
        notes: ["E4", "G4", "C3"],
      });

      expect(
        getNextPracticeEvent({
          pages: [grandStaffPage],
          currentPageIndex: 0,
          selectedObjectId: objectId,
        }),
      ).toMatchObject({
        onset: 4,
        primaryObjectId: "treble_next",
        objectIds: ["treble_next", "bass_next"],
        notes: ["F4", "D3"],
      });

      expect(
        getNextPracticeSelection({
          pages: [grandStaffPage],
          currentPageIndex: 0,
          selectedObjectId: objectId,
        }),
      ).toEqual({
        pageIndex: 0,
        objectId: "treble_next",
      });
    }
  });

  it("keeps objects without onset metadata as separate legacy events", () => {
    expect(
      getPracticeSelectionEvent({
        pages,
        pageIndex: 0,
        objectId: "treble_1",
      }),
    ).toMatchObject({
      onset: null,
      primaryObjectId: "treble_1",
      objectIds: ["treble_1"],
      notes: ["C5"],
    });
  });

  it("groups horizontally aligned grand-staff objects on image and PDF pages", () => {
    const imagePage = {
      id: "image_page",
      pageIndex: 0,
      renderMode: "image",
      imageSrc: "/api/works/work_1/pages/page_1/image",
      imageWidth: 1_200,
      imageHeight: 1_800,
      recognitionStatus: "succeeded",
      objects: [
        {
          id: "image_treble_now",
          type: "chord",
          bbox: { x: 100, y: 180, width: 36, height: 42 },
          staff: "treble",
          measure: 1,
          notes: ["E4", "G4"],
          confidence: 0.94,
          source: "model",
        },
        {
          id: "image_bass_now",
          type: "note",
          bbox: { x: 106, y: 360, width: 32, height: 40 },
          staff: "bass",
          measure: 1,
          notes: ["C3"],
          confidence: 0.91,
          source: "model",
        },
        {
          id: "image_treble_next",
          type: "note",
          bbox: { x: 190, y: 180, width: 34, height: 42 },
          staff: "treble",
          measure: 1,
          notes: ["F4"],
          confidence: 0.93,
          source: "model",
        },
        {
          id: "image_bass_next",
          type: "note",
          bbox: { x: 196, y: 360, width: 32, height: 40 },
          staff: "bass",
          measure: 1,
          notes: ["D3"],
          confidence: 0.9,
          source: "model",
        },
      ],
    } as PracticePage;

    expect(
      getPracticeSelectionEvent({
        pages: [imagePage],
        pageIndex: 0,
        objectId: "image_bass_now",
      }),
    ).toMatchObject({
      primaryObjectId: "image_treble_now",
      objectIds: ["image_treble_now", "image_bass_now"],
      notes: ["E4", "G4", "C3"],
    });

    expect(
      getNextPracticeEvent({
        pages: [imagePage],
        currentPageIndex: 0,
        selectedObjectId: "image_treble_now",
      }),
    ).toMatchObject({
      primaryObjectId: "image_treble_next",
      objectIds: ["image_treble_next", "image_bass_next"],
      notes: ["F4", "D3"],
    });
  });

  it("keeps nearby image objects separate when their score boxes are not aligned", () => {
    const imagePage = {
      id: "image_page",
      pageIndex: 0,
      renderMode: "image",
      imageSrc: "/api/works/work_1/pages/page_1/image",
      imageWidth: 1_200,
      imageHeight: 1_800,
      recognitionStatus: "succeeded",
      objects: [
        {
          id: "image_treble_first",
          type: "note",
          bbox: { x: 100, y: 180, width: 36, height: 42 },
          staff: "treble",
          measure: 1,
          notes: ["E4"],
          confidence: 0.94,
          source: "model",
        },
        {
          id: "image_bass_later",
          type: "note",
          bbox: { x: 125, y: 360, width: 32, height: 40 },
          staff: "bass",
          measure: 1,
          notes: ["D3"],
          confidence: 0.91,
          source: "model",
        },
      ],
    } as PracticePage;

    expect(
      getPracticeSelectionEvent({
        pages: [imagePage],
        pageIndex: 0,
        objectId: "image_bass_later",
      }),
    ).toMatchObject({
      primaryObjectId: "image_bass_later",
      objectIds: ["image_bass_later"],
      notes: ["D3"],
    });
  });

  it("does not merge adjacent image events through chained box overlap", () => {
    const imagePage = {
      id: "image_page",
      pageIndex: 0,
      renderMode: "image",
      imageSrc: "/api/works/work_1/pages/page_1/image",
      imageWidth: 1_200,
      imageHeight: 1_800,
      recognitionStatus: "succeeded",
      objects: [
        {
          id: "upper_first",
          type: "note",
          bbox: { x: 0, y: 180, width: 20, height: 40 },
          staff: "treble",
          measure: 1,
          notes: ["E4"],
          confidence: 0.94,
          source: "model",
        },
        {
          id: "lower_first",
          type: "note",
          bbox: { x: 0, y: 360, width: 20, height: 40 },
          staff: "bass",
          measure: 1,
          notes: ["C3"],
          confidence: 0.91,
          source: "model",
        },
        {
          id: "upper_second",
          type: "note",
          bbox: { x: 8, y: 180, width: 20, height: 40 },
          staff: "treble",
          measure: 1,
          notes: ["F4"],
          confidence: 0.93,
          source: "model",
        },
        {
          id: "lower_second",
          type: "note",
          bbox: { x: 8, y: 360, width: 20, height: 40 },
          staff: "bass",
          measure: 1,
          notes: ["D3"],
          confidence: 0.9,
          source: "model",
        },
      ],
    } as PracticePage;

    expect(
      getPracticeSelectionEvent({
        pages: [imagePage],
        pageIndex: 0,
        objectId: "upper_first",
      }),
    ).toMatchObject({
      objectIds: ["upper_first", "lower_first"],
      notes: ["E4", "C3"],
    });
    expect(
      getPracticeSelectionEvent({
        pages: [imagePage],
        pageIndex: 0,
        objectId: "upper_second",
      }),
    ).toMatchObject({
      objectIds: ["upper_second", "lower_second"],
      notes: ["F4", "D3"],
    });
  });

  it("does not extend a mixed-staff image pair into the next event", () => {
    const imagePage = {
      id: "image_page",
      pageIndex: 0,
      renderMode: "image",
      imageSrc: "/api/works/work_1/pages/page_1/image",
      imageWidth: 1_200,
      imageHeight: 1_800,
      recognitionStatus: "succeeded",
      objects: [
        {
          id: "grand_first",
          type: "note",
          bbox: { x: 0, y: 180, width: 20, height: 40 },
          staff: "grand",
          measure: 1,
          notes: ["E4"],
          confidence: 0.94,
          source: "model",
        },
        {
          id: "bass_first",
          type: "note",
          bbox: { x: 0, y: 360, width: 20, height: 40 },
          staff: "bass",
          measure: 1,
          notes: ["C3"],
          confidence: 0.91,
          source: "model",
        },
        {
          id: "treble_second",
          type: "note",
          bbox: { x: 4, y: 180, width: 20, height: 40 },
          staff: "treble",
          measure: 1,
          notes: ["F4"],
          confidence: 0.93,
          source: "model",
        },
        {
          id: "bass_second",
          type: "note",
          bbox: { x: 4, y: 360, width: 20, height: 40 },
          staff: "bass",
          measure: 1,
          notes: ["D3"],
          confidence: 0.9,
          source: "model",
        },
      ],
    } as PracticePage;

    expect(getPracticePageEvents(imagePage).map((event) => event.objectIds)).toEqual([
      ["grand_first", "bass_first"],
      ["treble_second", "bass_second"],
    ]);
  });

  it("can pair an unclassified grand-staff object with an aligned bass object", () => {
    const imagePage = {
      id: "image_page",
      pageIndex: 0,
      renderMode: "image",
      imageSrc: "/api/works/work_1/pages/page_1/image",
      imageWidth: 1_200,
      imageHeight: 1_800,
      recognitionStatus: "succeeded",
      objects: [
        {
          id: "grand_now",
          type: "chord",
          bbox: { x: 100, y: 180, width: 36, height: 42 },
          staff: "grand",
          measure: 1,
          notes: ["E4", "G4"],
          confidence: 0.94,
          source: "model",
        },
        {
          id: "bass_now",
          type: "note",
          bbox: { x: 102, y: 360, width: 32, height: 40 },
          staff: "bass",
          measure: 1,
          notes: ["C3"],
          confidence: 0.91,
          source: "model",
        },
      ],
    } as PracticePage;

    expect(
      getPracticeSelectionEvent({
        pages: [imagePage],
        pageIndex: 0,
        objectId: "grand_now",
      }),
    ).toMatchObject({
      primaryObjectId: "grand_now",
      objectIds: ["grand_now", "bass_now"],
      notes: ["E4", "G4", "C3"],
    });
  });

  it("moves across pages to the next complete onset event", () => {
    const crossPageEvents = [
      {
        ...pages[0],
        objects: [
          {
            ...pages[0].objects[0],
            id: "page_one_last",
            onset: 8,
          },
        ],
      },
      {
        ...pages[1],
        objects: [
          {
            ...pages[1].objects[0],
            id: "page_two_treble",
            measure: 3,
            onset: 0,
            notes: ["A5"],
          },
          {
            ...pages[1].objects[0],
            id: "page_two_bass",
            staff: "bass",
            measure: 3,
            onset: 0,
            notes: ["A2"],
          },
        ],
      },
    ];

    expect(
      getNextPracticeEvent({
        pages: crossPageEvents,
        currentPageIndex: 0,
        selectedObjectId: "page_one_last",
      }),
    ).toMatchObject({
      pageIndex: 1,
      primaryObjectId: "page_two_treble",
      objectIds: ["page_two_treble", "page_two_bass"],
      notes: ["A5", "A2"],
    });
  });
});
