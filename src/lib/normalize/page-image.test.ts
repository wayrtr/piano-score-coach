import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { vi } from "vitest";

import {
  buildNormalizedPageFilename,
  normalizeSourceInputsIntoWorkPages,
  persistNormalizedPageArtifacts,
} from "@/lib/normalize/page-image";
import { normalizeImageBuffer } from "@/lib/normalize/image";
import { normalizePdfBuffer } from "@/lib/normalize/pdf";

const MINIMAL_SINGLE_PAGE_PDF = `%PDF-1.1
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 400]/Contents 4 0 R>>endobj
4 0 obj<</Length 44>>stream
0.9 0 0 rg
0 0 200 400 re
f
endstream
endobj
xref
0 5
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000202 00000 n
trailer<</Size 5/Root 1 0 R>>
startxref
297
%%EOF`;

async function createOrientedJpeg() {
  return sharp({
    create: {
      width: 10,
      height: 20,
      channels: 3,
      background: { r: 18, g: 52, b: 86 },
    },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

describe("image normalization", () => {
  it("corrects EXIF rotation and emits stable source dimensions", async () => {
    const page = await normalizeImageBuffer({
      buffer: await createOrientedJpeg(),
      pageIndex: 0,
    });

    expect(page.format).toBe("png");
    expect(page.pageIndex).toBe(0);
    expect(page.sourceWidth).toBe(20);
    expect(page.sourceHeight).toBe(10);
    expect(page.fileName).toMatch(/^page-0001-[a-f0-9]{16}\.png$/);

    const metadata = await sharp(page.buffer).metadata();

    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(20);
    expect(metadata.height).toBe(10);
  });
});

describe("pdf normalization", () => {
  it("rasterizes PDF pages to 300 DPI PNGs", async () => {
    const consoleWarn = vi
      .spyOn(console, "warn")
      .mockImplementation((message: unknown) => {
        if (String(message).includes("Indexing all PDF objects")) {
          return;
        }

        process.stderr.write(`${String(message)}\n`);
      });

    try {
      const pages = await normalizePdfBuffer({
        buffer: Buffer.from(MINIMAL_SINGLE_PAGE_PDF),
      });

      expect(pages).toHaveLength(1);
      expect(pages[0]).toMatchObject({
        format: "png",
        pageIndex: 0,
        sourceWidth: 833,
        sourceHeight: 1667,
      });
      expect(pages[0].fileName).toMatch(/^page-0001-[a-f0-9]{16}\.png$/);
    } finally {
      consoleWarn.mockRestore();
    }
  });
});

describe("page artifact naming and persistence", () => {
  it("uses deterministic filenames based on page index and content hash", () => {
    const first = buildNormalizedPageFilename({
      pageIndex: 0,
      contentHash: "1234567890abcdef1234567890abcdef",
    });
    const second = buildNormalizedPageFilename({
      pageIndex: 0,
      contentHash: "1234567890abcdef1234567890abcdef",
    });
    const third = buildNormalizedPageFilename({
      pageIndex: 1,
      contentHash: "1234567890abcdef1234567890abcdef",
    });

    expect(first).toBe("page-0001-1234567890abcdef.png");
    expect(second).toBe(first);
    expect(third).toBe("page-0002-1234567890abcdef.png");
  });

  it("stores normalized page images beneath the work pages directory", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "piano-score-pages-"));
    const page = await normalizeImageBuffer({
      buffer: await createOrientedJpeg(),
      pageIndex: 0,
    });

    const persisted = persistNormalizedPageArtifacts({
      storageRoot: root,
      workId: "work_123",
      pages: [page],
    });

    expect(persisted).toEqual([
      path.join(root, "works", "work_123", "pages", page.fileName),
    ]);
    expect(fs.existsSync(persisted[0])).toBe(true);
  });

  it("runs the full normalization pipeline and persists stored image pages", async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "piano-score-pipeline-"),
    );

    const pages = await normalizeSourceInputsIntoWorkPages({
      storageRoot: root,
      workId: "work_pipeline",
      sourceType: "images",
      files: [
        {
          buffer: await createOrientedJpeg(),
          fileName: "page-1.jpg",
        },
      ],
    });

    expect(pages).toHaveLength(1);
    expect(pages[0].sourceFileRef).toBe("page-1.jpg");
    expect(pages[0].imagePath).toBe(
      path.join(root, "works", "work_pipeline", "pages", pages[0].fileName),
    );
    expect(fs.existsSync(pages[0].imagePath)).toBe(true);
  });
});
