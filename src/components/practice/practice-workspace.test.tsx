import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import type { ReactNode } from "react";

import { PracticeWorkspace } from "@/components/practice/practice-workspace";
import type { GuitarTuning } from "@/lib/music/guitar";
import type { PracticeWorkDetail } from "@/lib/works/practice";

vi.mock("react-liquid-glass-svg", () => ({
  LiquidGlass: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

vi.mock("@/components/practice/score-view", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/practice/score-view")>(),
  ScoreView: ({
    selectedObjectId,
    selectedObjectIds = [],
    previewObjectIds = [],
    noteColors,
    currentPageIndex,
    pages,
    onSelectObject,
    onPageChange,
  }: {
    selectedObjectId: string | null;
    selectedObjectIds?: readonly string[];
    previewObjectIds?: readonly string[];
    noteColors?: ReadonlyMap<number, number>;
    currentPageIndex: number;
    pages: PracticeWorkDetail["pages"];
    onSelectObject: (selection: { pageIndex: number; objectId: string }) => void;
    onPageChange: (pageIndex: number) => void;
  }) => (
    <div data-testid="score-view">
      <div data-testid="score-selection">{selectedObjectId ?? "none"}</div>
      <div data-testid="score-highlights">{selectedObjectIds.join(",") || "none"}</div>
      <div data-testid="score-preview">{previewObjectIds.join(",") || "none"}</div>
      <div data-testid="score-page">{currentPageIndex}</div>
      <div data-testid="score-colors">{JSON.stringify([...(noteColors ?? [])])}</div>
      {pages.map((page) => (
        <button key={page.id} type="button" onClick={() => onPageChange(page.pageIndex)}>
          {`查看第 ${page.pageIndex + 1} 页`}
        </button>
      ))}
      {pages.find((page) => page.pageIndex === currentPageIndex)?.objects.map((object) => (
        <button key={object.id} type="button" data-score-object-id={object.id}
          onClick={() => onSelectObject({ pageIndex: currentPageIndex, objectId: object.id })}>
          {`选择对象 ${object.id}`}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("@/components/practice/keyboard", () => ({
  Keyboard: ({ highlightedNotes = [], previewNotes = [], noteColors }: {
    highlightedNotes?: readonly string[];
    previewNotes?: readonly string[];
    noteColors?: ReadonlyMap<number, number>;
  }) => (
    <div data-testid="keyboard">
      <div data-testid="instrument-notes">{highlightedNotes.join(",") || "none"}</div>
      <div data-testid="instrument-preview">{previewNotes.join(",") || "none"}</div>
      <div data-testid="instrument-colors">{JSON.stringify([...(noteColors ?? [])])}</div>
    </div>
  ),
}));

vi.mock("@/components/practice/guitar-fretboard", () => ({
  GuitarFretboard: ({ notes, previewNotes = [], tuning }: {
    notes: readonly string[];
    previewNotes?: readonly string[];
    tuning?: GuitarTuning;
  }) => (
    <div data-testid="guitar-fretboard">
      <div data-testid="instrument-notes">{notes.join(",") || "none"}</div>
      <div data-testid="instrument-preview">{previewNotes.join(",") || "none"}</div>
      <div data-testid="sixth-string">{tuning?.[6]}</div>
    </div>
  ),
}));

const workFixture: PracticeWorkDetail = {
  id: "work_1",
  title: "Moon River",
  sourceType: "musicxml",
  status: "ready",
  currentKey: "C major",
  manualKeyOverride: false,
  pageCount: 1,
  lastPracticedAt: null,
  practiceState: {
    lastPageIndex: 0,
    lastObjectId: "mxo-m0001-s1-v1-o0001",
    lastMeasure: 1,
    instrumentMode: "piano",
    guitarViewMode: "recommended",
  },
  pages: [
    {
      id: "mx_page_1",
      pageIndex: 0,
      renderMode: "musicxml",
      musicXmlSrc: "/api/works/work_1/musicxml",
      measureStart: 1,
      measureEnd: 4,
      recognitionStatus: "succeeded",
      recognizedAt: null,
      sourceFileRef: "piece.musicxml",
      recognition: null,
        objects: [
          {
            id: "mxo-m0001-s1-v1-o0001",
            type: "note",
            bbox: { x: 0, y: 0, width: 1, height: 1 },
            staff: "treble",
            measure: 1,
            notes: ["E4"],
            confidence: 1,
            source: "model",
          },
          {
            id: "mxo-m0002-s1-v1-o0001",
            type: "note",
            bbox: { x: 0, y: 0, width: 1, height: 1 },
            staff: "treble",
            measure: 2,
            notes: ["G4"],
            confidence: 1,
            source: "model",
          },
        ],
      },
  ],
};

const grandStaffEventFixture: PracticeWorkDetail = {
  ...workFixture,
  practiceState: {
    ...workFixture.practiceState!,
    lastObjectId: "treble_now",
  },
  pages: [
    {
      ...workFixture.pages[0]!,
      objects: [
        {
          id: "treble_now",
          type: "note",
          bbox: { x: 10, y: 10, width: 1, height: 1 },
          staff: "treble",
          measure: 1,
          onset: 0,
          notes: ["E4"],
          confidence: 1,
          source: "model",
        },
        {
          id: "bass_now",
          type: "note",
          bbox: { x: 10, y: 100, width: 1, height: 1 },
          staff: "bass",
          measure: 1,
          onset: 0,
          notes: ["C3"],
          confidence: 1,
          source: "model",
        },
        {
          id: "treble_next",
          type: "note",
          bbox: { x: 20, y: 10, width: 1, height: 1 },
          staff: "treble",
          measure: 1,
          onset: 4,
          notes: ["G4"],
          confidence: 1,
          source: "model",
        },
        {
          id: "bass_next",
          type: "note",
          bbox: { x: 20, y: 100, width: 1, height: 1 },
          staff: "bass",
          measure: 1,
          onset: 4,
          notes: ["D3"],
          confidence: 1,
          source: "model",
        },
      ],
    },
  ],
};

async function renderWorkspace(work: PracticeWorkDetail = workFixture) {
  let result!: ReturnType<typeof render>;
  await act(async () => { result = render(<PracticeWorkspace initialWork={work} />); });
  return result;
}

function openOptions() {
  fireEvent.click(screen.getByRole("button", { name: "吉他调弦" }));
  return screen.getByRole("dialog", { name: "吉他调弦" });
}

async function advanceTime(milliseconds: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
}

function expectSelection(objectId: string | null, notes: readonly string[]) {
  expect(screen.getByTestId("score-selection").textContent).toBe(objectId ?? "none");
  expect(screen.getByTestId("score-highlights").textContent).toBe(objectId ?? "none");
  expect(screen.getByTestId("instrument-notes").textContent).toBe(notes.join(",") || "none");
  expect(screen.getByTestId("score-preview").textContent).toBe("none");
  expect(screen.getByTestId("instrument-preview").textContent).toBe("none");
}

describe("PracticeWorkspace lookup", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    // jsdom does not implement the native dialog lifecycle.
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) { this.open = true; }),
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) {
        this.open = false;
        this.dispatchEvent(new Event("close"));
      }),
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(async () => {
    await act(async () => { cleanup(); });
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  });

  it("keeps the score, result, and real instrument switch on the main screen", async () => {
    const { container } = await renderWorkspace();
    const workbench = container.querySelector(".practice-workbench");
    const result = screen.getByRole("complementary", { name: "键位查询结果" });
    const switcher = screen.getByRole("group", { name: "查看乐器" });
    const options = container.querySelector("dialog");

    expect(workbench).toContainElement(screen.getByTestId("score-view"));
    expect(workbench).toContainElement(result);
    expect(result).toContainElement(switcher);
    expect(result).toContainElement(screen.getByTestId("keyboard"));
    expect(options).toBeNull();
    expect(screen.queryByRole("button", { name: "查看选项" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "外观：跟随系统（点击切换）" }).closest(".practice-focus-header")).not.toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1, name: "Moon River" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "回到我的谱子" })).toHaveAttribute("href", "/");
    const header = container.querySelector(".practice-focus-header");
    expect(header).toHaveTextContent("起始调号C大调 / A小调无升降号");
    expect(header).toContainElement(screen.getByRole("group", { name: "谱面控制" }));
    expect(workbench?.querySelector(".practice-toolbar")).toBeNull();
    expect(screen.getByRole("button", { name: "钢琴" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "吉他" }));
    expect(screen.getByRole("button", { name: "吉他" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("guitar-fretboard")).toBeInTheDocument();
    expectSelection("mxo-m0001-s1-v1-o0001", ["E4"]);
    fireEvent.click(screen.getByRole("button", { name: "钢琴" }));
    expect(screen.getByTestId("keyboard")).toBeInTheDocument();
  });

  it("shows the imported score's two-sharp key signature beside its title", async () => {
    await renderWorkspace({ ...workFixture, currentKey: "D major" });
    expect(screen.getByLabelText("起始调号：D大调 / B小调，2♯")).toBeInTheDocument();
  });

  it("does not claim a default key for an unverified PDF", async () => {
    await renderWorkspace({ ...workFixture, sourceType: "pdf", currentKey: "C major" });
    expect(screen.getByLabelText("调号：待确认")).toBeInTheDocument();
    expect(screen.queryByText("C大调 / A小调")).not.toBeInTheDocument();
  });

  it("omits practice controls and leaves Space and Escape unclaimed", async () => {
    const { container } = await renderWorkspace();
    expect(fireEvent.keyDown(window, { key: " " })).toBe(true);
    expect(fireEvent.keyDown(window, { key: "Escape" })).toBe(true);
    expect(screen.queryByRole("button", { name: /^(播放|暂停|停止)$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "节拍器" })).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("速度（BPM）")).not.toBeInTheDocument();
    expect(screen.queryByText(/本页.*组|节拍器/)).not.toBeInTheDocument();
    expect(container.querySelector(".practice-transport-wrap")).toBeNull();
    expectSelection("mxo-m0001-s1-v1-o0001", ["E4"]);
  });

  it.each([null, "removed-object"])("waits for a click when the saved selection is %s", async (lastObjectId) => {
    await renderWorkspace({
      ...workFixture,
      practiceState: { ...workFixture.practiceState!, lastObjectId, lastMeasure: null },
    });
    expectSelection(null, []);
    expect(screen.getByText("点一下谱上的音符，查看对应位置")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "选择对象 mxo-m0002-s1-v1-o0001" }));
    expectSelection("mxo-m0002-s1-v1-o0001", ["G4"]);
  });

  it("starts without a selection when the work has no saved lookup", async () => {
    await renderWorkspace({ ...workFixture, practiceState: null });
    expectSelection(null, []);
  });

  it("restores a valid last lookup without fetching playback timing or samples", async () => {
    await renderWorkspace();
    expectSelection("mxo-m0001-s1-v1-o0001", ["E4"]);
    expect(fetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "选择对象 mxo-m0002-s1-v1-o0001" }));
    fireEvent.click(screen.getByRole("button", { name: "吉他" }));
    await advanceTime(300);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/works/work_1", expect.objectContaining({ method: "PATCH" }));
    expect(vi.mocked(fetch).mock.calls.every(([url, init]) =>
      url === "/api/works/work_1" && init?.method === "PATCH",
    )).toBe(true);
  });

  it("highlights only the clicked staff object and never combines simultaneous staves", async () => {
    await renderWorkspace(grandStaffEventFixture);
    expectSelection("treble_now", ["E4"]);
    expect(screen.getByTestId("score-colors").textContent).toBe("[[64,0]]");
    expect(screen.getByTestId("instrument-colors").textContent).toBe("[[64,0]]");

    fireEvent.click(screen.getByRole("button", { name: "选择对象 bass_now" }));
    expectSelection("bass_now", ["C3"]);
    expect(screen.getByTestId("score-colors").textContent).toBe("[[48,0]]");
    expect(screen.getByTestId("instrument-colors").textContent).toBe("[[48,0]]");
  });

  it("keeps every note in a clicked chord without adding the other staff", async () => {
    const page = grandStaffEventFixture.pages[0];
    await renderWorkspace({
      ...grandStaffEventFixture,
      pages: [{ ...page, objects: page.objects.map((object) =>
        object.id === "treble_now" ? { ...object, type: "chord", notes: ["E4", "G4"] } : object,
      ) }],
    });
    expectSelection("treble_now", ["E4", "G4"]);
  });

  it("clears the selection on page changes and saves the empty query position", async () => {
    await renderWorkspace({
      ...workFixture,
      pageCount: 2,
      pages: [workFixture.pages[0], {
        ...workFixture.pages[0], id: "page_2", pageIndex: 1,
        objects: [{ ...workFixture.pages[0].objects[0], id: "page_2_note", measure: 5 }],
      }],
    });
    fireEvent.click(screen.getByRole("button", { name: "查看第 2 页" }));
    expect(screen.getByTestId("score-page")).toHaveTextContent("1");
    expectSelection(null, []);
    await advanceTime(300);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).toMatchObject({
      lastPageIndex: 1, lastObjectId: null, lastMeasure: null,
    });

    fireEvent.click(screen.getByRole("button", { name: "选择对象 page_2_note" }));
    expectSelection("page_2_note", ["E4"]);
    expect(screen.getByText("第 5 小节")).toBeInTheDocument();
  });

  it("saves the last queried note and instrument using the existing backend fields", async () => {
    await renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "选择对象 mxo-m0002-s1-v1-o0001" }));
    fireEvent.click(screen.getByRole("button", { name: "吉他" }));
    await advanceTime(300);

    const [url, request] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/works/work_1");
    expect(request).toMatchObject({ method: "PATCH", keepalive: true });
    expect(JSON.parse(request?.body as string)).toMatchObject({
      lastPageIndex: 0,
      lastObjectId: "mxo-m0002-s1-v1-o0001",
      lastMeasure: 2,
      instrumentMode: "guitar",
      guitarViewMode: "recommended",
      observedAt: expect.any(String),
    });
  });

  it("persists an instrument change even without selecting another note", async () => {
    await renderWorkspace();
    await advanceTime(300);
    vi.mocked(fetch).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "吉他" }));
    await advanceTime(300);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).toMatchObject({
      instrumentMode: "guitar", lastObjectId: "mxo-m0001-s1-v1-o0001",
    });
  });

  it("keeps real guitar tuning controls mounted and persists tuning across closing options", async () => {
    await renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "吉他" }));
    const options = openOptions();
    const sixthString = screen.getByRole("combobox", { name: "第 6 弦调弦" });
    expect(sixthString).toHaveValue("E2");
    fireEvent.change(sixthString, { target: { value: "D2" } });
    expect(JSON.parse(window.localStorage.getItem("piano-score-coach:guitar-tuning") ?? "{}")).toMatchObject({ 6: "D2" });
    fireEvent.click(screen.getByRole("button", { name: "关闭吉他调弦" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(options).toContainElement(sixthString);
    expect(screen.getByTestId("sixth-string")).toHaveTextContent("D2");
    expect(screen.getByRole("group", { name: "查看乐器" })).toBeInTheDocument();
    expect(openOptions()).toBe(options);
    expect(screen.getByRole("combobox", { name: "第 6 弦调弦" })).toBe(sixthString);
    expect(sixthString).toHaveValue("D2");
  });

  it("finishes recognition without choosing a note and stops polling when ready", async () => {
    const readyWork: PracticeWorkDetail = { ...workFixture, sourceType: "pdf" };
    vi.mocked(fetch).mockResolvedValue({
      ok: true, json: async () => ({ work: readyWork }),
    } as Response);
    await renderWorkspace({
      ...readyWork, status: "processing",
      pages: [{ ...readyWork.pages[0], recognitionStatus: "recognizing", objects: [] }],
    });
    expectSelection(null, []);
    expect(screen.getByText("正在识别谱面，完成后就能点选音符。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "正在识别…" })).toBeDisabled();
    await advanceTime(2000);
    expectSelection(null, []);
    expect(screen.getByRole("button", { name: "重新识别整份谱面" })).toBeEnabled();
    const getCalls = () => vi.mocked(fetch).mock.calls.filter(([, init]) => !init?.method);
    expect(getCalls()).toHaveLength(1);
    await advanceTime(4000);
    expect(getCalls()).toHaveLength(1);
    expect(vi.mocked(fetch).mock.calls.every(([url, init]) =>
      url === "/api/works/work_1" && (!init?.method || init.method === "PATCH"),
    )).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "选择对象 mxo-m0001-s1-v1-o0001" }));
    expectSelection("mxo-m0001-s1-v1-o0001", ["E4"]);
  });

  it("exposes recognition retry directly for image imports", async () => {
    const pdfWork: PracticeWorkDetail = { ...workFixture, sourceType: "pdf", practiceState: null };
    const pendingWork: PracticeWorkDetail = {
      ...pdfWork, status: "processing",
      pages: [{ ...pdfWork.pages[0], recognitionStatus: "queued", objects: [] }],
    };
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ work: pendingWork }) } as Response);
    await renderWorkspace(pdfWork);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "重新识别整份谱面" }));
    });
    expect(fetch).toHaveBeenCalledWith("/api/works/work_1/pages/mx_page_1/rerun", { method: "POST" });
    expect(screen.getByRole("button", { name: "正在识别…" })).toBeDisabled();
    expectSelection(null, []);
  });

  it("moves the queried object with arrow keys while keeping staves separate", async () => {
    await renderWorkspace(grandStaffEventFixture);
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expectSelection("bass_now", ["C3"]);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expectSelection("treble_next", ["G4"]);
  });

  it("does not hijack arrow keys from tuning controls, the dialog, or the instrument switch", async () => {
    await renderWorkspace();
    const guitarButton = screen.getByRole("button", { name: "吉他" });
    expect(fireEvent.keyDown(guitarButton, { key: "ArrowRight" })).toBe(true);
    fireEvent.click(guitarButton);
    const options = openOptions();
    const tuning = screen.getByRole("combobox", { name: "第 6 弦调弦" });
    expect(fireEvent.keyDown(tuning, { key: "ArrowRight" })).toBe(true);
    expect(fireEvent.keyDown(options, { key: "ArrowRight" })).toBe(true);
    expect(fireEvent.keyDown(options, { key: "Escape" })).toBe(true);
    expectSelection("mxo-m0001-s1-v1-o0001", ["E4"]);
  });

  it("shows an actionable message for a MusicXML import with no clickable objects", async () => {
    await renderWorkspace({
      ...workFixture, status: "failed", practiceState: null,
      pages: [{ ...workFixture.pages[0], objects: [] }],
    });
    expect(screen.getByRole("alert")).toHaveTextContent("这份 MusicXML 导入缺少可点击音符对象");
    expect(screen.getByRole("link", { name: "回到首页重新导入" })).toHaveAttribute("href", "/");
    expectSelection(null, []);
  });
});

describe("touch note navigation", () => {
  afterEach(cleanup);
  it("offers previous/next and staff navigation with the same exact pitch selection", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    await renderWorkspace(grandStaffEventFixture);
    fireEvent.click(screen.getByRole("button", { name: "下一音" }));
    expectSelection("treble_next", ["G4"]);
    fireEvent.click(screen.getByRole("button", { name: "下方声部" }));
    expectSelection("bass_next", ["D3"]);
    fireEvent.click(screen.getByRole("button", { name: "上一音" }));
    expectSelection("treble_now", ["E4"]);
    fireEvent.click(screen.getByRole("button", { name: "下方声部" }));
    expectSelection("bass_now", ["C3"]);
    vi.unstubAllGlobals();
  });
});
