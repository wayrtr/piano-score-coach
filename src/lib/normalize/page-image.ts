import { createHash } from "node:crypto";
import fs from "node:fs";

import {
  ensureWorkStoragePaths,
  getWorkPageImagePath,
} from "@/lib/storage/filesystem";

export const NORMALIZED_PAGE_DPI = 300;
export const NORMALIZED_PAGE_FORMAT = "png";
export const NORMALIZED_PAGE_HASH_LENGTH = 16;

export type NormalizedPageImage = {
  pageIndex: number;
  format: typeof NORMALIZED_PAGE_FORMAT;
  buffer: Buffer;
  contentHash: string;
  fileName: string;
  sourceWidth: number;
  sourceHeight: number;
};

export type StoredNormalizedPageImage = NormalizedPageImage & {
  imagePath: string;
  sourceFileRef: string;
};

export function buildNormalizedPageFilename(input: {
  pageIndex: number;
  contentHash: string;
}) {
  const hashPrefix = input.contentHash.slice(0, NORMALIZED_PAGE_HASH_LENGTH);
  const pageLabel = String(input.pageIndex + 1).padStart(4, "0");

  return `page-${pageLabel}-${hashPrefix}.${NORMALIZED_PAGE_FORMAT}`;
}

export function hashNormalizedPageBuffer(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function createNormalizedPageImage(input: {
  pageIndex: number;
  buffer: Buffer;
  sourceWidth: number;
  sourceHeight: number;
}): NormalizedPageImage {
  const contentHash = hashNormalizedPageBuffer(input.buffer);

  return {
    pageIndex: input.pageIndex,
    format: NORMALIZED_PAGE_FORMAT,
    buffer: input.buffer,
    contentHash,
    fileName: buildNormalizedPageFilename({
      pageIndex: input.pageIndex,
      contentHash,
    }),
    sourceWidth: input.sourceWidth,
    sourceHeight: input.sourceHeight,
  };
}

export function persistNormalizedPageArtifacts(input: {
  storageRoot: string;
  workId: string;
  pages: NormalizedPageImage[];
}) {
  ensureWorkStoragePaths(input.storageRoot, input.workId);

  return input.pages.map((page) => {
    const filePath = getWorkPageImagePath(
      input.storageRoot,
      input.workId,
      page.fileName,
    );

    fs.writeFileSync(filePath, page.buffer);

    return filePath;
  });
}

export async function normalizeSourceInputsIntoWorkPages(input: {
  storageRoot: string;
  workId: string;
  sourceType: "pdf" | "images";
  files: Array<{
    buffer: Buffer;
    fileName: string;
  }>;
}): Promise<StoredNormalizedPageImage[]> {
  if (input.files.length === 0) {
    throw new Error("At least one source file is required for normalization.");
  }

  const normalizedPages =
    input.sourceType === "pdf"
      ? await normalizePdfSource(input.files)
      : await normalizeImageSources(input.files);

  const persistedPaths = persistNormalizedPageArtifacts({
    storageRoot: input.storageRoot,
    workId: input.workId,
    pages: normalizedPages,
  });

  return normalizedPages.map((page, index) => ({
    ...page,
    imagePath: persistedPaths[index],
    sourceFileRef:
      input.sourceType === "pdf"
        ? `${input.files[0].fileName}#page=${index + 1}`
        : input.files[index].fileName,
  }));
}

async function normalizePdfSource(
  files: Array<{
    buffer: Buffer;
    fileName: string;
  }>,
) {
  if (files.length !== 1) {
    throw new Error("PDF normalization expects exactly one source file.");
  }

  const { normalizePdfBuffer } = await import("@/lib/normalize/pdf");

  return normalizePdfBuffer({
    buffer: files[0].buffer,
  });
}

async function normalizeImageSources(
  files: Array<{
    buffer: Buffer;
    fileName: string;
  }>,
) {
  const { normalizeImageBuffer } = await import("@/lib/normalize/image");

  return Promise.all(
    files.map((file, pageIndex) =>
      normalizeImageBuffer({
        buffer: file.buffer,
        pageIndex,
      }),
    ),
  );
}
