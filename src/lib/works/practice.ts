import fs from "node:fs";

import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { z } from "zod";

import type { DatabasePathsOptions } from "@/lib/db/client";
import { getDatabase, getDatabasePaths } from "@/lib/db/client";
import {
  practiceStates,
  recognitionResults,
  scoreObjects,
  workPages,
  works,
} from "@/lib/db/schema";
import { cancelQueuedRecognitionTasksForWork } from "@/lib/recognition/queue";
import {
  guitarViewModeSchema,
  instrumentModeSchema,
  bboxSchema,
  recognitionStatusSchema,
  scoreObjectSourceSchema,
  scoreObjectTypeSchema,
  sourceTypeSchema,
  workStatusSchema,
} from "@/lib/domain/types";
import { getTheoryForKey, normalizeWorkKey } from "@/lib/music/theory";
import { parseMusicXmlDocument } from "@/lib/musicxml/parser";
import { scopeMusicXmlObjectId } from "@/lib/musicxml/shared";
import { comparePracticeScoreObjects } from "@/lib/practice/navigation";
import type { PracticePage, PracticeScoreObject, PracticeWork } from "@/lib/practice/types";
import {
  recognitionPageSchema,
  type RecognitionPage,
} from "@/lib/recognition/schema-v0";
import { removeWorkStoragePaths } from "@/lib/storage/filesystem";
import { enqueueWorkPageRecognition } from "@/lib/works/service";
import { deriveEffectiveWorkStatus } from "@/lib/works/status";

const failureRecognitionPayloadSchema = z.object({
  errorMessage: z.string(),
});

const musicXmlRecognitionPayloadSchema = z.object({
  sourceType: z.enum(["musicxml", "omr-musicxml"]),
  keyCandidate: z.string().min(1),
  objectCount: z.number().int().nonnegative(),
  pageCount: z.number().int().positive(),
  measureStart: z.number().int().nonnegative(),
  measureEnd: z.number().int().nonnegative(),
});

export type PracticeRecognitionSnapshot = {
  modelName: string;
  version: string;
  keyCandidate: string | null;
  timeSignatureCandidate: string | null;
  confidenceSummary: {
    min: number;
    max: number;
    average: number;
  };
  errorMessage: string | null;
};

export type PracticePageDetail = PracticePage & {
  recognizedAt: string | null;
  sourceFileRef: string;
  recognition: PracticeRecognitionSnapshot | null;
};

export type PracticeWorkDetail = Omit<PracticeWork, "pages"> & {
  pages: PracticePageDetail[];
};

export function getPracticeWorkDetail(
  workId: string,
  options: DatabasePathsOptions = {},
) {
  const db = getDatabase(options);
  const work = db.select().from(works).where(eq(works.id, workId)).get();

  if (!work) {
    return null;
  }

  const pageRows = db
    .select()
    .from(workPages)
    .where(eq(workPages.workId, workId))
    .orderBy(asc(workPages.pageIndex))
    .all();
  const practiceState =
    db
      .select()
      .from(practiceStates)
      .where(eq(practiceStates.workId, workId))
      .get() ?? null;

  const pageIds = pageRows.map((page) => page.id);
  const recognitionRows =
    pageIds.length > 0
      ? db
          .select()
          .from(recognitionResults)
          .where(inArray(recognitionResults.workPageId, pageIds))
          .all()
      : [];
  let objectRows =
    pageIds.length > 0
      ? db
          .select()
          .from(scoreObjects)
          .where(inArray(scoreObjects.workPageId, pageIds))
          .all()
      : [];
  if (work.sourceType === "musicxml") {
    objectRows = hydrateLegacyMusicXmlOnsets(pageRows, objectRows, options);
  }
  const status = workStatusSchema.parse(
    deriveEffectiveWorkStatus({
      sourceType: work.sourceType,
      status: work.status,
      totalObjectCount: objectRows.length,
    }),
  );

  const recognitionByPageId = new Map(
    recognitionRows.map((row) => [row.workPageId, parseStoredRecognitionResult(row)]),
  );
  const objectsByPageId = new Map<string, PracticeScoreObject[]>();

  for (const row of objectRows) {
    const parsedObject = parseStoredScoreObject(row);
    const existing = objectsByPageId.get(row.workPageId) ?? [];
    existing.push(parsedObject);
    objectsByPageId.set(row.workPageId, existing);
  }

  const pages = pageRows.map((page) => {
    const parsedRecognition = recognitionByPageId.get(page.id) ?? null;
    const sortedObjects = (objectsByPageId.get(page.id) ?? []).toSorted(
      comparePracticeScoreObjects,
    );

    if (work.sourceType === "musicxml") {
      return {
        id: page.id,
        pageIndex: page.pageIndex,
        renderMode: "musicxml",
        musicXmlSrc: getPracticeMusicXmlSrc(workId),
        measureStart:
          parsedRecognition?.musicXmlPage?.measureStart ??
          sortedObjects[0]?.measure ??
          0,
        measureEnd:
          parsedRecognition?.musicXmlPage?.measureEnd ??
          sortedObjects[sortedObjects.length - 1]?.measure ??
          0,
        recognitionStatus: recognitionStatusSchema.parse(page.recognitionStatus),
        recognizedAt: page.recognizedAt,
        sourceFileRef: page.sourceFileRef,
        recognition: parsedRecognition?.snapshot ?? null,
        objects: sortedObjects,
      } satisfies PracticePageDetail;
    }

    if (
      page.recognitionStatus === "succeeded" &&
      page.musicXmlPath &&
      fs.existsSync(page.musicXmlPath)
    ) {
      return {
        id: page.id,
        pageIndex: page.pageIndex,
        renderMode: "musicxml",
        musicXmlSrc: getPracticePageMusicXmlSrc(workId, page.id),
        fallbackImageSrc: getPracticePageImageSrc(workId, page.id),
        measureStart:
          parsedRecognition?.musicXmlPage?.measureStart ??
          sortedObjects[0]?.measure ??
          0,
        measureEnd:
          parsedRecognition?.musicXmlPage?.measureEnd ??
          sortedObjects[sortedObjects.length - 1]?.measure ??
          0,
        recognitionStatus: recognitionStatusSchema.parse(page.recognitionStatus),
        recognizedAt: page.recognizedAt,
        sourceFileRef: page.sourceFileRef,
        recognition: parsedRecognition?.snapshot ?? null,
        objects: sortedObjects,
      } satisfies PracticePageDetail;
    }

    const parsedSize = parsedRecognition?.page
      ? {
          width: parsedRecognition.page.sourceWidth,
          height: parsedRecognition.page.sourceHeight,
        }
      : readPngDimensions(page.imagePath);

    return {
      id: page.id,
      pageIndex: page.pageIndex,
      renderMode: "image",
      imageSrc: getPracticePageImageSrc(workId, page.id),
      imageWidth: parsedSize.width,
      imageHeight: parsedSize.height,
      recognitionStatus: recognitionStatusSchema.parse(page.recognitionStatus),
      recognizedAt: page.recognizedAt,
      sourceFileRef: page.sourceFileRef,
      recognition: parsedRecognition?.snapshot ?? null,
      objects: sortedObjects,
    } satisfies PracticePageDetail;
  });

  return {
    id: work.id,
    title: work.title,
    sourceType: sourceTypeSchema.parse(work.sourceType),
    status,
    currentKey: normalizeWorkKey(work.currentKey),
    manualKeyOverride: work.manualKeyOverride,
    pageCount: work.pageCount,
    lastPracticedAt: work.lastPracticedAt,
    practiceState: practiceState
      ? {
          lastPageIndex: practiceState.lastPageIndex,
          lastObjectId: practiceState.lastObjectId,
          lastMeasure: practiceState.lastMeasure,
          instrumentMode: instrumentModeSchema.parse(practiceState.instrumentMode),
          guitarViewMode: guitarViewModeSchema.parse(practiceState.guitarViewMode),
        }
      : null,
    pages,
  } satisfies PracticeWorkDetail;
}

export function updateWorkKey(
  input: {
    workId: string;
    nextKey: string;
  },
  options: DatabasePathsOptions = {},
) {
  const db = getDatabase(options);
  const currentKey = normalizeWorkKey(input.nextKey);

  db.update(works).set({
    currentKey,
    manualKeyOverride: true,
    updatedAt: new Date().toISOString(),
  }).where(eq(works.id, input.workId)).run();

  return getPracticeWorkDetail(input.workId, options);
}

export function updatePracticeState(
  input: {
    workId: string;
    lastPageIndex: number;
    lastObjectId: string | null;
    lastMeasure: number | null;
    instrumentMode: z.infer<typeof instrumentModeSchema>;
    guitarViewMode: z.infer<typeof guitarViewModeSchema>;
    observedAt?: string;
  },
  options: DatabasePathsOptions = {},
) {
  const db = getDatabase(options);
  const timestamp = input.observedAt
    ? new Date(input.observedAt).toISOString()
    : new Date().toISOString();

  db.transaction((transaction) => {
    const saved = transaction.update(practiceStates).set({
      lastPageIndex: input.lastPageIndex,
      lastObjectId: input.lastObjectId,
      lastMeasure: input.lastMeasure,
      instrumentMode: input.instrumentMode,
      guitarViewMode: input.guitarViewMode,
      updatedAt: timestamp,
    }).where(and(
      eq(practiceStates.workId, input.workId),
      input.observedAt ? lte(practiceStates.updatedAt, timestamp) : undefined,
    )).run();

    // A delayed keepalive request must not replace a more recent selection.
    if (input.observedAt && saved.changes === 0) {
      return;
    }

    transaction.update(works).set({
      lastPracticedAt: timestamp,
      lastPositionPageIndex: input.lastPageIndex,
      lastPositionObjectId: input.lastObjectId,
      lastPositionMeasure: input.lastMeasure,
      updatedAt: timestamp,
    }).where(eq(works.id, input.workId)).run();
  });

  return getPracticeWorkDetail(input.workId, options);
}

export function updateScoreObject(
  input: {
    workId: string;
    objectId: string;
    notes: string[];
  },
  options: DatabasePathsOptions = {},
) {
  const db = getDatabase(options);
  const objectRow = db.select().from(scoreObjects).where(eq(scoreObjects.id, input.objectId)).get();

  if (!objectRow) {
    return null;
  }

  const pageRow = db.select().from(workPages).where(eq(workPages.id, objectRow.workPageId)).get();

  if (!pageRow || pageRow.workId !== input.workId) {
    return null;
  }

  db.update(scoreObjects).set({
    notesJson: JSON.stringify(input.notes),
    source: "user",
  }).where(eq(scoreObjects.id, input.objectId)).run();

  db.update(works).set({
    updatedAt: new Date().toISOString(),
  }).where(eq(works.id, input.workId)).run();

  return getPracticeWorkDetail(input.workId, options);
}

export async function rerunPracticeObject(
  input: {
    workId: string;
    objectId: string;
  },
  options: DatabasePathsOptions = {},
) {
  const db = getDatabase(options);
  const objectRow = db.select().from(scoreObjects).where(eq(scoreObjects.id, input.objectId)).get();

  if (!objectRow) {
    return null;
  }

  const pageRow = db.select().from(workPages).where(eq(workPages.id, objectRow.workPageId)).get();

  if (!pageRow || pageRow.workId !== input.workId) {
    return null;
  }

  const workRow = db.select().from(works).where(eq(works.id, input.workId)).get();

  if (!workRow) {
    return null;
  }

  if (workRow.sourceType === "musicxml") {
    return {
      work: getPracticeWorkDetail(input.workId, options),
      result: {
        recognitionStatus: "failed" as const,
        errorMessage: "MusicXML 对象直接走本地结构化解析，不支持视觉局部重识别。",
        rawResponse: null,
      },
    };
  }

  return {
    work: getPracticeWorkDetail(input.workId, options),
    result: {
      recognitionStatus: "failed" as const,
      errorMessage: "局部视觉识别已停用。本地 Audiveris 会按整份谱面重新识别。",
      rawResponse: null,
    },
  };
}

export async function rerunPracticePage(
  input: {
    workId: string;
    pageId: string;
  },
  options: DatabasePathsOptions & {
    enqueuePageRecognition?: typeof enqueueWorkPageRecognition;
  } = {},
) {
  const db = getDatabase(options);
  const pageRow = db.select().from(workPages).where(eq(workPages.id, input.pageId)).get();

  if (!pageRow || pageRow.workId !== input.workId) {
    return null;
  }

  const workRow = db.select().from(works).where(eq(works.id, input.workId)).get();

  if (!workRow) {
    return null;
  }

  if (workRow.sourceType === "musicxml") {
    return getPracticeWorkDetail(input.workId, options);
  }

  db.update(workPages).set({
    recognitionStatus: "queued",
  }).where(eq(workPages.workId, input.workId)).run();

  db.update(works).set({
    status: "processing",
    updatedAt: new Date().toISOString(),
  }).where(eq(works.id, input.workId)).run();

  await (options.enqueuePageRecognition ?? enqueueWorkPageRecognition)({
    workId: input.workId,
    pageId: input.pageId,
  });

  return getPracticeWorkDetail(input.workId, options);
}

export function deleteStoredWork(
  input: {
    workId: string;
  },
  options: DatabasePathsOptions = {},
) {
  const db = getDatabase(options);
  const work = db.select().from(works).where(eq(works.id, input.workId)).get();

  if (!work) {
    return false;
  }

  cancelQueuedRecognitionTasksForWork(input.workId);
  db.delete(works).where(eq(works.id, input.workId)).run();

  const { storageRoot } = getDatabasePaths(options);
  removeWorkStoragePaths(storageRoot, input.workId);

  return true;
}

export function selectResumeTarget(work: PracticeWorkDetail) {
  const fallbackPage = work.pages[0] ?? null;
  const fallbackObject = fallbackPage?.objects[0] ?? null;
  const practiceState = work.practiceState;

  return {
    pageIndex: practiceState?.lastPageIndex ?? fallbackPage?.pageIndex ?? 0,
    objectId: practiceState?.lastObjectId ?? fallbackObject?.id ?? null,
    measure: practiceState?.lastMeasure ?? fallbackObject?.measure ?? null,
  };
}

export function selectLowConfidenceObjects(
  page: PracticePageDetail,
  threshold = 0.6,
) {
  return page.objects.filter((object) => object.confidence < threshold);
}

export function getPracticePageImageSrc(workId: string, pageId: string) {
  return `/api/works/${workId}/pages/${pageId}/image`;
}

export function getPracticeMusicXmlSrc(workId: string) {
  return `/api/works/${workId}/musicxml`;
}

export function getPracticePageMusicXmlSrc(workId: string, pageId: string) {
  return `/api/works/${workId}/pages/${pageId}/musicxml`;
}

export function findPracticeObject(
  work: PracticeWorkDetail,
  objectId: string | null,
) {
  if (!objectId) {
    return null;
  }

  for (const page of work.pages) {
    const match = page.objects.find((object) => object.id === objectId);

    if (match) {
      return match;
    }
  }

  return null;
}

export function getAvailableTheorySummary(key: string) {
  return getTheoryForKey(key);
}

type StoredRecognitionParseResult = {
  snapshot: PracticeRecognitionSnapshot;
  page: RecognitionPage | null;
  musicXmlPage:
    | {
        measureStart: number;
        measureEnd: number;
      }
    | null;
};

function parseStoredRecognitionResult(
  row: typeof recognitionResults.$inferSelect,
): StoredRecognitionParseResult {
  const normalizedData = JSON.parse(row.normalizedData) as unknown;
  const successParse = recognitionPageSchema.safeParse(normalizedData);

  if (successParse.success) {
    return {
      snapshot: {
        modelName: row.modelName,
        version: row.version,
        keyCandidate: successParse.data.keyCandidate,
        timeSignatureCandidate: successParse.data.timeSignatureCandidate,
        confidenceSummary: {
          min: row.confidenceMin,
          max: row.confidenceMax,
          average: row.confidenceAverage,
        },
        errorMessage: null,
      },
      page: successParse.data,
      musicXmlPage: null,
    };
  }

  const failureParse = failureRecognitionPayloadSchema.safeParse(normalizedData);

  if (!failureParse.success) {
    const musicXmlParse = musicXmlRecognitionPayloadSchema.safeParse(normalizedData);

    if (musicXmlParse.success) {
      return {
        snapshot: {
          modelName: row.modelName,
          version: row.version,
          keyCandidate: musicXmlParse.data.keyCandidate,
          timeSignatureCandidate: null,
          confidenceSummary: {
            min: row.confidenceMin,
            max: row.confidenceMax,
            average: row.confidenceAverage,
          },
          errorMessage: null,
        },
        page: null,
        musicXmlPage: {
          measureStart: musicXmlParse.data.measureStart,
          measureEnd: musicXmlParse.data.measureEnd,
        },
      };
    }
  }

  return {
    snapshot: {
      modelName: row.modelName,
      version: row.version,
      keyCandidate: null,
      timeSignatureCandidate: null,
      confidenceSummary: {
        min: row.confidenceMin,
        max: row.confidenceMax,
        average: row.confidenceAverage,
      },
      errorMessage: failureParse.success ? failureParse.data.errorMessage : null,
    },
    page: null,
    musicXmlPage: null,
  };
}

function parseStoredScoreObject(
  row: typeof scoreObjects.$inferSelect,
): PracticeScoreObject {
  return {
    id: row.id,
    type: scoreObjectTypeSchema.parse(row.type),
    bbox: bboxSchema.parse(JSON.parse(row.bboxJson)),
    staff: row.staff,
    measure: row.measure,
    onset: row.onset,
    notes: z.array(z.string().min(1)).parse(JSON.parse(row.notesJson)),
    confidence: row.confidence,
    source: scoreObjectSourceSchema.parse(row.source),
  };
}

function hydrateLegacyMusicXmlOnsets(
  pageRows: Array<typeof workPages.$inferSelect>,
  objectRows: Array<typeof scoreObjects.$inferSelect>,
  options: DatabasePathsOptions,
) {
  if (!objectRows.some((row) => row.onset === null)) {
    return objectRows;
  }

  const sourcePath = pageRows[0]?.imagePath;

  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return objectRows;
  }

  try {
    const parsed = parseMusicXmlDocument(fs.readFileSync(sourcePath, "utf8"));
    const pageByIndex = new Map(pageRows.map((page) => [page.pageIndex, page]));
    const singleLegacyPage = pageRows.length === 1 ? pageRows[0] : null;
    const onsetByObjectId = new Map<string, number | null>();
    const recordOnset = (objectId: string, onset: number) => {
      const existingOnset = onsetByObjectId.get(objectId);

      onsetByObjectId.set(
        objectId,
        existingOnset === undefined || existingOnset === onset ? onset : null,
      );
    };

    for (const parsedPage of parsed.pages) {
      const page = pageByIndex.get(parsedPage.pageIndex) ?? singleLegacyPage;

      if (!page) {
        continue;
      }

      for (const object of parsedPage.objects) {
        for (const objectId of [object.id, ...object.annotatedObjectIds]) {
          recordOnset(objectId, object.onset);
          recordOnset(scopeMusicXmlObjectId(page.id, objectId), object.onset);
        }
      }
    }

    const hydratedRows = objectRows.map((row) => {
      if (row.onset !== null) {
        return row;
      }

      const onset = onsetByObjectId.get(row.id);
      return onset === undefined || onset === null ? row : { ...row, onset };
    });
    const rowsToUpdate = hydratedRows.filter(
      (row, index) => row.onset !== null && objectRows[index]?.onset === null,
    );

    if (rowsToUpdate.length > 0) {
      const db = getDatabase(options);

      db.transaction((transaction) => {
        for (const row of rowsToUpdate) {
          transaction
            .update(scoreObjects)
            .set({ onset: row.onset })
            .where(eq(scoreObjects.id, row.id))
            .run();
        }
      });
    }

    return hydratedRows;
  } catch {
    return objectRows;
  }
}

function readPngDimensions(imagePath: string) {
  const buffer = fs.readFileSync(imagePath);
  const signature = buffer.subarray(12, 16).toString("ascii");

  if (signature !== "IHDR") {
    return {
      width: 0,
      height: 0,
    };
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}
