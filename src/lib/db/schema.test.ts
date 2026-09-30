import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";

import {
  createRecognitionResultRecord,
  createPracticeStateRecord,
  createScoreObjectRecord,
  createWorkPageRecord,
  createWorkRecord,
} from "@/lib/domain/types";
import {
  ensureDatabaseFilesystemLayout,
  getSqlite,
  getDatabasePaths,
} from "@/lib/db/client";
import { getWorkStoragePaths } from "@/lib/storage/filesystem";

describe("database filesystem layout", () => {
  it("uses isolated paths for dev and test databases", () => {
    const root = "/tmp/piano-score-coach";

    expect(getDatabasePaths({ root, environment: "development" })).toEqual({
      storageRoot: root,
      worksRoot: path.join(root, "works"),
      databaseFile: path.join(root, "app.db"),
    });

    expect(getDatabasePaths({ root, environment: "test" })).toEqual({
      storageRoot: root,
      worksRoot: path.join(root, "works"),
      databaseFile: path.join(root, "test", "app.test.db"),
    });
  });

  it("creates storage directories for the selected environment", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "piano-score-coach-"));

    const paths = ensureDatabaseFilesystemLayout({
      root,
      environment: "test",
    });

    expect(fs.existsSync(paths.storageRoot)).toBe(true);
    expect(fs.existsSync(paths.worksRoot)).toBe(true);
    expect(fs.existsSync(path.dirname(paths.databaseFile))).toBe(true);
  });

  it("adds the optional onset column to an existing score_objects table", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "piano-score-coach-legacy-"));
    const paths = ensureDatabaseFilesystemLayout({ root, environment: "test" });
    const legacyDatabase = new BetterSqlite3(paths.databaseFile);

    legacyDatabase.exec(`
      CREATE TABLE score_objects (
        id TEXT PRIMARY KEY,
        work_page_id TEXT NOT NULL,
        type TEXT NOT NULL,
        bbox_json TEXT NOT NULL,
        staff TEXT NOT NULL,
        measure INTEGER NOT NULL,
        notes_json TEXT NOT NULL,
        confidence REAL NOT NULL,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    legacyDatabase.close();

    const upgradedDatabase = getSqlite({ root, environment: "test" });
    const columns = upgradedDatabase
      .prepare("PRAGMA table_info(score_objects)")
      .all() as Array<{ name: string }>;

    expect(columns.map((column) => column.name)).toContain("onset");
  });

  it("adds a derived MusicXML path without replacing the original page image", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "piano-score-coach-legacy-"));
    const paths = ensureDatabaseFilesystemLayout({ root, environment: "test" });
    const legacyDatabase = new BetterSqlite3(paths.databaseFile);

    legacyDatabase.exec(`
      CREATE TABLE work_pages (
        id TEXT PRIMARY KEY,
        work_id TEXT NOT NULL,
        page_index INTEGER NOT NULL,
        image_path TEXT NOT NULL,
        source_file_ref TEXT NOT NULL,
        recognition_status TEXT NOT NULL DEFAULT 'queued',
        recognized_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO work_pages (
        id,
        work_id,
        page_index,
        image_path,
        source_file_ref,
        recognition_status
      ) VALUES (
        'legacy_page',
        'legacy_work',
        0,
        '/tmp/original-page.png',
        'source/original.pdf#page=1',
        'succeeded'
      );
    `);
    legacyDatabase.close();

    const upgradedDatabase = getSqlite({ root, environment: "test" });
    const columns = upgradedDatabase
      .prepare("PRAGMA table_info(work_pages)")
      .all() as Array<{ name: string }>;
    const legacyPage = upgradedDatabase
      .prepare(
        "SELECT image_path, music_xml_path, recognition_status FROM work_pages WHERE id = ?",
      )
      .get("legacy_page") as {
        image_path: string;
        music_xml_path: string | null;
        recognition_status: string;
      };

    expect(columns.map((column) => column.name)).toContain("music_xml_path");
    expect(legacyPage).toEqual({
      image_path: "/tmp/original-page.png",
      music_xml_path: null,
      recognition_status: "succeeded",
    });
  });
});

describe("domain record factories", () => {
  it("creates a valid work record", () => {
    const work = createWorkRecord({
      id: "work_1",
      title: "Moon River",
      sourceType: "musicxml",
      pageCount: 4,
      currentKey: "E major",
    });

    expect(work.id).toBe("work_1");
    expect(work.status).toBe("draft");
    expect(work.manualKeyOverride).toBe(false);
    expect(work.sourceType).toBe("musicxml");
  });

  it("creates page, recognition, object, and practice records with aligned ids", () => {
    const page = createWorkPageRecord({
      id: "page_1",
      workId: "work_1",
      pageIndex: 0,
      imagePath: "storage/works/work_1/pages/page-000.png",
      sourceFileRef: "source/input.pdf#page=1",
    });

    const recognition = createRecognitionResultRecord({
      id: "rec_1",
      workPageId: page.id,
      modelName: "gpt-5",
      version: "schema-v0",
      rawResponse: { ok: true },
      normalizedData: { pageNumber: 1 },
      confidenceSummary: { min: 0.52, max: 0.98, average: 0.83 },
    });

    const scoreObject = createScoreObjectRecord({
      id: "obj_1",
      workPageId: page.id,
      type: "note",
      bbox: { x: 10, y: 24, width: 18, height: 20 },
      staff: "treble",
      measure: 3,
      notes: ["E4"],
      confidence: 0.91,
      source: "model",
    });

    const practice = createPracticeStateRecord({
      id: "state_1",
      workId: "work_1",
      lastPageIndex: 0,
      lastObjectId: scoreObject.id,
      lastMeasure: scoreObject.measure,
      instrumentMode: "guitar",
      guitarViewMode: "all_positions",
    });

    expect(page.recognitionStatus).toBe("queued");
    expect(recognition.workPageId).toBe(page.id);
    expect(scoreObject.source).toBe("model");
    expect(practice.lastObjectId).toBe(scoreObject.id);
    expect(practice.instrumentMode).toBe("guitar");
    expect(practice.guitarViewMode).toBe("all_positions");
  });
});

describe("work storage paths", () => {
  it("derives work-specific folders beneath the storage root", () => {
    expect(getWorkStoragePaths("/tmp/piano-score-coach", "work_1")).toEqual({
      workRoot: "/tmp/piano-score-coach/works/work_1",
      sourceRoot: "/tmp/piano-score-coach/works/work_1/source",
      pagesRoot: "/tmp/piano-score-coach/works/work_1/pages",
      derivedRoot: "/tmp/piano-score-coach/works/work_1/derived",
    });
  });
});
