import fs from "node:fs";
import path from "node:path";

import type { SKRSContext2D } from "@napi-rs/canvas";

import { NORMALIZED_PAGE_DPI } from "@/lib/normalize/page-image";

const PDF_POINTS_PER_INCH = 72;

export async function createNormalizedScorePdf(input: {
  pageImagePaths: string[];
  outputPath: string;
}) {
  if (input.pageImagePaths.length === 0) {
    throw new Error("本地识谱至少需要一页谱面图片。");
  }

  const { PDFDocument, loadImage } = await import("@napi-rs/canvas");
  const document = new PDFDocument({
    creator: "Piano Score Coach",
    producer: "Piano Score Coach local OMR input",
    rasterDPI: NORMALIZED_PAGE_DPI,
  });

  for (const pageImagePath of input.pageImagePaths) {
    const image = await loadImage(fs.readFileSync(pageImagePath));
    const pageWidth = (image.width * PDF_POINTS_PER_INCH) / NORMALIZED_PAGE_DPI;
    const pageHeight = (image.height * PDF_POINTS_PER_INCH) / NORMALIZED_PAGE_DPI;
    const context = document.beginPage(pageWidth, pageHeight) as SKRSContext2D;

    context.drawImage(image, 0, 0, pageWidth, pageHeight);
    document.endPage();
  }

  fs.mkdirSync(path.dirname(input.outputPath), { recursive: true });
  fs.writeFileSync(input.outputPath, document.close());

  return input.outputPath;
}
