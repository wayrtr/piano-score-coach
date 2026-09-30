import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { asc, eq, inArray } from "drizzle-orm";

import { getDatabase, getDatabasePaths } from "@/lib/db/client";
import {
  practiceStates,
  recognitionResults,
  scoreObjects,
  workPages,
  works,
} from "@/lib/db/schema";
import {
  createPracticeStateRecord,
  createRecognitionResultRecord,
  createWorkPageRecord,
  createWorkRecord,
  type SourceType,
  type RecognitionStatus,
  type WorkStatus,
} from "@/lib/domain/types";
import { createMusicXmlImportArtifacts } from "@/lib/musicxml/import";
import { scopeMusicXmlObjectId } from "@/lib/musicxml/shared";
import {
  AUDIVERIS_ADAPTER_VERSION,
  recognizeScoreWithAudiveris,
} from "@/lib/recognition/audiveris";
import { createNormalizedScorePdf } from "@/lib/recognition/omr-input";
import { enqueueRecognitionTask } from "@/lib/recognition/queue";
import {
  ensureWorkStoragePaths,
  removeWorkStoragePaths,
} from "@/lib/storage/filesystem";
import { getWorkListItem } from "@/lib/works/query";

export async function createImportedWork(input: {
  title?: string | null;
  sourceType: SourceType;
  files: Array<{
    fileName: string;
    buffer: Buffer;
  }>;
}) {
  const db = getDatabase();
  const { storageRoot } = getDatabasePaths();
  const workId = randomUUID();
  try {
    const workPaths = ensureWorkStoragePaths(storageRoot, workId);
    const storedSourceFiles = input.files.map((file, index) => {
      const safeName = `${String(index + 1).padStart(4, "0")}-${sanitizeFileName(
        file.fileName,
      )}`;
      const storedPath = path.join(workPaths.sourceRoot, safeName);

      fs.writeFileSync(storedPath, file.buffer);

      return {
        buffer: file.buffer,
        fileName: safeName,
        storedPath,
      };
    });

    if (input.sourceType === "musicxml") {
      return await createImportedMusicXmlWork({
        workId,
        input,
        storedSourceFiles,
        workPaths,
      });
    }

    const { normalizeSourceInputsIntoWorkPages } = await import(
      "@/lib/normalize/page-image"
    );
    const normalizedPages = await normalizeSourceInputsIntoWorkPages({
      storageRoot,
      workId,
      sourceType: input.sourceType,
      files: storedSourceFiles.map((file) => ({
        buffer: file.buffer,
        fileName: file.fileName,
      })),
    });

    const workRecord = createWorkRecord({
      id: workId,
      title:
        input.title?.trim() ||
        deriveWorkTitle(storedSourceFiles[0].fileName),
      sourceType: input.sourceType,
      pageCount: normalizedPages.length,
      currentKey: "C major",
      status: "processing",
    });

    db.insert(works).values({
      id: workRecord.id,
      title: workRecord.title,
      sourceType: workRecord.sourceType,
      pageCount: workRecord.pageCount,
      createdAt: workRecord.createdAt,
      updatedAt: workRecord.updatedAt,
      lastPracticedAt: workRecord.lastPracticedAt,
      currentKey: workRecord.currentKey,
      manualKeyOverride: workRecord.manualKeyOverride,
      lastPositionPageIndex: workRecord.lastPosition?.pageIndex ?? null,
      lastPositionObjectId: workRecord.lastPosition?.objectId ?? null,
      lastPositionMeasure: workRecord.lastPosition?.measure ?? null,
      status: workRecord.status,
    }).run();

    const pageRecords = normalizedPages.map((page) =>
      createWorkPageRecord({
        id: randomUUID(),
        workId,
        pageIndex: page.pageIndex,
        imagePath: page.imagePath,
        sourceFileRef: page.sourceFileRef,
        recognitionStatus: "queued",
      }),
    );

    db.insert(workPages).values(
      pageRecords.map((page) => ({
        id: page.id,
        workId: page.workId,
        pageIndex: page.pageIndex,
        imagePath: page.imagePath,
        sourceFileRef: page.sourceFileRef,
        recognitionStatus: page.recognitionStatus,
        recognizedAt: page.recognizedAt,
      })),
    ).run();

    const practiceState = createPracticeStateRecord({
      id: randomUUID(),
      workId,
      lastPageIndex: 0,
      lastObjectId: null,
      lastMeasure: null,
      instrumentMode: "piano",
      guitarViewMode: "recommended",
    });

    db.insert(practiceStates).values({
      id: practiceState.id,
      workId: practiceState.workId,
      lastPageIndex: practiceState.lastPageIndex,
      lastObjectId: practiceState.lastObjectId,
      lastMeasure: practiceState.lastMeasure,
      instrumentMode: practiceState.instrumentMode,
      guitarViewMode: practiceState.guitarViewMode,
      updatedAt: practiceState.updatedAt,
    }).run();

    const work = await getWorkListItem(workId);

    queueRecognitionForWork({
      workId,
      pages: pageRecords.map((page) => ({
        id: page.id,
        imagePath: page.imagePath,
        pageIndex: page.pageIndex,
      })),
    });

    return {
      work,
      pageRecords,
    };
  } catch (error) {
    try {
      db.delete(works).where(eq(works.id, workId)).run();
    } finally {
      removeWorkStoragePaths(storageRoot, workId);
    }
    throw error;
  }
}

async function createImportedMusicXmlWork(input: {
  workId: string;
  input: {
    title?: string | null;
    sourceType: SourceType;
    files: Array<{
      fileName: string;
      buffer: Buffer;
    }>;
  };
  storedSourceFiles: Array<{
    buffer: Buffer;
    fileName: string;
    storedPath: string;
  }>;
  workPaths: ReturnType<typeof ensureWorkStoragePaths>;
}) {
  if (input.storedSourceFiles.length !== 1) {
    throw new Error("MusicXML import expects exactly one source file.");
  }

  const db = getDatabase();
  const extracted = createMusicXmlImportArtifacts({
    buffer: input.storedSourceFiles[0].buffer,
    fileName: input.storedSourceFiles[0].fileName,
  });
  const recognizedAt = new Date().toISOString();
  const annotatedFileName = sanitizeFileName(
    `${deriveWorkTitle(extracted.extracted.fileName)}.annotated.musicxml`,
  );
  const annotatedPath = path.join(input.workPaths.derivedRoot, annotatedFileName);

  fs.writeFileSync(annotatedPath, extracted.parsed.annotatedXmlText);

  const parsedPages =
    extracted.parsed.pages.length > 0
      ? extracted.parsed.pages
      : [
          {
            pageIndex: 0,
            measureStart: extracted.parsed.objects[0]?.measure ?? 0,
            measureEnd:
              extracted.parsed.objects[extracted.parsed.objects.length - 1]?.measure ?? 0,
            objects: extracted.parsed.objects,
          },
        ];

  const workRecord = createWorkRecord({
    id: input.workId,
    title:
      input.input.title?.trim() ||
      extracted.parsed.title ||
      deriveWorkTitle(extracted.extracted.fileName),
    sourceType: "musicxml",
    pageCount: extracted.parsed.pageCount,
    currentKey: extracted.parsed.currentKey,
    status: "ready",
  });

  db.insert(works).values({
    id: workRecord.id,
    title: workRecord.title,
    sourceType: workRecord.sourceType,
    pageCount: workRecord.pageCount,
    createdAt: workRecord.createdAt,
    updatedAt: workRecord.updatedAt,
    lastPracticedAt: workRecord.lastPracticedAt,
    currentKey: workRecord.currentKey,
    manualKeyOverride: workRecord.manualKeyOverride,
    lastPositionPageIndex: workRecord.lastPosition?.pageIndex ?? null,
    lastPositionObjectId: workRecord.lastPosition?.objectId ?? null,
    lastPositionMeasure: workRecord.lastPosition?.measure ?? null,
    status: workRecord.status,
  }).run();

  const pageRecords = parsedPages.map((page) =>
    createWorkPageRecord({
      id: randomUUID(),
      workId: input.workId,
      pageIndex: page.pageIndex,
      imagePath: annotatedPath,
      sourceFileRef: extracted.extracted.fileName,
      recognitionStatus: "succeeded",
      recognizedAt,
    }),
  );

  db.insert(workPages).values(
    pageRecords.map((pageRecord) => ({
      id: pageRecord.id,
      workId: pageRecord.workId,
      pageIndex: pageRecord.pageIndex,
      imagePath: pageRecord.imagePath,
      sourceFileRef: pageRecord.sourceFileRef,
      recognitionStatus: pageRecord.recognitionStatus,
      recognizedAt: pageRecord.recognizedAt,
    })),
  ).run();

  const recognitionPayloads = parsedPages.map((page, index) =>
    createRecognitionResultRecord({
      id: randomUUID(),
      workPageId: pageRecords[index].id,
      modelName: "musicxml-import",
      version: "musicxml-v1",
      rawResponse: {
        sourceFile: extracted.extracted.fileName,
      },
      normalizedData: {
        sourceType: "musicxml",
        keyCandidate: extracted.parsed.currentKey,
        objectCount: page.objects.length,
        pageCount: extracted.parsed.pageCount,
        measureStart: page.measureStart,
        measureEnd: page.measureEnd,
      },
      confidenceSummary: {
        min: 1,
        max: 1,
        average: 1,
      },
    }),
  );

  db.insert(recognitionResults).values(
    recognitionPayloads.map((recognitionResult) => ({
      id: recognitionResult.id,
      workPageId: recognitionResult.workPageId,
      modelName: recognitionResult.modelName,
      version: recognitionResult.version,
      rawResponse: JSON.stringify(recognitionResult.rawResponse),
      normalizedData: JSON.stringify(recognitionResult.normalizedData),
      confidenceMin: recognitionResult.confidenceSummary.min,
      confidenceMax: recognitionResult.confidenceSummary.max,
      confidenceAverage: recognitionResult.confidenceSummary.average,
    })),
  ).run();

  const scoreObjectValues = parsedPages.flatMap((page, index) =>
    page.objects.map((object) => ({
      id: scopeMusicXmlObjectId(pageRecords[index].id, object.id),
      workPageId: pageRecords[index].id,
      type: object.type,
      bboxJson: JSON.stringify(object.bbox),
      staff: object.staff,
      measure: object.measure,
      onset: object.onset,
      notesJson: JSON.stringify(object.notes),
      confidence: object.confidence,
      source: object.source,
    })),
  );

  if (scoreObjectValues.length > 0) {
    db.insert(scoreObjects).values(scoreObjectValues).run();
  }

  const practiceState = createPracticeStateRecord({
    id: randomUUID(),
    workId: input.workId,
    lastPageIndex: 0,
    lastObjectId:
      parsedPages[0]?.objects[0]
        ? scopeMusicXmlObjectId(pageRecords[0].id, parsedPages[0].objects[0].id)
        : null,
    lastMeasure: parsedPages[0]?.objects[0]?.measure ?? null,
    instrumentMode: "piano",
    guitarViewMode: "recommended",
  });

  db.insert(practiceStates).values({
    id: practiceState.id,
    workId: practiceState.workId,
    lastPageIndex: practiceState.lastPageIndex,
    lastObjectId: practiceState.lastObjectId,
    lastMeasure: practiceState.lastMeasure,
    instrumentMode: practiceState.instrumentMode,
    guitarViewMode: practiceState.guitarViewMode,
    updatedAt: practiceState.updatedAt,
  }).run();

  return {
    work: await getWorkListItem(input.workId),
    pageRecords,
  };
}

export async function enqueueWorkPageRecognition(input: {
  workId: string;
  pageId: string;
}) {
  const db = getDatabase();
  const work = db.select().from(works).where(eq(works.id, input.workId)).get();
  const page = db.select().from(workPages).where(eq(workPages.id, input.pageId)).get();

  if (!work || !page || page.workId !== input.workId) {
    return false;
  }

  if (work.sourceType === "musicxml") {
    return false;
  }

  await queueRecognitionForWork({
    workId: input.workId,
    pages: db
      .select()
      .from(workPages)
      .where(eq(workPages.workId, input.workId))
      .orderBy(asc(workPages.pageIndex))
      .all()
      .map((workPage) => ({
        id: workPage.id,
        imagePath: workPage.imagePath,
        pageIndex: workPage.pageIndex,
      })),
  });

  return true;
}

async function queueRecognitionForWork(input: {
  workId: string;
  pages: Array<{
    id: string;
    imagePath: string;
    pageIndex: number;
  }>;
}) {
  void enqueueRecognitionTask({
    jobId: `omr:${input.workId}`,
    workId: input.workId,
    task: async () => {
      await setWorkRecognitionStatus(
        input.pages.map((page) => page.id),
        "recognizing",
      );

      try {
        const result = await runWorkOmrJob(input);

        if (result.recognitionStatus === "succeeded") {
          persistWorkOmrSuccess({
            workId: input.workId,
            pages: input.pages,
            result,
          });
        } else {
          persistWorkOmrFailure({
            workId: input.workId,
            pageIds: input.pages.map((page) => page.id),
            rawResponse: result.rawResponse,
            errorMessage: result.errorMessage,
          });
        }
      } catch (error) {
        persistWorkOmrFailure({
          workId: input.workId,
          pageIds: input.pages.map((page) => page.id),
          rawResponse: null,
          errorMessage:
            error instanceof Error ? error.message : "本地 Audiveris 识别失败。",
        });
      } finally {
        await refreshWorkStatus(input.workId);
      }
    },
  }).catch((error) => {
    console.error("local OMR queue task failed", error);
  });
}

async function setWorkRecognitionStatus(
  pageIds: string[],
  recognitionStatus: RecognitionStatus,
) {
  if (pageIds.length === 0) {
    return;
  }

  const db = getDatabase();

  db.update(workPages).set({
    recognitionStatus,
  }).where(inArray(workPages.id, pageIds)).run();
}

type WorkOmrJobResult =
  | {
      recognitionStatus: "succeeded";
      annotatedMusicXmlPath: string;
      rawMusicXmlPath: string;
      parsed: ReturnType<typeof createMusicXmlImportArtifacts>["parsed"];
      rawResponse: unknown;
    }
  | {
      recognitionStatus: "failed";
      errorMessage: string;
      rawResponse: unknown;
    };

async function runWorkOmrJob(input: {
  workId: string;
  pages: Array<{
    id: string;
    imagePath: string;
    pageIndex: number;
  }>;
}): Promise<WorkOmrJobResult> {
  let temporaryRoot: string | null = null;
  let rawResponse: unknown = null;

  try {
    const { storageRoot } = getDatabasePaths();
    const workPaths = ensureWorkStoragePaths(storageRoot, input.workId);
    temporaryRoot = fs.mkdtempSync(path.join(workPaths.derivedRoot, ".audiveris-"));
    const outputRoot = path.join(temporaryRoot, "output");
    const orderedPages = input.pages.toSorted(
      (left, right) => left.pageIndex - right.pageIndex,
    );
    const inputPdfPath = await createNormalizedScorePdf({
      pageImagePaths: orderedPages.map((page) => page.imagePath),
      outputPath: path.join(temporaryRoot, "normalized-score.pdf"),
    });
    const audiverisResult = await recognizeScoreWithAudiveris({
      inputPath: inputPdfPath,
      outputRoot,
    });
    rawResponse = {
      stdout: audiverisResult.stdout,
      stderr: audiverisResult.stderr,
    };
    const musicXmlBuffer = fs.readFileSync(audiverisResult.musicXmlPath);
    const artifacts = createMusicXmlImportArtifacts({
      buffer: musicXmlBuffer,
      fileName: path.basename(audiverisResult.musicXmlPath),
    });

    if (artifacts.parsed.pages.length !== orderedPages.length) {
      throw new Error(
        `Audiveris 输出了 ${artifacts.parsed.pages.length} 页，但原谱有 ${orderedPages.length} 页。已保留原图，本次不会猜测页面对应关系。`,
      );
    }

    if (artifacts.parsed.objects.length === 0) {
      throw new Error("Audiveris 没有识别出可用的音符，原谱仍已保留。");
    }

    const artifactId = randomUUID();
    const rawExtension = path.extname(audiverisResult.musicXmlPath) || ".mxl";
    const rawMusicXmlPath = path.join(
      workPaths.derivedRoot,
      `audiveris-${artifactId}${rawExtension}`,
    );
    const annotatedMusicXmlPath = path.join(
      workPaths.derivedRoot,
      `audiveris-${artifactId}.annotated.musicxml`,
    );

    fs.copyFileSync(audiverisResult.musicXmlPath, rawMusicXmlPath);
    fs.writeFileSync(annotatedMusicXmlPath, artifacts.parsed.annotatedXmlText);

    return {
      recognitionStatus: "succeeded",
      annotatedMusicXmlPath,
      rawMusicXmlPath,
      parsed: artifacts.parsed,
      rawResponse,
    };
  } catch (error) {
    return {
      recognitionStatus: "failed",
      errorMessage:
        error instanceof Error ? error.message : "本地 Audiveris 识别失败。",
      rawResponse,
    };
  } finally {
    if (temporaryRoot) {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }
}

function persistWorkOmrSuccess(input: {
  workId: string;
  pages: Array<{
    id: string;
    imagePath: string;
    pageIndex: number;
  }>;
  result: Extract<WorkOmrJobResult, { recognitionStatus: "succeeded" }>;
}) {
  const db = getDatabase();
  const work = db.select().from(works).where(eq(works.id, input.workId)).get();

  if (!work) {
    return;
  }

  const orderedPages = input.pages.toSorted(
    (left, right) => left.pageIndex - right.pageIndex,
  );
  const pageIds = orderedPages.map((page) => page.id);
  const recognizedAt = new Date().toISOString();

  db.transaction((transaction) => {
    transaction
      .delete(recognitionResults)
      .where(inArray(recognitionResults.workPageId, pageIds))
      .run();
    transaction
      .delete(scoreObjects)
      .where(inArray(scoreObjects.workPageId, pageIds))
      .run();

    for (let index = 0; index < orderedPages.length; index += 1) {
      const page = orderedPages[index];
      const parsedPage = input.result.parsed.pages[index];
      const recognitionResult = createRecognitionResultRecord({
        id: randomUUID(),
        workPageId: page.id,
        modelName: "audiveris",
        version: AUDIVERIS_ADAPTER_VERSION,
        rawResponse: {
          ...asRecord(input.result.rawResponse),
          rawMusicXmlPath: input.result.rawMusicXmlPath,
        },
        normalizedData: {
          sourceType: "omr-musicxml",
          keyCandidate: input.result.parsed.currentKey,
          objectCount: parsedPage.objects.length,
          pageCount: input.result.parsed.pageCount,
          measureStart: parsedPage.measureStart,
          measureEnd: parsedPage.measureEnd,
        },
        confidenceSummary: {
          min: 1,
          max: 1,
          average: 1,
        },
      });

      transaction.insert(recognitionResults).values({
        id: recognitionResult.id,
        workPageId: recognitionResult.workPageId,
        modelName: recognitionResult.modelName,
        version: recognitionResult.version,
        rawResponse: JSON.stringify(recognitionResult.rawResponse),
        normalizedData: JSON.stringify(recognitionResult.normalizedData),
        confidenceMin: recognitionResult.confidenceSummary.min,
        confidenceMax: recognitionResult.confidenceSummary.max,
        confidenceAverage: recognitionResult.confidenceSummary.average,
      }).run();

      if (parsedPage.objects.length > 0) {
        transaction.insert(scoreObjects).values(
          parsedPage.objects.map((object) => ({
            id: scopeMusicXmlObjectId(page.id, object.id),
            workPageId: page.id,
            type: object.type,
            bboxJson: JSON.stringify(object.bbox),
            staff: object.staff,
            measure: object.measure,
            onset: object.onset,
            notesJson: JSON.stringify(object.notes),
            confidence: object.confidence,
            source: object.source,
          })),
        ).run();
      }

      transaction.update(workPages).set({
        musicXmlPath: input.result.annotatedMusicXmlPath,
        recognitionStatus: "succeeded",
        recognizedAt,
      }).where(eq(workPages.id, page.id)).run();
    }

    transaction.update(works).set({
      currentKey: work.manualKeyOverride
        ? work.currentKey
        : input.result.parsed.currentKey,
      updatedAt: recognizedAt,
    }).where(eq(works.id, input.workId)).run();
  });
}

function persistWorkOmrFailure(input: {
  workId: string;
  pageIds: string[];
  rawResponse: unknown;
  errorMessage: string;
}) {
  if (input.pageIds.length === 0) {
    return;
  }

  const db = getDatabase();
  const updatedAt = new Date().toISOString();
  const work = db.select().from(works).where(eq(works.id, input.workId)).get();
  const pageRows = db
    .select()
    .from(workPages)
    .where(inArray(workPages.id, input.pageIds))
    .all();

  if (!work || pageRows.length === 0) {
    return;
  }

  const hasLastGoodResult = pageRows.some(
    (page) =>
      page.recognizedAt !== null ||
      Boolean(page.musicXmlPath && fs.existsSync(page.musicXmlPath)),
  );

  if (hasLastGoodResult) {
    db.transaction((transaction) => {
      for (const page of pageRows) {
        const hasUsableMusicXml = Boolean(
          page.musicXmlPath && fs.existsSync(page.musicXmlPath),
        );

        transaction.update(workPages).set({
          recognitionStatus:
            page.recognizedAt !== null || hasUsableMusicXml ? "succeeded" : "failed",
        }).where(eq(workPages.id, page.id)).run();
      }

      transaction.update(works).set({
        updatedAt,
      }).where(eq(works.id, input.workId)).run();
    });
    return;
  }

  db.transaction((transaction) => {
    transaction
      .delete(recognitionResults)
      .where(inArray(recognitionResults.workPageId, input.pageIds))
      .run();
    transaction
      .delete(scoreObjects)
      .where(inArray(scoreObjects.workPageId, input.pageIds))
      .run();
    transaction.insert(recognitionResults).values(
      input.pageIds.map((pageId) => ({
        id: randomUUID(),
        workPageId: pageId,
        modelName: "audiveris",
        version: AUDIVERIS_ADAPTER_VERSION,
        rawResponse: JSON.stringify(input.rawResponse),
        normalizedData: JSON.stringify({
          errorMessage: input.errorMessage,
        }),
        confidenceMin: 0,
        confidenceMax: 0,
        confidenceAverage: 0,
      })),
    ).run();
    transaction.update(workPages).set({
      recognitionStatus: "failed",
      recognizedAt: null,
    }).where(inArray(workPages.id, input.pageIds)).run();
    transaction.update(works).set({
      updatedAt,
    }).where(eq(works.id, input.workId)).run();
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function refreshWorkStatus(workId: string) {
  const db = getDatabase();
  const pageRows = db.select().from(workPages).where(eq(workPages.workId, workId)).all();
  const nextStatus = deriveWorkStatus(pageRows.map((page) => page.recognitionStatus));

  db.update(works).set({
    status: nextStatus,
    updatedAt: new Date().toISOString(),
  }).where(eq(works.id, workId)).run();
}

function deriveWorkStatus(statuses: string[]): WorkStatus {
  if (
    statuses.some((status) =>
      status === "queued" || status === "normalizing" || status === "recognizing",
    )
  ) {
    return "processing";
  }

  if (statuses.some((status) => status === "failed")) {
    return "failed";
  }

  return "ready";
}

function deriveWorkTitle(fileName: string) {
  return path.basename(fileName, path.extname(fileName)).replace(/^\d+-/, "");
}

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}
