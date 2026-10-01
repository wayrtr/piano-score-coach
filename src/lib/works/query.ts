import { asc, desc, eq, exists } from "drizzle-orm";

import { getDatabase } from "@/lib/db/client";
import {
  practiceStates,
  recognitionResults,
  scoreObjects,
  workPages,
  works,
} from "@/lib/db/schema";
import {
  compareWorkListOrder,
  deriveEffectiveWorkStatus,
} from "@/lib/works/status";

export type WorkPageListItem = {
  id: string;
  pageIndex: number;
  recognitionStatus: string;
};

export type WorkListItem = {
  id: string;
  title: string;
  sourceType: string;
  pageCount: number;
  status: string;
  lastPracticedAt: string | null;
  /** The last place and instrument used in the practice workspace. */
  lastPageIndex: number | null;
  lastObjectId: string | null;
  lastMeasure: number | null;
  instrumentMode: string | null;
  pages: WorkPageListItem[];
};

function loadWorkListItems(workId?: string): WorkListItem[] {
  const db = getDatabase();
  const workRows = db
    .select({
      id: works.id,
      title: works.title,
      sourceType: works.sourceType,
      pageCount: works.pageCount,
      status: works.status,
      lastPracticedAt: works.lastPracticedAt,
      lastPositionPageIndex: works.lastPositionPageIndex,
      lastPositionObjectId: works.lastPositionObjectId,
      lastPositionMeasure: works.lastPositionMeasure,
      updatedAt: works.updatedAt,
      // Effective status only needs to distinguish an empty score from a
      // playable one. EXISTS stops at the first object instead of loading or
      // counting every note in the library.
      hasScoreObjects: exists(
        db
          .select({ id: scoreObjects.id })
          .from(workPages)
          .innerJoin(scoreObjects, eq(scoreObjects.workPageId, workPages.id))
          .where(eq(workPages.workId, works.id)),
      ).mapWith(Number),
    })
    .from(works)
    .where(workId === undefined ? undefined : eq(works.id, workId))
    .orderBy(desc(works.updatedAt))
    .all();

  if (workRows.length === 0) {
    return [];
  }

  const pageRows = db
    .select({
      id: workPages.id,
      workId: workPages.workId,
      pageIndex: workPages.pageIndex,
      recognitionStatus: workPages.recognitionStatus,
    })
    .from(workPages)
    .where(workId === undefined ? undefined : eq(workPages.workId, workId))
    .orderBy(asc(workPages.pageIndex))
    .all();
  const practiceRows = db
    .select({
      workId: practiceStates.workId,
      lastPageIndex: practiceStates.lastPageIndex,
      lastObjectId: practiceStates.lastObjectId,
      lastMeasure: practiceStates.lastMeasure,
      instrumentMode: practiceStates.instrumentMode,
    })
    .from(practiceStates)
    .where(
      workId === undefined ? undefined : eq(practiceStates.workId, workId),
    )
    .all();
  const practiceByWorkId = new Map(
    practiceRows.map((practiceState) => [practiceState.workId, practiceState]),
  );
  const pagesByWorkId = new Map<string, WorkPageListItem[]>();

  for (const page of pageRows) {
    const pages = pagesByWorkId.get(page.workId) ?? [];
    pages.push({
      id: page.id,
      pageIndex: page.pageIndex,
      recognitionStatus: page.recognitionStatus,
    });
    pagesByWorkId.set(page.workId, pages);
  }

  return workRows
    .map((work) => {
      const practiceState = practiceByWorkId.get(work.id);

      return {
        id: work.id,
        title: work.title,
        sourceType: work.sourceType,
        pageCount: work.pageCount,
        status: deriveEffectiveWorkStatus({
          sourceType: work.sourceType,
          status: work.status,
          totalObjectCount: work.hasScoreObjects,
        }),
        lastPracticedAt: work.lastPracticedAt,
        lastPageIndex:
          practiceState?.lastPageIndex ?? work.lastPositionPageIndex ?? null,
        lastObjectId:
          practiceState?.lastObjectId ?? work.lastPositionObjectId ?? null,
        lastMeasure:
          practiceState?.lastMeasure ?? work.lastPositionMeasure ?? null,
        instrumentMode: practiceState?.instrumentMode ?? null,
        updatedAt: work.updatedAt,
        pages: pagesByWorkId.get(work.id) ?? [],
      };
    })
    .sort(compareWorkListOrder)
    .map((work) => ({
      id: work.id,
      title: work.title,
      sourceType: work.sourceType,
      pageCount: work.pageCount,
      status: work.status,
      lastPracticedAt: work.lastPracticedAt,
      lastPageIndex: work.lastPageIndex,
      lastObjectId: work.lastObjectId,
      lastMeasure: work.lastMeasure,
      instrumentMode: work.instrumentMode,
      pages: work.pages,
    }));
}

export function listWorks(): WorkListItem[] {
  return loadWorkListItems();
}

export function getWorkListItem(workId: string) {
  return loadWorkListItems(workId)[0] ?? null;
}

export function getWorkDetail(workId: string) {
  const db = getDatabase();
  const work = db.select().from(works).where(eq(works.id, workId)).get();

  if (!work) {
    return null;
  }

  return {
    ...work,
    pages: db
      .select()
      .from(workPages)
      .where(eq(workPages.workId, workId))
      .orderBy(asc(workPages.pageIndex))
      .all(),
    practiceState:
      db
        .select()
        .from(practiceStates)
        .where(eq(practiceStates.workId, workId))
        .get() ?? null,
    recognitionResults: db
      .select()
      .from(recognitionResults)
      .innerJoin(workPages, eq(recognitionResults.workPageId, workPages.id))
      .where(eq(workPages.workId, workId))
      .all(),
    scoreObjects: db
      .select()
      .from(scoreObjects)
      .innerJoin(workPages, eq(scoreObjects.workPageId, workPages.id))
      .where(eq(workPages.workId, workId))
      .all(),
  };
}
