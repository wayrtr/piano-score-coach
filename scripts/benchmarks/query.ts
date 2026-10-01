/**
 * Run from the repository root after installing its locked dependencies:
 *   pnpm exec vitest run --config scripts/benchmarks/vitest.config.ts
 *
 * Requires local Git history containing baseline commit 87b4eb4. The original
 * query source is read with git show into ignored tmp/benchmarks/ at runtime;
 * no maintained copy of the old implementation is needed. Both implementations
 * use the same current runtime and isolated synthetic SQLite database.
 *
 * Reports a median of seven timed runs after one warm-up per operation, checks
 * output equality, and separates index-only gains from the complete change.
 * Timings are descriptive, not CI assertions or end-to-end UI/OMR measurements.
 * JSON is printed and saved to ignored output/benchmarks/query.json.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { getSqlite, resetTestDatabase } from "@/lib/db/client";
import { listWorks, getWorkListItem } from "@/lib/works/query";

import { measureWarmRuns, prepareBaselineModule, writeReport } from "./helpers";

function medianMs(run: () => unknown) {
  return measureWarmRuns(run).medianMs;
}

it("compares original and optimized work queries on deterministic synthetic libraries", async () => {
  const baselineModulePath = prepareBaselineModule("query", "src/lib/works/query.ts");
  const {
    listWorks: beforeListWorks,
    getWorkListItem: beforeGetWorkListItem,
  } = await import(/* @vite-ignore */ baselineModulePath) as typeof import("@/lib/works/query");

  const results: unknown[] = [];
  for (const workCount of [10, 1_000]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "piano-query-bench-"));
    const previousStorageRoot = process.env.PIANO_COACH_STORAGE_DIR;
    process.env.PIANO_COACH_STORAGE_DIR = root;
    try {
      const sqlite = getSqlite();
      const workInsert = sqlite.prepare(`INSERT INTO works
        (id,title,source_type,page_count,created_at,updated_at,last_practiced_at,current_key,
         last_position_page_index,last_position_object_id,last_position_measure,status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
      const pageInsert = sqlite.prepare(`INSERT INTO work_pages
        (id,work_id,page_index,image_path,source_file_ref,recognition_status) VALUES (?,?,?,?,?,?)`);
      const objectInsert = sqlite.prepare(`INSERT INTO score_objects
        (id,work_page_id,type,bbox_json,staff,measure,notes_json,confidence,source)
        VALUES (?,?,?,'{"x":0,"y":0,"width":1,"height":1}','treble',?,'["C4"]',1,'model')`);
      const practiceInsert = sqlite.prepare(`INSERT INTO practice_states
        (id,work_id,last_page_index,last_object_id,last_measure,instrument_mode,updated_at)
        VALUES (?,?,?,?,?,?,?)`);
      let objectCount = 0;
      sqlite.transaction(() => {
        for (let i = 0; i < workCount; i++) {
          const id = `work_${i}`;
          const updated = new Date(Date.UTC(2026, 0, 1, 0, Math.floor(i / 3))).toISOString();
          const source = ["musicxml", "pdf", "images"][i % 3];
          const status = ["ready", "processing", "failed", "draft"][Math.floor(i / 3) % 4];
          workInsert.run(id, `测试 ' title ${i % 19}`, source, 4, updated, updated, i % 2 ? updated : null,
            "C major", i % 4, i % 2 ? `legacy_${i}` : null, i % 9 ? i : null, status);
          if (i % 3 !== 0) practiceInsert.run(`state_${i}`, id, (i + 1) % 4,
            i % 2 ? null : `saved_${i}`, i % 5 ? i + 1 : null, i % 2 ? "guitar" : "piano", updated);
          // Deliberately insert page indexes out of order.
          for (const p of [3, 1, 2, 0]) {
            const pageId = `${id}_page_${p}`;
            pageInsert.run(pageId, id, p, `/pages/${pageId}.png`, "score.musicxml", ["queued", "succeeded", "failed"][i % 3]);
            if (i % 17 === 0) continue;
            for (let n = 0; n < 100; n++) {
              objectInsert.run(`${pageId}_object_${n}`, pageId, n % 7 ? "note" : "chord", n + 1);
              objectCount++;
            }
          }
        }
      })();

      const target = `work_${Math.floor(workCount / 2)}`;
      sqlite.exec("DROP INDEX idx_score_objects_work_page; DROP INDEX idx_recognition_results_work_page;");
      const expected = beforeListWorks();
      const before = {
        listMs: medianMs(beforeListWorks),
        itemMs: medianMs(() => beforeGetWorkListItem(target)),
        missingItemMs: medianMs(() => beforeGetWorkListItem("missing")),
      };
      sqlite.exec(`CREATE INDEX idx_score_objects_work_page ON score_objects(work_page_id);
        CREATE INDEX idx_recognition_results_work_page ON recognition_results(work_page_id);`);
      expect(listWorks()).toEqual(expected);
      expect(getWorkListItem(target)).toEqual(expected.find(work => work.id === target));
      expect(getWorkListItem("missing")).toBeNull();
      // Index-only results distinguish the application-query change from indexing.
      const indexOnly = { listMs: medianMs(beforeListWorks), itemMs: medianMs(() => beforeGetWorkListItem(target)) };
      const after = {
        listMs: medianMs(listWorks),
        itemMs: medianMs(() => getWorkListItem(target)),
        missingItemMs: medianMs(() => getWorkListItem("missing")),
      };
      results.push({ workCount, pageCount: workCount * 4, objectCount, identicalOutput: true, before, indexOnly, after });
    } finally {
      resetTestDatabase(root);
      fs.rmSync(root, { recursive: true, force: true });
      if (previousStorageRoot === undefined) {
        delete process.env.PIANO_COACH_STORAGE_DIR;
      } else {
        process.env.PIANO_COACH_STORAGE_DIR = previousStorageRoot;
      }
    }
  }
  writeReport("query", results);
});
