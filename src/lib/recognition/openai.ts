import OpenAI from "openai";
import sharp from "sharp";

import type { Bbox } from "@/lib/domain/types";
import {
  parseRecognitionObjectOutput,
  parseRecognitionPageOutput,
  recognitionObjectTextFormat,
  recognitionPageTextFormat,
} from "@/lib/recognition/schema-v0";
import {
  buildObjectRerunPrompt,
  buildPageRecognitionPrompt,
  type PageRecognitionPromptContext,
} from "@/lib/recognition/prompt";

const DEFAULT_RECOGNITION_MODEL = "gpt-5.4";
const DEFAULT_RERUN_PADDING = 24;

export type RecognitionApiResponse = {
  modelName: string;
  responseId: string;
  outputText: string;
  rawResponse: {
    bodyText: string;
    parsedBody: unknown;
    requestId: string | null;
    status: number;
  };
};

export function getRecognitionModel() {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_RECOGNITION_MODEL;
}

export function getRecognitionBaseUrl() {
  return process.env.OPENAI_BASE_URL?.trim() || null;
}

export function getRecognitionClientOptions(apiKey = process.env.OPENAI_API_KEY) {
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for recognition requests.");
  }

  const baseURL = getRecognitionBaseUrl();

  return {
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  };
}

export function createOpenAIClient(apiKey = process.env.OPENAI_API_KEY) {
  return new OpenAI(getRecognitionClientOptions(apiKey));
}

export function bufferToDataUrl(
  buffer: Buffer,
  mimeType = "image/png",
) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

export async function requestPageRecognition(input: {
  pagePng: Buffer;
  promptContext: PageRecognitionPromptContext;
  client?: OpenAI;
  model?: string;
}) {
  const client = input.client ?? createOpenAIClient();
  const modelName = input.model ?? getRecognitionModel();
  const request = client.responses.create({
    model: modelName,
    instructions:
      "You are a piano score recognition assistant. Return only strict JSON that matches the provided schema.",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildPageRecognitionPrompt(input.promptContext),
          },
          {
            type: "input_image",
            image_url: bufferToDataUrl(input.pagePng),
            detail: "high",
          },
        ],
      },
    ],
    text: {
      format: recognitionPageTextFormat,
    },
  });
  const httpResponse = await request.asResponse();
  const rawBody = await httpResponse.clone().text();
  const response = await request;

  return toRecognitionApiResponse({
    response,
    modelName,
    rawBody,
    requestId: httpResponse.headers.get("x-request-id"),
    status: httpResponse.status,
  });
}

export async function cropObjectRegion(input: {
  pagePng: Buffer;
  bbox: Bbox;
  padding?: number;
}) {
  const metadata = await sharp(input.pagePng).metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error("Unable to determine page dimensions for object rerun.");
  }

  const padding = input.padding ?? DEFAULT_RERUN_PADDING;
  const left = Math.max(0, Math.floor(input.bbox.x - padding));
  const top = Math.max(0, Math.floor(input.bbox.y - padding));
  const right = Math.min(
    metadata.width,
    Math.ceil(input.bbox.x + input.bbox.width + padding),
  );
  const bottom = Math.min(
    metadata.height,
    Math.ceil(input.bbox.y + input.bbox.height + padding),
  );

  const cropRegion = {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  } satisfies Bbox;

  const croppedBuffer = await sharp(input.pagePng)
    .extract({
      left: cropRegion.x,
      top: cropRegion.y,
      width: cropRegion.width,
      height: cropRegion.height,
    })
    .png()
    .toBuffer();

  return {
    cropRegion,
    croppedBuffer,
  };
}

export async function requestObjectRecognitionRerun(input: {
  pagePng: Buffer;
  bbox: Bbox;
  client?: OpenAI;
  model?: string;
  padding?: number;
}) {
  const client = input.client ?? createOpenAIClient();
  const modelName = input.model ?? getRecognitionModel();
  const { croppedBuffer, cropRegion } = await cropObjectRegion({
    pagePng: input.pagePng,
    bbox: input.bbox,
    padding: input.padding,
  });

  const request = client.responses.create({
    model: modelName,
    instructions:
      "You are a piano score recognition assistant. Return only strict JSON that matches the provided schema.",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildObjectRerunPrompt({
              sourceWidth: cropRegion.width,
              sourceHeight: cropRegion.height,
              originalBbox: input.bbox,
            }),
          },
          {
            type: "input_image",
            image_url: bufferToDataUrl(croppedBuffer),
            detail: "high",
          },
        ],
      },
    ],
    text: {
      format: recognitionObjectTextFormat,
    },
  });
  const httpResponse = await request.asResponse();
  const rawBody = await httpResponse.clone().text();
  const response = await request;

  return {
    cropRegion,
    croppedBuffer,
    apiResponse: toRecognitionApiResponse({
      response,
      modelName,
      rawBody,
      requestId: httpResponse.headers.get("x-request-id"),
      status: httpResponse.status,
    }),
  };
}

export function validatePageRecognitionOutput(outputText: string) {
  return parseRecognitionPageOutput(outputText);
}

export function validateObjectRecognitionOutput(outputText: string) {
  return parseRecognitionObjectOutput(outputText);
}

function toRecognitionApiResponse(input: {
  response: OpenAI.Responses.Response;
  modelName: string;
  rawBody: string;
  requestId: string | null;
  status: number;
}): RecognitionApiResponse {
  return {
    modelName: input.modelName,
    responseId: input.response.id,
    outputText: input.response.output_text ?? "",
    rawResponse: {
      bodyText: input.rawBody,
      parsedBody: parseJsonSafely(input.rawBody),
      requestId: input.requestId,
      status: input.status,
    },
  };
}

function parseJsonSafely(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
