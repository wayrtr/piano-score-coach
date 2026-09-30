import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import {
  ImportForm,
  type WorkListItem,
} from "@/components/import/import-form";

function createFile(name: string, type: string) {
  return new File(["demo"], name, { type });
}

describe("ImportForm", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ works: [] }), {
        status: 201,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    ) as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("submits one PDF file as a single work import", async () => {
    render(<ImportForm initialWorks={[]} />);

    fireEvent.change(screen.getByLabelText("上传 PDF"), {
      target: {
        files: [createFile("moon-river.pdf", "application/pdf")],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "开始导入" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    const [, requestInit] = vi.mocked(global.fetch).mock.calls[0];
    const body = requestInit?.body as FormData;

    expect(requestInit?.method).toBe("POST");
    expect(body.get("sourceType")).toBe("pdf");
    expect((body.get("pdf") as File).name).toBe("moon-river.pdf");
  });

  it("preserves the user-defined image order on submit", async () => {
    render(<ImportForm initialWorks={[]} />);

    fireEvent.change(screen.getByLabelText("上传多张图片"), {
      target: {
        files: [
          createFile("page-1.jpg", "image/jpeg"),
          createFile("page-2.jpg", "image/jpeg"),
          createFile("page-3.jpg", "image/jpeg"),
        ],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "上移 page-3.jpg" }));
    fireEvent.click(screen.getByRole("button", { name: "上移 page-3.jpg" }));
    fireEvent.click(screen.getByRole("button", { name: "开始导入" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    const [, requestInit] = vi.mocked(global.fetch).mock.calls[0];
    const body = requestInit?.body as FormData;
    const imageFiles = body.getAll("images") as File[];

    expect(body.get("sourceType")).toBe("images");
    expect(imageFiles.map((file) => file.name)).toEqual([
      "page-3.jpg",
      "page-1.jpg",
      "page-2.jpg",
    ]);
  });

  it("submits one MusicXML file as a quality-first structured import", async () => {
    render(<ImportForm initialWorks={[]} />);

    fireEvent.change(screen.getByLabelText("上传 MusicXML"), {
      target: {
        files: [createFile("prelude.musicxml", "application/vnd.recordare.musicxml+xml")],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "开始导入" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    const [, requestInit] = vi.mocked(global.fetch).mock.calls[0];
    const body = requestInit?.body as FormData;

    expect(body.get("sourceType")).toBe("musicxml");
    expect((body.get("musicxml") as File).name).toBe("prelude.musicxml");
  });

  it("uses localized file-picker copy instead of the browser's native English label", () => {
    render(<ImportForm initialWorks={[]} />);

    expect(screen.getByText("选择 MusicXML 文件")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("上传 MusicXML"), {
      target: {
        files: [createFile("prelude.musicxml", "application/xml")],
      },
    });

    expect(screen.getByText("更换 MusicXML 文件")).toBeInTheDocument();
  });

  it("explains unsupported file selections before sending anything", async () => {
    render(<ImportForm initialWorks={[]} />);

    fireEvent.change(screen.getByLabelText("上传 MusicXML"), {
      target: {
        files: [createFile("notes.txt", "text/plain")],
      },
    });

    expect(
      screen.getByText("这个文件不是 MusicXML，请选择 .musicxml、.xml 或 .mxl 文件。"),
    ).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("lets the user cancel a slow import without losing the selected file", async () => {
    global.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    }) as typeof fetch;

    render(<ImportForm initialWorks={[]} />);

    fireEvent.change(screen.getByLabelText("上传 MusicXML"), {
      target: {
        files: [createFile("prelude.musicxml", "application/xml")],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始导入" }));
    fireEvent.click(await screen.findByRole("button", { name: "取消导入" }));

    await waitFor(() => {
      expect(
        screen.getByText("已取消导入，已选择的文件仍保留。"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("prelude.musicxml")).toBeInTheDocument();
  });

  it("locks import settings during a request and unlocks them on cancellation", async () => {
    global.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") {
        return Promise.resolve(Response.json({ works: [] }));
      }

      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    }) as typeof fetch;

    render(<ImportForm initialWorks={[]} />);
    fireEvent.change(screen.getByLabelText("上传多张图片"), {
      target: { files: [createFile("page-1.png", "image/png"), createFile("page-2.png", "image/png")] },
    });
    const titleInput = screen.getByLabelText("作品标题（可选）");
    const form = titleInput.closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    for (const control of [
      titleInput,
      screen.getByLabelText("上传 MusicXML"),
      screen.getByLabelText("上传 PDF"),
      screen.getByLabelText("上传多张图片"),
      screen.getByRole("button", { name: "清空选择" }),
      screen.getByRole("button", { name: "下移 page-1.png" }),
      screen.getByRole("button", { name: "移除 page-1.png" }),
    ]) {
      expect(control).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: "取消导入" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "取消导入" }));

    await screen.findByText("已取消导入，已选择的文件仍保留。");
    expect(titleInput).toBeEnabled();
    expect(screen.getByRole("button", { name: "下移 page-1.png" })).toBeEnabled();
    expect(screen.getByText("2 张图片待提交")).toBeInTheDocument();
  });

  it.each(["manual", "poll"])("ignores a stale %s refresh after a successful import", async (refreshMode) => {
    const existingWork: WorkListItem = {
      id: "existing",
      title: "Existing score",
      sourceType: "images",
      pageCount: 1,
      status: "processing",
      lastPracticedAt: null,
      pages: [{ id: "page-existing", pageIndex: 0, recognitionStatus: "queued" }],
    };
    const importedWork: WorkListItem = {
      ...existingWork,
      id: "imported",
      title: "Imported score",
      sourceType: "musicxml",
      status: "ready",
      pages: [],
    };
    let finishRefresh!: (response: Response) => void;
    const pendingRefresh = new Promise<Response>((resolve) => { finishRefresh = resolve; });
    global.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? Promise.resolve(Response.json({ works: [importedWork, existingWork] }))
        : pendingRefresh,
    ) as typeof fetch;
    vi.useFakeTimers();

    try {
      render(<ImportForm initialWorks={[existingWork]} />);
      if (refreshMode === "manual") {
        fireEvent.click(screen.getByRole("button", { name: "刷新状态" }));
      } else {
        await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      }
      expect(global.fetch).toHaveBeenCalledTimes(1);

      fireEvent.change(screen.getByLabelText("上传 MusicXML"), {
        target: { files: [createFile("new.musicxml", "application/xml")] },
      });
      await act(async () => {
        fireEvent.submit(screen.getByLabelText("作品标题（可选）").closest("form")!);
      });
      expect(screen.getByText("Imported score")).toBeInTheDocument();

      await act(async () => { finishRefresh(Response.json({ works: [existingWork] })); });
      expect(screen.getByText("Imported score")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not restore a deleted work from a stale refresh", async () => {
    const existingWork: WorkListItem = {
      id: "existing",
      title: "Existing score",
      sourceType: "musicxml",
      pageCount: 1,
      status: "ready",
      lastPracticedAt: null,
      pages: [],
    };
    let finishRefresh!: (response: Response) => void;
    const pendingRefresh = new Promise<Response>((resolve) => { finishRefresh = resolve; });
    global.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === "DELETE"
        ? Promise.resolve(Response.json({ works: [] }))
        : pendingRefresh,
    ) as typeof fetch;

    render(<ImportForm initialWorks={[existingWork]} />);
    fireEvent.click(screen.getByRole("button", { name: "刷新状态" }));
    fireEvent.click(screen.getByRole("button", { name: "删除 Existing score" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => { expect(screen.queryByText("Existing score")).not.toBeInTheDocument(); });
    await act(async () => { finishRefresh(Response.json({ works: [existingWork] })); });

    expect(screen.queryByText("Existing score")).not.toBeInTheDocument();
  });

  it("shows a fallback message when the import request fails without a JSON body", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 500,
      }),
    ) as typeof fetch;

    render(<ImportForm initialWorks={[]} />);

    fireEvent.change(screen.getByLabelText("上传 MusicXML"), {
      target: {
        files: [createFile("broken.mxl", "application/vnd.recordare.musicxml")],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "开始导入" }));

    await waitFor(() => {
      expect(
        screen.getByText("导入失败，请稍后再试。"),
      ).toBeInTheDocument();
    });
  });

  it("renders the saved work list", () => {
    const initialWorks: WorkListItem[] = [
      {
        id: "work_1",
        title: "Moon River",
        sourceType: "pdf",
        pageCount: 4,
        status: "ready",
        lastPracticedAt: "2026-03-23T10:00:00.000Z",
        pages: [
          {
            id: "page_1",
            pageIndex: 0,
            recognitionStatus: "succeeded",
          },
        ],
      },
    ];

    render(<ImportForm initialWorks={initialWorks} />);

    expect(screen.getAllByText("Moon River")).toHaveLength(1);
    expect(screen.getByText(/4 页/)).toBeInTheDocument();
    expect(screen.queryByText("可以开始")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "继续查看：Moon River" })).toHaveAttribute(
      "href",
      "/works/work_1",
    );
  });

  it("keeps one entry per score with a link to resume viewing", () => {
    const initialWorks: WorkListItem[] = [
      {
        id: "work_resume",
        title: "Gymnopédie",
        sourceType: "musicxml",
        pageCount: 4,
        status: "ready",
        lastPracticedAt: "2026-07-14T08:30:00.000Z",
        lastPageIndex: 2,
        lastObjectId: "object_18",
        lastMeasure: 18,
        instrumentMode: "guitar",
        pages: [
          {
            id: "page_3",
            pageIndex: 2,
            recognitionStatus: "succeeded",
          },
        ],
      },
    ];

    render(<ImportForm initialWorks={initialWorks} />);

    expect(screen.getByRole("heading", { name: "我的乐谱" })).toBeInTheDocument();
    expect(screen.getAllByText("Gymnopédie")).toHaveLength(1);
    expect(screen.queryByText("第 3 页 · 第 18 小节 · 吉他")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "继续查看：Gymnopédie" })).toHaveAttribute(
      "href",
      "/works/work_resume",
    );
  });

  it("keeps image-based works concise while preserving their viewing link", () => {
    render(
      <ImportForm
        initialWorks={[
          {
            id: "work-image-progress",
            title: "练习页",
            sourceType: "images",
            pageCount: 3,
            status: "ready",
            lastPracticedAt: "2026-07-14T08:30:00.000Z",
            lastPageIndex: 1,
            lastObjectId: "object-2",
            lastMeasure: 12,
            instrumentMode: "piano",
            pages: [],
          },
        ]}
      />,
    );

    expect(screen.getByText("3 页")).toBeInTheDocument();
    expect(screen.queryByText("看到第 2 页 · 第 12 小节")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "继续查看：练习页" })).toHaveAttribute(
      "href",
      "/works/work-image-progress",
    );
  });

  it("marks failed MusicXML imports as issues to inspect instead of ready-to-view works", () => {
    const initialWorks: WorkListItem[] = [
      {
        id: "work_failed",
        title: "突然好想你",
        sourceType: "musicxml",
        pageCount: 5,
        status: "failed",
        lastPracticedAt: "2026-03-27T15:46:21.599Z",
        pages: [
          {
            id: "page_1",
            pageIndex: 0,
            recognitionStatus: "succeeded",
          },
        ],
      },
    ];

    render(<ImportForm initialWorks={initialWorks} />);

    expect(
      screen.getByText("未找到可点击音符，可重新导入。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看问题：突然好想你" })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /^继续查看/ }),
    ).not.toBeInTheDocument();
  });

  it("keeps privacy and storage information in one optional disclosure", () => {
    render(<ImportForm initialWorks={[]} />);

    const privacySummary = screen.getByText("隐私与存储");
    expect(privacySummary.closest("details")).not.toHaveAttribute("open");
    fireEvent.click(privacySummary);

    expect(
      screen.getByText(/本机交给 Audiveris 识别，不会发送给 AI 模型/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Audiveris 5.11/i }),
    ).toHaveAttribute("href", "https://github.com/Audiveris/audiveris/releases");
    expect(
      screen.getByText(/作品数据默认保存在本机磁盘/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/可以在本地删除已缓存作品/i),
    ).toBeInTheDocument();
  });

  it("deletes a saved work locally", async () => {
    const initialWorks: WorkListItem[] = [
      {
        id: "work_1",
        title: "Moon River",
        sourceType: "pdf",
        pageCount: 4,
        status: "ready",
        lastPracticedAt: "2026-03-23T10:00:00.000Z",
        pages: [
          {
            id: "page_1",
            pageIndex: 0,
            recognitionStatus: "succeeded",
          },
        ],
      },
    ];

    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ works: [] }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    ) as typeof fetch;

    render(<ImportForm initialWorks={initialWorks} />);

    fireEvent.click(screen.getByRole("button", { name: "删除 Moon River" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    const [requestUrl, requestInit] = vi.mocked(global.fetch).mock.calls[0];

    expect(requestUrl).toBe("/api/works/work_1");
    expect(requestInit?.method).toBe("DELETE");

    await waitFor(() => {
      expect(screen.queryByText("Moon River")).not.toBeInTheDocument();
    });
  });

  it("moves focus into delete confirmation and restores it on cancel", async () => {
    render(
      <ImportForm
        initialWorks={[
          {
            id: "work_focus",
            title: "Moon River",
            sourceType: "musicxml",
            pageCount: 1,
            status: "ready",
            lastPracticedAt: null,
            pages: [],
          },
        ]}
      />,
    );

    const deleteButton = screen.getByRole("button", { name: "删除 Moon River" });

    deleteButton.focus();
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "取消" })).toHaveFocus();
    });

    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "删除 Moon River" })).toHaveFocus();
    });
  });

  it("keeps a work and shows the delete error beside the work list", async () => {
    const initialWorks: WorkListItem[] = [
      {
        id: "work_1",
        title: "Moon River",
        sourceType: "pdf",
        pageCount: 1,
        status: "ready",
        lastPracticedAt: null,
        pages: [],
      },
    ];

    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 500 })) as typeof fetch;

    render(<ImportForm initialWorks={initialWorks} />);

    fireEvent.click(screen.getByRole("button", { name: "删除 Moon River" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    expect(
      await screen.findByText("删除作品失败，请稍后再试。"),
    ).toBeInTheDocument();
    expect(screen.getByText("Moon River")).toBeInTheDocument();
  });
});
