// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { normalizePdfBuffer } from "@/lib/normalize/pdf";

const mocks = vi.hoisted(() => ({
  createCanvas: vi.fn(),
  getDocument: vi.fn(),
}));

vi.mock("@napi-rs/canvas", () => ({ createCanvas: mocks.createCanvas }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({ getDocument: mocks.getDocument }));

beforeEach(() => {
  vi.resetAllMocks();
});

describe("PDF normalization resource cleanup", () => {
  it("destroys the loading task when loading a malformed PDF fails", async () => {
    const failure = new Error("invalid PDF");
    const destroy = vi.fn(async () => undefined);
    mocks.getDocument.mockReturnValue({
      get promise() { return Promise.reject(failure); },
      destroy,
    });

    await expect(normalizePdfBuffer({ buffer: Buffer.from("invalid") })).rejects.toBe(failure);

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(mocks.createCanvas).not.toHaveBeenCalled();
  });

  it.each(["render", "encode", "canvas"])("cleans up page and loading resources after a %s failure", async (stage) => {
    const failure = new Error(`${stage} failed`);
    const cleanup = vi.fn();
    const destroy = vi.fn(async () => undefined);
    const page = {
      getViewport: vi.fn(() => ({ width: 100, height: 200 })),
      render: vi.fn(() => ({
        promise: stage === "render" ? Promise.reject(failure) : Promise.resolve(),
      })),
      cleanup,
    };
    const document = { numPages: 1, getPage: vi.fn(async () => page), destroy };
    mocks.getDocument.mockReturnValue({ promise: Promise.resolve(document), destroy });
    mocks.createCanvas.mockImplementation(() => {
      if (stage === "canvas") throw failure;
      return {
        getContext: vi.fn(() => ({})),
        toBuffer: vi.fn(() => { throw failure; }),
      };
    });

    await expect(normalizePdfBuffer({ buffer: Buffer.from("PDF") })).rejects.toBe(failure);

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("preserves page order, offsets and PNGs while cleaning up a completed load", async () => {
    const cleanup = vi.fn();
    const destroy = vi.fn(async () => undefined);
    const getPage = vi.fn(async () => ({
      getViewport: vi.fn(() => ({ width: 100.4, height: 200.6 })),
      render: vi.fn(() => ({ promise: Promise.resolve() })),
      cleanup,
    }));
    mocks.getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 2, getPage, destroy }),
      destroy,
    });
    mocks.createCanvas.mockReturnValue({
      getContext: vi.fn(() => ({})),
      toBuffer: vi.fn(() => Buffer.from("PNG")),
    });

    const pages = await normalizePdfBuffer({ buffer: Buffer.from("PDF"), startingPageIndex: 3 });

    expect(pages.map((page) => page.pageIndex)).toEqual([3, 4]);
    expect(pages.every((page) => page.sourceWidth === 100 && page.sourceHeight === 201)).toBe(true);
    expect(pages.every((page) => page.buffer.equals(Buffer.from("PNG")))).toBe(true);
    expect(getPage.mock.calls).toEqual([[1], [2]]);
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
