import {
  NORMALIZED_PAGE_DPI,
  createNormalizedPageImage,
} from "@/lib/normalize/page-image";

const PDF_POINTS_PER_INCH = 72;
const PDF_SCALE = NORMALIZED_PAGE_DPI / PDF_POINTS_PER_INCH;

export async function normalizePdfBuffer(input: {
  buffer: Buffer;
  startingPageIndex?: number;
}) {
  const [{ createCanvas }, { getDocument }] = await Promise.all([
    import("@napi-rs/canvas"),
    import("pdfjs-dist/legacy/build/pdf.mjs"),
  ]);
  const loadingTask = getDocument({
    data: new Uint8Array(input.buffer),
  });

  const pages = [];
  const startingPageIndex = input.startingPageIndex ?? 0;

  try {
    const document = await loadingTask.promise;

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);

      try {
        const viewport = page.getViewport({ scale: PDF_SCALE });
        const sourceWidth = Math.round(viewport.width);
        const sourceHeight = Math.round(viewport.height);
        const canvas = createCanvas(sourceWidth, sourceHeight);
        const context = canvas.getContext("2d");

        await page.render({
          canvas: canvas as unknown as HTMLCanvasElement,
          canvasContext: context as unknown as CanvasRenderingContext2D,
          viewport,
          background: "white",
        }).promise;

        pages.push(
          createNormalizedPageImage({
            pageIndex: startingPageIndex + pageNumber - 1,
            buffer: canvas.toBuffer("image/png"),
            sourceWidth,
            sourceHeight,
          }),
        );
      } finally {
        page.cleanup();
      }
    }

    return pages;
  } finally {
    // This owns the worker even when loading fails before a document exists.
    await loadingTask.destroy();
  }
}
