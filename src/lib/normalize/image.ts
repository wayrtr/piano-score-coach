import sharp from "sharp";

import { createNormalizedPageImage } from "@/lib/normalize/page-image";

export async function normalizeImageBuffer(input: {
  buffer: Buffer;
  pageIndex: number;
}) {
  const normalizedBuffer = await sharp(input.buffer).rotate().png().toBuffer();
  const metadata = await sharp(normalizedBuffer).metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error("Unable to determine normalized image dimensions.");
  }

  return createNormalizedPageImage({
    pageIndex: input.pageIndex,
    buffer: normalizedBuffer,
    sourceWidth: metadata.width,
    sourceHeight: metadata.height,
  });
}
