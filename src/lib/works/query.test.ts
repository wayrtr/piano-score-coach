import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDatabase, getSqlite, resetTestDatabase } from "@/lib/db/client";
import {
  practiceStates,
  scoreObjects,
  workPages,
  works,
} from "@/lib/db/schema";
import { getWorkListItem, listWorks } from "@/lib/works/query";

describe("listWorks", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "piano-query-"));
    resetTestDatabase(root);
    process.env.PIANO_COACH_STORAGE_DIR = root;
  });

  afterEach(() => {
    resetTestDatabase(root);
    fs.rmSync(root, { recursive: true, force: true });
    delete process.env.PIANO_COACH_STORAGE_DIR;
  });

  function insertWork(id: string, overrides: Partial<typeof works.$inferInsert> = {}) {
    getDatabase().insert(works).values({
      id,
      title: id,
      sourceType: "musicxml",
      pageCount: 0,
      createdAt: "2026-07-14T08:00:00.000Z",
      updatedAt: "2026-07-14T08:00:00.000Z",
      currentKey: "C major",
      status: "ready",
      ...overrides,
    }).run();
  }

  function insertPage(workId: string, pageIndex: number) {
    const id = `${workId}_page_${pageIndex}`;
    getDatabase().insert(workPages).values({
      id,
      workId,
      pageIndex,
      imagePath: `/pages/${id}.png`,
      sourceFileRef: "score.musicxml",
      recognitionStatus: "succeeded",
    }).run();
    return id;
  }

  it("returns an empty list and null for unknown work ids", () => {
    expect(listWorks()).toEqual([]);
    expect(getWorkListItem("missing")).toBeNull();
    expect(getWorkListItem("")).toBeNull();

    insertWork("existing");
    expect(getWorkListItem("missing")).toBeNull();
    expect(getWorkListItem("")).toBeNull();
  });

  it("preserves every source/status combination and keeps single-item results identical", () => {
    const expectedStatuses = new Map<string, string>();

    for (const sourceType of ["musicxml", "pdf", "images"]) {
      for (const status of ["draft", "processing", "ready", "failed"]) {
        for (const hasObjects of [false, true]) {
          const id = `${sourceType}_${status}_${hasObjects}`;
          insertWork(id, { sourceType, status, pageCount: 2 });
          // The first page is deliberately empty. Objects on any later page
          // must still make an otherwise ready MusicXML import playable.
          insertPage(id, 0);
          const secondPageId = insertPage(id, 1);

          if (hasObjects) {
            getDatabase().insert(scoreObjects).values({
              id: `${id}_object`,
              workPageId: secondPageId,
              type: "note",
              bboxJson: '{"x":0,"y":0,"width":1,"height":1}',
              staff: "treble",
              measure: 1,
              notesJson: '["C4"]',
              confidence: 1,
              source: "model",
            }).run();
          }

          expectedStatuses.set(
            id,
            sourceType === "musicxml" && status === "ready" && !hasObjects
              ? "failed"
              : status,
          );
        }
      }
    }

    const items = listWorks();
    expect(items).toHaveLength(expectedStatuses.size);
    for (const item of items) {
      expect(item).toEqual({
        id: item.id,
        title: item.id,
        sourceType: item.id.split("_")[0],
        pageCount: 2,
        status: expectedStatuses.get(item.id),
        lastPracticedAt: null,
        lastPageIndex: null,
        lastObjectId: null,
        lastMeasure: null,
        instrumentMode: null,
        pages: [0, 1].map((pageIndex) => ({
          id: `${item.id}_page_${pageIndex}`,
          pageIndex,
          recognitionStatus: "succeeded",
        })),
      });
      expect(getWorkListItem(item.id)).toEqual(item);
    }
    const firstFailed = items.findIndex((item) => item.status === "failed");
    expect(items.slice(firstFailed).every((item) => item.status === "failed")).toBe(true);
  });

  it("groups interleaved pages in page order and retains nullish resume fallbacks", () => {
    insertWork("work_a", {
      sourceType: "pdf",
      pageCount: 3,
      lastPositionPageIndex: 2,
      lastPositionObjectId: "legacy_object",
      lastPositionMeasure: 12,
    });
    insertWork("work_b", { sourceType: "images", pageCount: 2 });
    insertPage("work_a", 2);
    insertPage("work_b", 0);
    insertPage("work_a", 0);
    insertPage("work_b", 1);
    insertPage("work_a", 1);
    getDatabase().insert(practiceStates).values({
      id: "practice_a",
      workId: "work_a",
      lastPageIndex: 0,
      lastObjectId: null,
      lastMeasure: 0,
      instrumentMode: "guitar",
      updatedAt: "2026-07-14T08:00:00.000Z",
    }).run();

    expect(getWorkListItem("work_a")).toMatchObject({
      lastPageIndex: 0,
      lastObjectId: "legacy_object",
      lastMeasure: 0,
      instrumentMode: "guitar",
      pages: [0, 1, 2].map((pageIndex) => ({ id: `work_a_page_${pageIndex}`, pageIndex })),
    });
    expect(getWorkListItem("work_b")).toMatchObject({
      lastPageIndex: null,
      lastObjectId: null,
      lastMeasure: null,
      instrumentMode: null,
      pages: [0, 1].map((pageIndex) => ({ id: `work_b_page_${pageIndex}`, pageIndex })),
    });
    for (const item of listWorks()) {
      expect(getWorkListItem(item.id)).toEqual(item);
    }
  });

  it("keeps targeted lookups scoped to one work in every query", () => {
    insertWork("requested");
    insertWork("unrelated");
    insertPage("requested", 0);
    insertPage("unrelated", 0);
    const prepare = vi.spyOn(getSqlite(), "prepare");

    try {
      expect(getWorkListItem("requested")?.id).toBe("requested");
      const queries = prepare.mock.calls.map(([query]) => query);
      expect(queries).toHaveLength(3);
      expect(queries[0]).toContain('where "works"."id" = ?');
      expect(queries[1]).toContain('where "work_pages"."work_id" = ?');
      expect(queries[2]).toContain('where "practice_states"."work_id" = ?');
      expect(queries[0]).toContain("exists (");
      const queryPlan = getSqlite()
        .prepare(`EXPLAIN QUERY PLAN ${queries[0]}`)
        .all("requested") as Array<{ detail: string }>;
      expect(queryPlan.some((step) => step.detail.includes("idx_work_pages_work_page"))).toBe(true);
      expect(queryPlan.some((step) => step.detail.includes("idx_score_objects_work_page"))).toBe(true);
    } finally {
      prepare.mockRestore();
    }
  });

  it("lists a library beyond SQLite's page-id parameter limit", () => {
    const pageCount = 32_767;
    insertWork("large_work", { pageCount });
    getSqlite().prepare(`
      WITH RECURSIVE pages(n) AS (
        SELECT 0 UNION ALL SELECT n + 1 FROM pages WHERE n < ?
      )
      INSERT INTO work_pages (id, work_id, page_index, image_path, source_file_ref)
      SELECT 'page_' || n, 'large_work', n, '/page.png', 'score.musicxml' FROM pages
    `).run(pageCount - 1);

    const [item] = listWorks();
    expect(item?.pages).toHaveLength(pageCount);
    expect(item?.pages[0]?.pageIndex).toBe(0);
    expect(item?.pages.at(-1)?.pageIndex).toBe(pageCount - 1);
    expect(item?.status).toBe("failed");
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
