import fs from "node:fs";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "@/lib/db/schema";
import { ensureDirectory } from "@/lib/storage/filesystem";

export type DatabaseEnvironment = "development" | "test";

export type DatabasePathsOptions = {
  root?: string;
  environment?: DatabaseEnvironment;
};

export type DatabasePaths = {
  storageRoot: string;
  worksRoot: string;
  databaseFile: string;
};

function resolveStorageRoot(root?: string) {
  return root ?? process.env.PIANO_COACH_STORAGE_DIR ?? path.join(process.cwd(), "storage");
}

export function getDatabasePaths({
  root,
  environment = process.env.NODE_ENV === "test" ? "test" : "development",
}: DatabasePathsOptions = {}): DatabasePaths {
  const storageRoot = resolveStorageRoot(root);
  const worksRoot = path.join(storageRoot, "works");
  const databaseFile =
    environment === "test"
      ? path.join(storageRoot, "test", "app.test.db")
      : path.join(storageRoot, "app.db");

  return {
    storageRoot,
    worksRoot,
    databaseFile,
  };
}

export function ensureDatabaseFilesystemLayout(
  options: DatabasePathsOptions = {},
) {
  const paths = getDatabasePaths(options);

  ensureDirectory(paths.storageRoot);
  ensureDirectory(paths.worksRoot);
  ensureDirectory(path.dirname(paths.databaseFile));

  return paths;
}

export function resetTestDatabase(root?: string) {
  const { databaseFile } = getDatabasePaths({ root, environment: "test" });
  fs.rmSync(databaseFile, { force: true });
  databaseInstances.delete(databaseFile);
  sqliteInstances.get(databaseFile)?.close();
  sqliteInstances.delete(databaseFile);
}

const sqliteInstances = new Map<string, BetterSqlite3.Database>();
const databaseInstances = new Map<
  string,
  ReturnType<typeof drizzle<typeof schema>>
>();

export function getSqlite(options: DatabasePathsOptions = {}) {
  const { databaseFile } = ensureDatabaseFilesystemLayout(options);
  const existing = sqliteInstances.get(databaseFile);

  if (existing) {
    return existing;
  }

  const sqlite = new BetterSqlite3(databaseFile);
  initializeDatabaseSchema(sqlite);
  sqliteInstances.set(databaseFile, sqlite);

  return sqlite;
}

export function getDatabase(options: DatabasePathsOptions = {}) {
  const { databaseFile } = ensureDatabaseFilesystemLayout(options);
  const existing = databaseInstances.get(databaseFile);

  if (existing) {
    return existing;
  }

  const sqlite = getSqlite(options);
  const database = drizzle(sqlite, { schema });
  databaseInstances.set(databaseFile, database);

  return database;
}

function initializeDatabaseSchema(sqlite: BetterSqlite3.Database) {
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS works (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      source_type TEXT NOT NULL,
      page_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_practiced_at TEXT,
      current_key TEXT NOT NULL,
      manual_key_override INTEGER NOT NULL DEFAULT 0,
      last_position_page_index INTEGER,
      last_position_object_id TEXT,
      last_position_measure INTEGER,
      status TEXT NOT NULL DEFAULT 'draft'
    );

    CREATE TABLE IF NOT EXISTS work_pages (
      id TEXT PRIMARY KEY,
      work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
      page_index INTEGER NOT NULL,
      image_path TEXT NOT NULL,
      music_xml_path TEXT,
      source_file_ref TEXT NOT NULL,
      recognition_status TEXT NOT NULL DEFAULT 'queued',
      recognized_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_work_pages_work_page
      ON work_pages(work_id, page_index);

    CREATE TABLE IF NOT EXISTS recognition_results (
      id TEXT PRIMARY KEY,
      work_page_id TEXT NOT NULL REFERENCES work_pages(id) ON DELETE CASCADE,
      model_name TEXT NOT NULL,
      version TEXT NOT NULL,
      raw_response TEXT NOT NULL,
      normalized_data TEXT NOT NULL,
      confidence_min REAL NOT NULL,
      confidence_max REAL NOT NULL,
      confidence_average REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS score_objects (
      id TEXT PRIMARY KEY,
      work_page_id TEXT NOT NULL REFERENCES work_pages(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      bbox_json TEXT NOT NULL,
      staff TEXT NOT NULL,
      measure INTEGER NOT NULL,
      onset REAL,
      notes_json TEXT NOT NULL,
      confidence REAL NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS practice_states (
      id TEXT PRIMARY KEY,
      work_id TEXT NOT NULL UNIQUE REFERENCES works(id) ON DELETE CASCADE,
      last_page_index INTEGER NOT NULL DEFAULT 0,
      last_object_id TEXT,
      last_measure INTEGER,
      instrument_mode TEXT NOT NULL DEFAULT 'piano',
      guitar_view_mode TEXT NOT NULL DEFAULT 'recommended',
      updated_at TEXT NOT NULL
    );
  `);

  ensureTableColumn(
    sqlite,
    "work_pages",
    "music_xml_path",
    "ALTER TABLE work_pages ADD COLUMN music_xml_path TEXT",
  );
  ensureTableColumn(
    sqlite,
    "practice_states",
    "instrument_mode",
    "ALTER TABLE practice_states ADD COLUMN instrument_mode TEXT NOT NULL DEFAULT 'piano'",
  );
  ensureTableColumn(
    sqlite,
    "practice_states",
    "guitar_view_mode",
    "ALTER TABLE practice_states ADD COLUMN guitar_view_mode TEXT NOT NULL DEFAULT 'recommended'",
  );
  ensureTableColumn(
    sqlite,
    "score_objects",
    "onset",
    "ALTER TABLE score_objects ADD COLUMN onset REAL",
  );
}

function ensureTableColumn(
  sqlite: BetterSqlite3.Database,
  tableName: string,
  columnName: string,
  alterStatement: string,
) {
  const tableInfo = sqlite
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;

  if (tableInfo.some((column) => column.name === columnName)) {
    return;
  }

  sqlite.exec(alterStatement);
}
