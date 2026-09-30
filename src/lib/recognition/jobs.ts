import type OpenAI from "openai";

import type { Bbox } from "@/lib/domain/types";
import { normalizeRecognitionPageArtifacts } from "@/lib/recognition/normalize";
import {
  requestObjectRecognitionRerun,
  requestPageRecognition,
  validateObjectRecognitionOutput,
  validatePageRecognitionOutput,
} from "@/lib/recognition/openai";
import type { PageRecognitionPromptContext } from "@/lib/recognition/prompt";

export type RecognitionJobFailure = {
  recognitionStatus: "failed";
  errorMessage: string;
  rawResponse: unknown;
};

export type PageRecognitionJobSuccess = ReturnType<
  typeof normalizeRecognitionPageArtifacts
> & {
  recognitionStatus: "succeeded";
  rawResponse: unknown;
};

export type PageRecognitionJobResult =
  | PageRecognitionJobSuccess
  | RecognitionJobFailure;

export type ObjectRerunJobResult =
  | {
      recognitionStatus: "succeeded";
      rawResponse: unknown;
      cropRegion: Bbox;
      updatedObject: ReturnType<typeof normalizeRecognitionPageArtifacts>["scoreObjects"][number];
    }
  | RecognitionJobFailure;

export async function runPageRecognitionJob(input: {
  workPageId: string;
  pagePng: Buffer;
  promptContext: PageRecognitionPromptContext;
  client?: OpenAI;
  model?: string;
  requestPageRecognition?: typeof requestPageRecognition;
}): Promise<PageRecognitionJobResult> {
  let rawResponse: unknown = null;

  try {
    const apiResponse = await (input.requestPageRecognition ?? requestPageRecognition)({
      pagePng: input.pagePng,
      promptContext: input.promptContext,
      client: input.client,
      model: input.model,
    });

    rawResponse = apiResponse.rawResponse;

    const parsedPage = validatePageRecognitionOutput(apiResponse.outputText);
    const normalized = normalizeRecognitionPageArtifacts({
      workPageId: input.workPageId,
      modelName: apiResponse.modelName,
      rawResponse,
      parsedPage,
    });

    return {
      recognitionStatus: "succeeded",
      rawResponse,
      ...normalized,
    };
  } catch (error) {
    return {
      recognitionStatus: "failed",
      errorMessage: toErrorMessage(error),
      rawResponse,
    };
  }
}

export async function runObjectRecognitionRerunJob(input: {
  workPageId: string;
  objectId: string;
  pagePng: Buffer;
  bbox: Bbox;
  client?: OpenAI;
  model?: string;
  padding?: number;
  requestObjectRecognitionRerun?: typeof requestObjectRecognitionRerun;
}): Promise<ObjectRerunJobResult> {
  let rawResponse: unknown = null;

  try {
    const { cropRegion, apiResponse } = await (
      input.requestObjectRecognitionRerun ?? requestObjectRecognitionRerun
    )({
      pagePng: input.pagePng,
      bbox: input.bbox,
      client: input.client,
      model: input.model,
      padding: input.padding,
    });

    rawResponse = apiResponse.rawResponse;

    const parsed = validateObjectRecognitionOutput(apiResponse.outputText);

    const updatedObject = normalizeRecognitionPageArtifacts({
      workPageId: input.workPageId,
      modelName: apiResponse.modelName,
      rawResponse,
      objectSource: "rerun",
      parsedPage: {
        version: parsed.version,
        pageNumber: 1,
        sourceWidth: parsed.sourceWidth,
        sourceHeight: parsed.sourceHeight,
        keyCandidate: null,
        timeSignatureCandidate: null,
        objects: [
          {
            ...parsed.object,
            id: input.objectId,
            bbox: {
              x: parsed.object.bbox.x + cropRegion.x,
              y: parsed.object.bbox.y + cropRegion.y,
              width: parsed.object.bbox.width,
              height: parsed.object.bbox.height,
            },
          },
        ],
      },
    }).scoreObjects[0];

    return {
      recognitionStatus: "succeeded",
      rawResponse,
      cropRegion,
      updatedObject,
    };
  } catch (error) {
    return {
      recognitionStatus: "failed",
      errorMessage: toErrorMessage(error),
      rawResponse,
    };
  }
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown recognition error.";
}
