import { asc, desc, eq, inArray } from "drizzle-orm";

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

export function listWorks(): WorkListItem[] {
  const db = getDatabase();
  const workRows = db.select().from(works).orderBy(desc(works.updatedAt)).all();

  if (workRows.length === 0) {
    return [];
  }

  const pageRows = db
    .select()
    .from(workPages)
    .where(
      inArray(
        workPages.workId,
        workRows.map((work) => work.id),
      ),
    )
    .orderBy(asc(workPages.pageIndex))
    .all();
  const pageIds = pageRows.map((page) => page.id);
  const pageToWorkId = new Map(pageRows.map((page) => [page.id, page.workId]));
  const practiceRows = db
    .select()
    .from(practiceStates)
    .where(
      inArray(
        practiceStates.workId,
        workRows.map((work) => work.id),
      ),
    )
    .all();
  const practiceByWorkId = new Map(
    practiceRows.map((practiceState) => [practiceState.workId, practiceState]),
  );
  const objectRows =
    pageIds.length > 0
      ? db
          .select({
            workPageId: scoreObjects.workPageId,
          })
          .from(scoreObjects)
          .where(inArray(scoreObjects.workPageId, pageIds))
          .all()
      : [];
  const objectCountByWorkId = new Map<string, number>();

  for (const row of objectRows) {
    const workId = pageToWorkId.get(row.workPageId);

    if (!workId) {
      continue;
    }

    objectCountByWorkId.set(workId, (objectCountByWorkId.get(workId) ?? 0) + 1);
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
          totalObjectCount: objectCountByWorkId.get(work.id) ?? 0,
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
        pages: pageRows
          .filter((page) => page.workId === work.id)
          .map((page) => ({
            id: page.id,
            pageIndex: page.pageIndex,
            recognitionStatus: page.recognitionStatus,
          })),
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

export function getWorkListItem(workId: string) {
  return listWorks().find((work) => work.id === workId) ?? null;
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
