import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";

import { createNormalizedScorePdf } from "@/lib/recognition/omr-input";

describe("createNormalizedScorePdf", () => {
  it("keeps normalized image pages in the selected order", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "piano-omr-input-"));
    const tallPage = path.join(root, "tall.png");
    const widePage = path.join(root, "wide.png");
    const outputPath = path.join(root, "score.pdf");

    await sharp({
      create: {
        width: 100,
        height: 200,
        channels: 3,
        background: "white",
      },
    }).png().toFile(tallPage);
    await sharp({
      create: {
        width: 300,
        height: 150,
        channels: 3,
        background: "white",
      },
    }).png().toFile(widePage);

    await createNormalizedScorePdf({
      pageImagePaths: [tallPage, widePage],
      outputPath,
    });

    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const document = await getDocument({
      data: new Uint8Array(fs.readFileSync(outputPath)),
    }).promise;
    const firstPage = await document.getPage(1);
    const secondPage = await document.getPage(2);
    const firstViewport = firstPage.getViewport({ scale: 1 });
    const secondViewport = secondPage.getViewport({ scale: 1 });

    expect(document.numPages).toBe(2);
    expect(firstViewport.height).toBeGreaterThan(firstViewport.width);
    expect(secondViewport.width).toBeGreaterThan(secondViewport.height);

    await document.destroy();
  });
});
