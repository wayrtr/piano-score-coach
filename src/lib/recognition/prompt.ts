import type { Bbox } from "@/lib/domain/types";

export type PageRecognitionPromptContext = {
  pageNumber: number;
  totalPages?: number;
  sourceWidth: number;
  sourceHeight: number;
  currentWorkKey?: string | null;
};

export function buildPageRecognitionPrompt(
  context: PageRecognitionPromptContext,
) {
  const pageLabel = context.totalPages
    ? `Page ${context.pageNumber} of ${context.totalPages}.`
    : `Page ${context.pageNumber}.`;
  const currentWorkKey = context.currentWorkKey
    ? `Current work-level key candidate: ${context.currentWorkKey}.`
    : "Current work-level key candidate is unknown.";

  return [
    "You are reading one normalized page of printed piano grand-staff notation.",
    pageLabel,
    `The page image is ${context.sourceWidth} by ${context.sourceHeight} pixels.`,
    currentWorkKey,
    "Return only strict structured data that matches the provided JSON schema.",
    "Use page pixel coordinates from the normalized page image.",
    "Every recognized object must use type note, chord, or other.",
    "Always return notes as an array, even for a single note.",
    'Use source = "model" for normal page recognition.',
    "If notation is unsupported or unclear, return type other instead of guessing a note/chord.",
    "Provide a keyCandidate such as E major or A minor when reasonably confident; otherwise return null.",
    "Do not add commentary outside the schema.",
  ].join("\n");
}

export function buildObjectRerunPrompt(input: {
  sourceWidth: number;
  sourceHeight: number;
  originalBbox: Bbox;
}) {
  return [
    "You are re-reading one cropped score object from a normalized piano page image.",
    `The crop image is ${input.sourceWidth} by ${input.sourceHeight} pixels.`,
    `The original object bbox before padding was x=${input.originalBbox.x}, y=${input.originalBbox.y}, width=${input.originalBbox.width}, height=${input.originalBbox.height}.`,
    "Return exactly one object in the provided schema.",
    "Use crop-local pixel coordinates for the returned bbox.",
    'Use source = "rerun" for this result.',
    "If you cannot confidently classify it as note or chord, return other.",
    "Do not add commentary outside the schema.",
  ].join("\n");
}
