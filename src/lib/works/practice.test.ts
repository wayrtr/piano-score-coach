import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { vi } from "vitest";

import { getDatabase, resetTestDatabase } from "@/lib/db/client";
import {
  practiceStates,
  recognitionResults,
  scoreObjects,
  workPages,
  works,
} from "@/lib/db/schema";
import { RECOGNITION_SCHEMA_VERSION } from "@/lib/recognition/schema-v0";
import {
  getPracticeWorkDetail,
  rerunPracticeObject,
  rerunPracticePage,
  selectResumeTarget,
  updateWorkKey,
  updatePracticeState,
} from "@/lib/works/practice";

describe("practice work selectors and mutations", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "piano-practice-"));
    resetTestDatabase(root);

    const db = getDatabase({ root, environment: "test" });

    db.insert(works).values({
      id: "work_1",
      title: "Moon River",
      sourceType: "pdf",
      pageCount: 3,
      createdAt: "2026-03-23T10:00:00.000Z",
      updatedAt: "2026-03-23T10:00:00.000Z",
      lastPracticedAt: null,
      currentKey: "C major",
      manualKeyOverride: false,
      lastPositionPageIndex: 0,
      lastPositionObjectId: "obj_1",
      lastPositionMeasure: 3,
      status: "ready",
    }).run();

    const pageOneImagePath = path.join(root, "works", "work_1", "pages", "page-0001.png");
    const pageTwoImagePath = path.join(root, "works", "work_1", "pages", "page-0002.png");
    const pageThreeImagePath = path.join(root, "works", "work_1", "pages", "page-0003.png");
    fs.mkdirSync(path.dirname(pageOneImagePath), { recursive: true });
    fs.writeFileSync(pageOneImagePath, createPngBuffer(1000, 1400));
    fs.writeFileSync(pageTwoImagePath, createPngBuffer(900, 1300));
    fs.writeFileSync(pageThreeImagePath, createPngBuffer(880, 1280));

    db.insert(workPages).values({
      id: "page_1",
      workId: "work_1",
      pageIndex: 0,
      imagePath: pageOneImagePath,
      sourceFileRef: "source/moon-river.pdf#page=1",
      recognitionStatus: "succeeded",
      recognizedAt: "2026-03-23T10:01:00.000Z",
    }).run();

    db.insert(workPages).values({
      id: "page_2",
      workId: "work_1",
      pageIndex: 1,
      imagePath: pageTwoImagePath,
      sourceFileRef: "source/moon-river.pdf#page=2",
      recognitionStatus: "succeeded",
      recognizedAt: "2026-03-23T10:02:00.000Z",
    }).run();

    db.insert(workPages).values({
      id: "page_3",
      workId: "work_1",
      pageIndex: 2,
      imagePath: pageThreeImagePath,
      sourceFileRef: "source/moon-river.pdf#page=3",
      recognitionStatus: "failed",
      recognizedAt: null,
    }).run();

    db.insert(recognitionResults).values({
      id: "rec_1",
      workPageId: "page_1",
      modelName: "gpt-5.4",
      version: RECOGNITION_SCHEMA_VERSION,
      rawResponse: JSON.stringify({ ok: true }),
      normalizedData: JSON.stringify({
        version: RECOGNITION_SCHEMA_VERSION,
        pageNumber: 1,
        sourceWidth: 1000,
        sourceHeight: 1400,
        keyCandidate: "C major",
        timeSignatureCandidate: "4/4",
        objects: [],
      }),
      confidenceMin: 0.42,
      confidenceMax: 0.96,
      confidenceAverage: 0.8,
    }).run();

    db.insert(recognitionResults).values({
      id: "rec_2",
      workPageId: "page_2",
      modelName: "gpt-5.4",
      version: RECOGNITION_SCHEMA_VERSION,
      rawResponse: JSON.stringify({ ok: true }),
      normalizedData: JSON.stringify({
        version: RECOGNITION_SCHEMA_VERSION,
        pageNumber: 2,
        sourceWidth: 900,
        sourceHeight: 1300,
        keyCandidate: "C major",
        timeSignatureCandidate: "4/4",
        objects: [],
      }),
      confidenceMin: 0.51,
      confidenceMax: 0.89,
      confidenceAverage: 0.74,
    }).run();

    db.insert(recognitionResults).values({
      id: "rec_3",
      workPageId: "page_3",
      modelName: "unknown",
      version: RECOGNITION_SCHEMA_VERSION,
      rawResponse: JSON.stringify({ ok: false }),
      normalizedData: JSON.stringify({
        errorMessage: "Schema validation failed.",
      }),
      confidenceMin: 0,
      confidenceMax: 0,
      confidenceAverage: 0,
    }).run();

    db.insert(scoreObjects).values({
      id: "obj_1",
      workPageId: "page_1",
      type: "note",
      bboxJson: JSON.stringify({
        x: 120,
        y: 200,
        width: 42,
        height: 30,
      }),
      staff: "treble",
      measure: 3,
      notesJson: JSON.stringify(["E4"]),
      confidence: 0.91,
      source: "model",
    }).run();

    db.insert(scoreObjects).values({
      id: "obj_1_chord",
      workPageId: "page_1",
      type: "chord",
      bboxJson: JSON.stringify({
        x: 220,
        y: 260,
        width: 64,
        height: 48,
      }),
      staff: "grand",
      measure: 3,
      notesJson: JSON.stringify(["C4", "E4", "G4"]),
      confidence: 0.78,
      source: "model",
    }).run();

    db.insert(scoreObjects).values({
      id: "obj_2",
      workPageId: "page_2",
      type: "note",
      bboxJson: JSON.stringify({
        x: 140,
        y: 180,
        width: 38,
        height: 30,
      }),
      staff: "bass",
      measure: 7,
      notesJson: JSON.stringify(["A3"]),
      confidence: 0.88,
      source: "model",
    }).run();

    db.insert(practiceStates).values({
      id: "state_1",
      workId: "work_1",
      lastPageIndex: 0,
      lastObjectId: "obj_1",
      lastMeasure: 3,
      instrumentMode: "guitar",
      guitarViewMode: "all_positions",
      updatedAt: "2026-03-23T10:05:00.000Z",
    }).run();
  });

  it("builds a page-centric practice detail with parsed objects", () => {
    const detail = getPracticeWorkDetail("work_1", {
      root,
      environment: "test",
    });

    expect(detail).not.toBeNull();
    expect(detail?.pages).toHaveLength(3);
    expect(detail?.pages[0]?.objects[0]).toMatchObject({
      id: "obj_1",
      notes: ["E4"],
      bbox: {
        x: 120,
        y: 200,
        width: 42,
        height: 30,
      },
    });
    expect(detail?.practiceState).toEqual({
      lastPageIndex: 0,
      lastObjectId: "obj_1",
      lastMeasure: 3,
      instrumentMode: "guitar",
      guitarViewMode: "all_positions",
    });
  });

  it("persists manual key overrides at the work level", () => {
    updateWorkKey(
      {
        workId: "work_1",
        nextKey: "A minor",
      },
      {
        root,
        environment: "test",
      },
    );

    const detail = getPracticeWorkDetail("work_1", {
      root,
      environment: "test",
    });

    expect(detail?.currentKey).toBe("A minor");
    expect(detail?.manualKeyOverride).toBe(true);
  });

  it("returns measure-scoped MusicXML pages for structured practice navigation", () => {
    const db = getDatabase({ root, environment: "test" });

    db.insert(works).values({
      id: "work_musicxml",
      title: "Structured Piece",
      sourceType: "musicxml",
      pageCount: 2,
      createdAt: "2026-03-24T09:00:00.000Z",
      updatedAt: "2026-03-24T09:00:00.000Z",
      lastPracticedAt: null,
      currentKey: "E major",
      manualKeyOverride: false,
      lastPositionPageIndex: 0,
      lastPositionObjectId: "mxo-m0001-s1-v1-o0001",
      lastPositionMeasure: 1,
      status: "ready",
    }).run();

    db.insert(workPages).values([
      {
        id: "mx_page_1",
        workId: "work_musicxml",
        pageIndex: 0,
        imagePath: path.join(root, "works", "work_musicxml", "derived", "piece.musicxml"),
        sourceFileRef: "piece.musicxml",
        recognitionStatus: "succeeded",
        recognizedAt: "2026-03-24T09:01:00.000Z",
      },
      {
        id: "mx_page_2",
        workId: "work_musicxml",
        pageIndex: 1,
        imagePath: path.join(root, "works", "work_musicxml", "derived", "piece.musicxml"),
        sourceFileRef: "piece.musicxml",
        recognitionStatus: "succeeded",
        recognizedAt: "2026-03-24T09:01:30.000Z",
      },
    ]).run();

    db.insert(recognitionResults).values([
      {
        id: "mx_rec_1",
        workPageId: "mx_page_1",
        modelName: "musicxml-import",
        version: "musicxml-v1",
        rawResponse: JSON.stringify({ sourceFile: "piece.musicxml" }),
        normalizedData: JSON.stringify({
          sourceType: "musicxml",
          keyCandidate: "E major",
          objectCount: 1,
          pageCount: 2,
          measureStart: 1,
          measureEnd: 8,
        }),
        confidenceMin: 1,
        confidenceMax: 1,
        confidenceAverage: 1,
      },
      {
        id: "mx_rec_2",
        workPageId: "mx_page_2",
        modelName: "musicxml-import",
        version: "musicxml-v1",
        rawResponse: JSON.stringify({ sourceFile: "piece.musicxml" }),
        normalizedData: JSON.stringify({
          sourceType: "musicxml",
          keyCandidate: "E major",
          objectCount: 1,
          pageCount: 2,
          measureStart: 9,
          measureEnd: 16,
        }),
        confidenceMin: 1,
        confidenceMax: 1,
        confidenceAverage: 1,
      },
    ]).run();

    db.insert(scoreObjects).values([
      {
        id: "mxo-m0001-s1-v1-o0001",
        workPageId: "mx_page_1",
        type: "note",
        bboxJson: JSON.stringify({
          x: 0,
          y: 0,
          width: 1,
          height: 1,
        }),
        staff: "treble",
        measure: 1,
        notesJson: JSON.stringify(["E4"]),
        confidence: 1,
        source: "model",
      },
      {
        id: "mxo-m0009-s1-v1-o0001",
        workPageId: "mx_page_2",
        type: "note",
        bboxJson: JSON.stringify({
          x: 0,
          y: 0,
          width: 1,
          height: 1,
        }),
        staff: "treble",
        measure: 9,
        notesJson: JSON.stringify(["F#4"]),
        confidence: 1,
        source: "model",
      },
    ]).run();

    db.insert(practiceStates).values({
      id: "mx_state_1",
      workId: "work_musicxml",
      lastPageIndex: 0,
      lastObjectId: "mxo-m0001-s1-v1-o0001",
      lastMeasure: 1,
      instrumentMode: "piano",
      guitarViewMode: "recommended",
      updatedAt: "2026-03-24T09:02:00.000Z",
    }).run();

    const detail = getPracticeWorkDetail("work_musicxml", {
      root,
      environment: "test",
    });

    expect(detail?.pages[0]).toMatchObject({
      renderMode: "musicxml",
      measureStart: 1,
      measureEnd: 8,
    });
    expect(detail?.pages[1]).toMatchObject({
      renderMode: "musicxml",
      measureStart: 9,
      measureEnd: 16,
    });
  });

  it("downgrades stale MusicXML imports without stored objects to failed status", () => {
    const db = getDatabase({ root, environment: "test" });

    db.insert(works).values({
      id: "work_musicxml_empty",
      title: "Broken Structured Piece",
      sourceType: "musicxml",
      pageCount: 1,
      createdAt: "2026-03-24T09:00:00.000Z",
      updatedAt: "2026-03-24T09:30:00.000Z",
      lastPracticedAt: "2026-03-24T09:30:00.000Z",
      currentKey: "E major",
      manualKeyOverride: false,
      lastPositionPageIndex: 0,
      lastPositionObjectId: null,
      lastPositionMeasure: null,
      status: "ready",
    }).run();

    db.insert(workPages).values({
      id: "mx_page_empty_1",
      workId: "work_musicxml_empty",
      pageIndex: 0,
      imagePath: path.join(root, "works", "work_musicxml_empty", "derived", "piece.musicxml"),
      sourceFileRef: "piece.musicxml",
      recognitionStatus: "succeeded",
      recognizedAt: "2026-03-24T09:01:00.000Z",
    }).run();

    db.insert(recognitionResults).values({
      id: "mx_rec_empty_1",
      workPageId: "mx_page_empty_1",
      modelName: "musicxml-import",
      version: "musicxml-v1",
      rawResponse: JSON.stringify({ sourceFile: "piece.musicxml" }),
      normalizedData: JSON.stringify({
        sourceType: "musicxml",
        keyCandidate: "E major",
        objectCount: 0,
        pageCount: 1,
        measureStart: 1,
        measureEnd: 8,
      }),
      confidenceMin: 1,
      confidenceMax: 1,
      confidenceAverage: 1,
    }).run();

    const detail = getPracticeWorkDetail("work_musicxml_empty", {
      root,
      environment: "test",
    });

    expect(detail?.status).toBe("failed");
    expect(detail?.pages[0]?.objects).toEqual([]);
  });

  it("blocks MusicXML object reruns from falling back into image recognition", async () => {
    const db = getDatabase({ root, environment: "test" });
    const musicXmlPath = path.join(root, "works", "work_musicxml_rerun", "derived", "piece.musicxml");
    fs.mkdirSync(path.dirname(musicXmlPath), { recursive: true });
    fs.writeFileSync(musicXmlPath, "<score-partwise />");

    db.insert(works).values({
      id: "work_musicxml_rerun",
      title: "Structured Piece",
      sourceType: "musicxml",
      pageCount: 1,
      createdAt: "2026-03-24T09:00:00.000Z",
      updatedAt: "2026-03-24T09:00:00.000Z",
      lastPracticedAt: null,
      currentKey: "E major",
      manualKeyOverride: false,
      lastPositionPageIndex: 0,
      lastPositionObjectId: "mxo-m0001-s1-v1-o0001",
      lastPositionMeasure: 1,
      status: "ready",
    }).run();

    db.insert(workPages).values({
      id: "mx_page_rerun_1",
      workId: "work_musicxml_rerun",
      pageIndex: 0,
      imagePath: musicXmlPath,
      sourceFileRef: "piece.musicxml",
      recognitionStatus: "succeeded",
      recognizedAt: "2026-03-24T09:01:00.000Z",
    }).run();

    db.insert(recognitionResults).values({
      id: "mx_rec_rerun_1",
      workPageId: "mx_page_rerun_1",
      modelName: "musicxml-import",
      version: "musicxml-v1",
      rawResponse: JSON.stringify({ sourceFile: "piece.musicxml" }),
      normalizedData: JSON.stringify({
        sourceType: "musicxml",
        keyCandidate: "E major",
        objectCount: 1,
        pageCount: 1,
        measureStart: 1,
        measureEnd: 8,
      }),
      confidenceMin: 1,
      confidenceMax: 1,
      confidenceAverage: 1,
    }).run();

    db.insert(scoreObjects).values({
      id: "mxo-m0001-s1-v1-o0001",
      workPageId: "mx_page_rerun_1",
      type: "note",
      bboxJson: JSON.stringify({
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      }),
      staff: "treble",
      measure: 1,
      notesJson: JSON.stringify(["E4"]),
      confidence: 1,
      source: "model",
    }).run();

    const outcome = await rerunPracticeObject(
      {
        workId: "work_musicxml_rerun",
        objectId: "mxo-m0001-s1-v1-o0001",
      },
      {
        root,
        environment: "test",
      },
    );

    expect(outcome?.result).toMatchObject({
      recognitionStatus: "failed",
      errorMessage: "MusicXML 对象直接走本地结构化解析，不支持视觉局部重识别。",
    });
  });

  it("requeues the whole scanned score because Audiveris works across pages", async () => {
    const enqueuePageRecognition = vi.fn().mockResolvedValue(undefined);

    await rerunPracticePage(
      {
        workId: "work_1",
        pageId: "page_3",
      },
      {
        root,
        environment: "test",
        enqueuePageRecognition,
      },
    );

    const detail = getPracticeWorkDetail("work_1", {
      root,
      environment: "test",
    });

    expect(enqueuePageRecognition).toHaveBeenCalledTimes(1);
    expect(detail?.pages.map((page) => page.recognitionStatus)).toEqual([
      "queued",
      "queued",
      "queued",
    ]);
  });

  it("blocks the retired cloud object rerun for scanned scores", async () => {
    const outcome = await rerunPracticeObject(
      {
        workId: "work_1",
        objectId: "obj_1",
      },
      {
        root,
        environment: "test",
      },
    );

    const detail = getPracticeWorkDetail("work_1", {
      root,
      environment: "test",
    });
    const updatedObject = detail?.pages[0]?.objects.find((object) => object.id === "obj_1");
    const untouchedObject = detail?.pages[0]?.objects.find(
      (object) => object.id === "obj_1_chord",
    );

    expect(outcome?.result).toMatchObject({
      recognitionStatus: "failed",
      errorMessage: "局部视觉识别已停用。本地 Audiveris 会按整份谱面重新识别。",
    });
    expect(updatedObject?.notes).toEqual(["E4"]);
    expect(updatedObject?.source).toBe("model");
    expect(untouchedObject?.notes).toEqual(["C4", "E4", "G4"]);
  });

  it("stores and reloads the last practice position", () => {
    updatePracticeState(
      {
        workId: "work_1",
        lastPageIndex: 1,
        lastObjectId: "obj_2",
        lastMeasure: 7,
        instrumentMode: "guitar",
        guitarViewMode: "all_positions",
      },
      {
        root,
        environment: "test",
      },
    );

    const detail = getPracticeWorkDetail("work_1", {
      root,
      environment: "test",
    });

    expect(selectResumeTarget(detail!)).toEqual({
      pageIndex: 1,
      objectId: "obj_2",
      measure: 7,
    });
    expect(detail?.practiceState).toMatchObject({
      instrumentMode: "guitar",
      guitarViewMode: "all_positions",
    });
  });

  it("keeps the newest position when an older save arrives after it", () => {
    const options = { root, environment: "test" as const };
    const latest = {
      workId: "work_1",
      lastPageIndex: 1,
      lastObjectId: "obj_2",
      lastMeasure: 7,
      instrumentMode: "piano" as const,
      guitarViewMode: "recommended" as const,
      observedAt: "2026-03-23T11:00:00.001Z",
    };

    updatePracticeState(latest, options);
    const detail = updatePracticeState({
      ...latest,
      lastPageIndex: 0,
      lastObjectId: "obj_1",
      lastMeasure: 3,
      instrumentMode: "guitar",
      observedAt: "2026-03-23T11:00:00.000Z",
    }, options);

    expect(selectResumeTarget(detail!)).toEqual({ pageIndex: 1, objectId: "obj_2", measure: 7 });
    expect(detail?.practiceState?.instrumentMode).toBe("piano");
    const db = getDatabase(options);
    expect(db.select().from(practiceStates).get()).toMatchObject({
      lastObjectId: "obj_2",
      updatedAt: latest.observedAt,
    });
    expect(db.select().from(works).get()).toMatchObject({
      lastPositionObjectId: "obj_2",
      lastPositionPageIndex: 1,
      lastPositionMeasure: 7,
      lastPracticedAt: latest.observedAt,
    });
  });
});

function createPngBuffer(width: number, height: number) {
  const pngHeader = Buffer.from(
    "89504e470d0a1a0a0000000d49484452",
    "hex",
  );
  const dimensions = Buffer.alloc(8);

  dimensions.writeUInt32BE(width, 0);
  dimensions.writeUInt32BE(height, 4);

  return Buffer.concat([
    pngHeader,
    dimensions,
    Buffer.from("0802000000", "hex"),
  ]);
}
