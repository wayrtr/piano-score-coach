import { z } from "zod";

export const sourceTypeSchema = z.enum(["pdf", "images", "musicxml"]);
export type SourceType = z.infer<typeof sourceTypeSchema>;

export const workStatusSchema = z.enum(["draft", "processing", "ready", "failed"]);
export type WorkStatus = z.infer<typeof workStatusSchema>;

export const recognitionStatusSchema = z.enum([
  "queued",
  "normalizing",
  "recognizing",
  "succeeded",
  "failed",
]);
export type RecognitionStatus = z.infer<typeof recognitionStatusSchema>;

export const scoreObjectTypeSchema = z.enum(["note", "chord", "other"]);
export type ScoreObjectType = z.infer<typeof scoreObjectTypeSchema>;

export const scoreObjectSourceSchema = z.enum(["model", "user", "rerun"]);
export type ScoreObjectSource = z.infer<typeof scoreObjectSourceSchema>;

export const instrumentModeSchema = z.enum(["piano", "guitar"]);
export type InstrumentMode = z.infer<typeof instrumentModeSchema>;

export const guitarViewModeSchema = z.enum(["recommended", "all_positions"]);
export type GuitarViewMode = z.infer<typeof guitarViewModeSchema>;

export const bboxSchema = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  width: z.number().positive(),
  height: z.number().positive(),
});
export type Bbox = z.infer<typeof bboxSchema>;

export const confidenceSummarySchema = z.object({
  min: z.number().min(0).max(1),
  max: z.number().min(0).max(1),
  average: z.number().min(0).max(1),
});
export type ConfidenceSummary = z.infer<typeof confidenceSummarySchema>;

export const workRecordSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  sourceType: sourceTypeSchema,
  pageCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastPracticedAt: z.string().datetime().nullable(),
  currentKey: z.string().min(1),
  manualKeyOverride: z.boolean(),
  lastPosition: z
    .object({
      pageIndex: z.number().int().nonnegative().nullable(),
      objectId: z.string().nullable(),
      measure: z.number().int().nonnegative().nullable(),
    })
    .nullable(),
  status: workStatusSchema,
});
export type WorkRecord = z.infer<typeof workRecordSchema>;

export const workPageRecordSchema = z.object({
  id: z.string().min(1),
  workId: z.string().min(1),
  pageIndex: z.number().int().nonnegative(),
  imagePath: z.string().min(1),
  sourceFileRef: z.string().min(1),
  recognitionStatus: recognitionStatusSchema,
  recognizedAt: z.string().datetime().nullable(),
});
export type WorkPageRecord = z.infer<typeof workPageRecordSchema>;

export const recognitionResultRecordSchema = z.object({
  id: z.string().min(1),
  workPageId: z.string().min(1),
  modelName: z.string().min(1),
  version: z.string().min(1),
  rawResponse: z.unknown(),
  normalizedData: z.unknown(),
  confidenceSummary: confidenceSummarySchema,
});
export type RecognitionResultRecord = z.infer<typeof recognitionResultRecordSchema>;

export const scoreObjectRecordSchema = z.object({
  id: z.string().min(1),
  workPageId: z.string().min(1),
  type: scoreObjectTypeSchema,
  bbox: bboxSchema,
  staff: z.string().min(1),
  measure: z.number().int().nonnegative(),
  onset: z.number().nonnegative().nullable().optional(),
  notes: z.array(z.string().min(1)).min(1),
  confidence: z.number().min(0).max(1),
  source: scoreObjectSourceSchema,
});
export type ScoreObjectRecord = z.infer<typeof scoreObjectRecordSchema>;

export const practiceStateRecordSchema = z.object({
  id: z.string().min(1),
  workId: z.string().min(1),
  lastPageIndex: z.number().int().nonnegative(),
  lastObjectId: z.string().nullable(),
  lastMeasure: z.number().int().nonnegative().nullable(),
  instrumentMode: instrumentModeSchema,
  guitarViewMode: guitarViewModeSchema,
  updatedAt: z.string().datetime(),
});
export type PracticeStateRecord = z.infer<typeof practiceStateRecordSchema>;

function nowIsoString() {
  return new Date().toISOString();
}

export function createWorkRecord(
  input: Pick<WorkRecord, "id" | "title" | "sourceType" | "pageCount" | "currentKey"> &
    Partial<Omit<WorkRecord, "id" | "title" | "sourceType" | "pageCount" | "currentKey">>,
) {
  return workRecordSchema.parse({
    createdAt: nowIsoString(),
    updatedAt: nowIsoString(),
    lastPracticedAt: null,
    manualKeyOverride: false,
    lastPosition: null,
    status: "draft",
    ...input,
  });
}

export function createWorkPageRecord(
  input: Pick<
    WorkPageRecord,
    "id" | "workId" | "pageIndex" | "imagePath" | "sourceFileRef"
  > &
    Partial<Omit<WorkPageRecord, "id" | "workId" | "pageIndex" | "imagePath" | "sourceFileRef">>,
) {
  return workPageRecordSchema.parse({
    recognitionStatus: "queued",
    recognizedAt: null,
    ...input,
  });
}

export function createRecognitionResultRecord(input: RecognitionResultRecord) {
  return recognitionResultRecordSchema.parse(input);
}

export function createScoreObjectRecord(input: ScoreObjectRecord) {
  return scoreObjectRecordSchema.parse(input);
}

export function createPracticeStateRecord(
  input: Omit<PracticeStateRecord, "updatedAt"> &
    Partial<Pick<PracticeStateRecord, "updatedAt">>,
) {
  const {
    instrumentMode = "piano",
    guitarViewMode = "recommended",
    updatedAt = nowIsoString(),
    ...rest
  } = input;

  return practiceStateRecordSchema.parse({
    ...rest,
    instrumentMode,
    guitarViewMode,
    updatedAt,
  });
}
