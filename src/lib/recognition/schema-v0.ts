import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

export const RECOGNITION_SCHEMA_VERSION = "schema-v0";
export const RECOGNITION_PAGE_FORMAT_NAME = "piano_score_page_v0";
export const RECOGNITION_OBJECT_FORMAT_NAME = "piano_score_object_v0";

export const recognitionBboxSchema = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  width: z.number().positive(),
  height: z.number().positive(),
});

export const recognitionScoreObjectSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["note", "chord", "other"]),
  bbox: recognitionBboxSchema,
  staff: z.string().min(1),
  measure: z.number().int().nonnegative(),
  notes: z.array(z.string().min(1)).min(1),
  confidence: z.number().min(0).max(1),
  source: z.enum(["model", "rerun"]).default("model"),
});

export const recognitionPageSchema = z.object({
  version: z.literal(RECOGNITION_SCHEMA_VERSION),
  pageNumber: z.number().int().positive(),
  sourceWidth: z.number().int().positive(),
  sourceHeight: z.number().int().positive(),
  keyCandidate: z.string().min(1).nullable(),
  timeSignatureCandidate: z.string().min(1).nullable(),
  objects: z.array(recognitionScoreObjectSchema),
});

export const recognitionObjectRerunSchema = z.object({
  version: z.literal(RECOGNITION_SCHEMA_VERSION),
  sourceWidth: z.number().int().positive(),
  sourceHeight: z.number().int().positive(),
  object: recognitionScoreObjectSchema,
});

export type RecognitionScoreObject = z.infer<typeof recognitionScoreObjectSchema>;
export type RecognitionPage = z.infer<typeof recognitionPageSchema>;
export type RecognitionObjectRerun = z.infer<typeof recognitionObjectRerunSchema>;

export const recognitionPageTextFormat = zodTextFormat(
  recognitionPageSchema,
  RECOGNITION_PAGE_FORMAT_NAME,
  {
    description:
      "Structured piano grand-staff page recognition for a normalized score page image.",
  },
);

export const recognitionObjectTextFormat = zodTextFormat(
  recognitionObjectRerunSchema,
  RECOGNITION_OBJECT_FORMAT_NAME,
  {
    description:
      "Structured single-object piano score recognition for a cropped score region.",
  },
);

export function parseRecognitionPageOutput(outputText: string) {
  return recognitionPageSchema.parse(JSON.parse(outputText));
}

export function parseRecognitionObjectOutput(outputText: string) {
  return recognitionObjectRerunSchema.parse(JSON.parse(outputText));
}
