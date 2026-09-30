import { randomUUID } from "node:crypto";

import {
  createRecognitionResultRecord,
  createScoreObjectRecord,
  type ConfidenceSummary,
  type ScoreObjectSource,
} from "@/lib/domain/types";
import {
  RECOGNITION_SCHEMA_VERSION,
  recognitionPageSchema,
  type RecognitionPage,
} from "@/lib/recognition/schema-v0";

export function summarizeObjectConfidence(
  objects: Array<{
    confidence: number;
  }>,
): ConfidenceSummary {
  if (objects.length === 0) {
    return {
      min: 0,
      max: 0,
      average: 0,
    };
  }

  const values = objects.map((object) => object.confidence);
  const total = values.reduce((sum, value) => sum + value, 0);

  return {
    min: Math.min(...values),
    max: Math.max(...values),
    average: Number((total / values.length).toFixed(4)),
  };
}

export function normalizeRecognitionPageArtifacts(input: {
  workPageId: string;
  modelName: string;
  rawResponse: unknown;
  parsedPage: RecognitionPage;
  objectSource?: ScoreObjectSource;
  recognitionResultId?: string;
  version?: string;
}) {
  const parsedPage = recognitionPageSchema.parse(input.parsedPage);
  const objectSource = input.objectSource ?? "model";
  const confidenceSummary = summarizeObjectConfidence(parsedPage.objects);

  return {
    keyCandidate: parsedPage.keyCandidate,
    page: parsedPage,
    confidenceSummary,
    recognitionResult: createRecognitionResultRecord({
      id: input.recognitionResultId ?? randomUUID(),
      workPageId: input.workPageId,
      modelName: input.modelName,
      version: input.version ?? RECOGNITION_SCHEMA_VERSION,
      rawResponse: input.rawResponse,
      normalizedData: parsedPage,
      confidenceSummary,
    }),
    scoreObjects: parsedPage.objects.map((object) =>
      createScoreObjectRecord({
        id: object.id,
        workPageId: input.workPageId,
        type: object.type,
        bbox: object.bbox,
        staff: object.staff,
        measure: object.measure,
        notes: object.notes,
        confidence: object.confidence,
        source: objectSource,
      }),
    ),
  };
}
