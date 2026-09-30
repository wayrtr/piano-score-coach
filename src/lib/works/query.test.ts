import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDatabase, resetTestDatabase } from "@/lib/db/client";
import {
  practiceStates,
  scoreObjects,
  workPages,
  works,
} from "@/lib/db/schema";
import { listWorks } from "@/lib/works/query";

describe("listWorks", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "piano-query-"));
    resetTestDatabase(root);
    process.env.PIANO_COACH_STORAGE_DIR = root;
  });

  afterEach(() => {
    delete process.env.PIANO_COACH_STORAGE_DIR;
  });

  it("keeps playable MusicXML imports ahead of stale empty imports with the same title", () => {
    const db = getDatabase({ root, environment: "test" });

    db.insert(works).values([
      {
        id: "work_stale",
        title: "突然好想你",
        sourceType: "musicxml",
        pageCount: 1,
        createdAt: "2026-03-27T15:09:04.542Z",
        updatedAt: "2026-03-27T15:46:21.599Z",
        lastPracticedAt: "2026-03-27T15:46:21.599Z",
        currentKey: "D major",
        manualKeyOverride: false,
        lastPositionPageIndex: 0,
        lastPositionObjectId: null,
        lastPositionMeasure: null,
        status: "ready",
      },
      {
        id: "work_playable",
        title: "突然好想你",
        sourceType: "musicxml",
        pageCount: 1,
        createdAt: "2026-03-27T15:36:45.223Z",
        updatedAt: "2026-03-27T15:36:45.223Z",
        lastPracticedAt: null,
        currentKey: "D major",
        manualKeyOverride: false,
        lastPositionPageIndex: 0,
        lastPositionObjectId: "mxo-m0001-s1-v1-o0001",
        lastPositionMeasure: 1,
        status: "ready",
      },
    ]).run();

    db.insert(workPages).values([
      {
        id: "page_stale",
        workId: "work_stale",
        pageIndex: 0,
        imagePath: path.join(root, "works", "work_stale", "derived", "piece.musicxml"),
        sourceFileRef: "piece.musicxml",
        recognitionStatus: "succeeded",
        recognizedAt: "2026-03-27T15:09:04.542Z",
      },
      {
        id: "page_playable",
        workId: "work_playable",
        pageIndex: 0,
        imagePath: path.join(root, "works", "work_playable", "derived", "piece.musicxml"),
        sourceFileRef: "piece.musicxml",
        recognitionStatus: "succeeded",
        recognizedAt: "2026-03-27T15:36:45.223Z",
      },
    ]).run();

    db.insert(scoreObjects).values({
      id: "mxo-m0001-s1-v1-o0001",
      workPageId: "page_playable",
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

    const worksList = listWorks();

    expect(worksList.map((work) => work.id)).toEqual(["work_playable", "work_stale"]);
    expect(worksList[0]?.status).toBe("ready");
    expect(worksList[1]?.status).toBe("failed");
  });

  it("exposes the saved practice position for a resume-first home screen", () => {
    const db = getDatabase({ root, environment: "test" });

    db.insert(works).values({
      id: "work_resume",
      title: "Gymnopédie",
      sourceType: "musicxml",
      pageCount: 3,
      createdAt: "2026-07-14T08:00:00.000Z",
      updatedAt: "2026-07-14T08:30:00.000Z",
      lastPracticedAt: "2026-07-14T08:30:00.000Z",
      currentKey: "G major",
      manualKeyOverride: false,
      lastPositionPageIndex: 1,
      lastPositionObjectId: "object_from_work",
      lastPositionMeasure: 12,
      status: "ready",
    }).run();

    db.insert(practiceStates).values({
      id: "practice_resume",
      workId: "work_resume",
      lastPageIndex: 2,
      lastObjectId: "object_from_practice",
      lastMeasure: 18,
      instrumentMode: "guitar",
      guitarViewMode: "recommended",
      updatedAt: "2026-07-14T08:30:00.000Z",
    }).run();

    const [work] = listWorks();

    expect(work).toMatchObject({
      id: "work_resume",
      lastPageIndex: 2,
      lastObjectId: "object_from_practice",
      lastMeasure: 18,
      instrumentMode: "guitar",
    });
  });
});
