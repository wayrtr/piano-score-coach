import { render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import { GuitarFretboard } from "@/components/practice/guitar-fretboard";
import { getGuitarGuidanceForNotes } from "@/lib/music/guitar";

vi.mock("@/lib/music/guitar", () => ({
  STANDARD_TUNING: {
    1: "E4",
    2: "B3",
    3: "G3",
    4: "D3",
    5: "A2",
    6: "E2",
  },
  getGuitarGuidanceForNotes: vi.fn(() => ({
    recommended: {
      status: "approximate",
      positions: [
        { stringNumber: 1, fret: 5, midi: 76, noteName: "E5" },
        { stringNumber: 2, fret: 5, midi: 72, noteName: "C5" },
      ],
      rootNote: "E5",
      message: "推荐形状跨度较大，仅作参考",
    },
    allPositions: new Map([
      [
        "E5",
        [
          { stringNumber: 1, fret: 12, midi: 76, noteName: "E5" },
          { stringNumber: 2, fret: 5, midi: 76, noteName: "E5" },
        ],
      ],
      [
        "C5",
        [{ stringNumber: 2, fret: 1, midi: 72, noteName: "C5" }],
      ],
    ]),
  })),
}));

function makeRect(left: number, right: number): DOMRect {
  return {
    left,
    right,
    top: 0,
    bottom: 0,
    width: right - left,
    height: 0,
    x: left,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("GuitarFretboard", () => {
  it("renders an empty state when no notes are selected", () => {
    render(<GuitarFretboard notes={[]} />);

    expect(
      screen.getByText("点一个音或和弦，下面会显示吉他指板参考。"),
    ).toBeInTheDocument();
  });

  it("shows the recommended shape and fallback message in recommended mode", () => {
    render(<GuitarFretboard notes={["E5", "C5"]} />);

    expect(screen.getByText("推荐形状跨度较大，仅作参考")).toBeInTheDocument();
    expect(screen.getByText("1弦·5品")).toBeInTheDocument();
    expect(screen.getByText("2弦·5品")).toBeInTheDocument();
    expect(screen.queryByText("展开全指板")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("第 1 弦第 5 品 E5")).not.toBeInTheDocument();
  });

  it("marks the next score event separately from the current shape", () => {
    const { container } = render(
      <GuitarFretboard
        notes={["E5"]}
        previewNotes={["C5"]}
       
      />,
    );

    const previewLabel = container.querySelector(".instrument-preview-label");
    expect(previewLabel).toHaveTextContent("下一音");
    expect(previewLabel).toHaveTextContent("C5");
    expect(
      container.querySelectorAll('[data-note-role="current"]'),
    ).not.toHaveLength(0);
    expect(
      container.querySelectorAll('[data-note-role="preview"]'),
    ).not.toHaveLength(0);
  });

  it("gives every visible pitch one color across current and preview", () => {
    const { container } = render(
      <GuitarFretboard notes={["E5", "C5"]} previewNotes={["C5"]} />,
    );

    // Current shape: E5 and C5 are different notes → different swatches.
    const e5Marker = container.querySelector(
      '[data-note-role="current"][data-note-color]',
    );
    const currentColors = [
      ...container.querySelectorAll('[data-note-role="current"].guitar-fret-marker'),
    ].map((el) => el.getAttribute("data-note-color"));
    expect(e5Marker).not.toBeNull();
    expect(new Set(currentColors).size).toBe(currentColors.length);

    // C5 keeps color 1 when it also appears in preview; only the marker style
    // changes from solid to outline.
    const c5PreviewPill = [
      ...container.querySelectorAll(".guitar-compact-pill.is-preview"),
    ].find((pill) => pill.textContent?.includes("C5"));
    expect(c5PreviewPill).toHaveAttribute("data-note-color", "1");
  });

  it("shows custom open-string pitches in player-view order", () => {
    const { container } = render(
      <GuitarFretboard
        notes={["E5"]}
       
        tuning={{ 1: "D4", 2: "A3", 3: "F3", 4: "C3", 5: "G2", 6: "D2" }}
      />,
    );

    const labels = Array.from(
      container.querySelectorAll<HTMLElement>(".guitar-string-label small"),
    ).map((label) => label.textContent);

    expect(labels).toEqual([
      "D4 空弦",
      "A3 空弦",
      "F3 空弦",
      "C3 空弦",
      "G2 空弦",
      "D2 空弦",
    ]);
  });

  it("shows the strings from 1 to 6 in the player's view", () => {
    render(<GuitarFretboard notes={["E5", "C5"]} />);

    const fretboard = screen.getByRole("img", {
      name: "吉他音符位置图",
    });
    const stringLabels = Array.from(
      fretboard.querySelectorAll<HTMLElement>(".guitar-string-label"),
    );

    expect(stringLabels.map((label) => label.dataset.stringNumber)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
    ]);

    expect(
      Array.from(fretboard.querySelectorAll<HTMLElement>(".guitar-fret-number")).map(
        (fret) => fret.dataset.fret,
      ),
    ).toEqual(Array.from({ length: 13 }, (_, fret) => String(fret)));
  });

  it("shows a specific guidance error when no recommended position exists", () => {
    vi.mocked(getGuitarGuidanceForNotes).mockReturnValue({
      recommended: {
        status: "unavailable",
        positions: [],
        rootNote: null,
        message: "无法识别音符：H4",
      },
      allPositions: new Map(),
    });

    render(<GuitarFretboard notes={["H4"]} />);

    expect(screen.getByText("无法识别音符：H4")).toBeInTheDocument();
  });

  it("keeps the board visible for a multi-note chord with a partial recommendation", () => {
    vi.mocked(getGuitarGuidanceForNotes).mockReturnValue({
      recommended: {
        status: "approximate",
        positions: [
          { stringNumber: 2, fret: 10, midi: 69, noteName: "A4" },
          { stringNumber: 1, fret: 9, midi: 73, noteName: "C#5" },
        ],
        rootNote: "A4",
        message: "无法组成完整把位，以下显示可用参考位置；未覆盖：E5",
      },
      allPositions: new Map([
        [
          "A4",
          [{ stringNumber: 2, fret: 10, midi: 69, noteName: "A4" }],
        ],
        [
          "C#5",
          [{ stringNumber: 1, fret: 9, midi: 73, noteName: "C#5" }],
        ],
        [
          "E5",
          [{ stringNumber: 1, fret: 12, midi: 76, noteName: "E5" }],
        ],
      ]),
    });

    render(
      <GuitarFretboard
        notes={["A4", "C#5", "E5"]}
       
      />,
    );

    expect(
      screen.getByRole("img", { name: "吉他音符位置图" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("逐音位置，不能同时按下"),
    ).toBeInTheDocument();
    expect(screen.getByText("2弦·10品")).toBeInTheDocument();
    expect(screen.getByText("1弦·9品")).toBeInTheDocument();
    expect(screen.getByText("1弦·12品")).toBeInTheDocument();
  });

  it("auto-scrolls recommended markers into the visible fretboard range", async () => {
    const { container, rerender } = render(
      <GuitarFretboard notes={["E5", "C5"]} />,
    );
    const scrollShell = container.querySelector(
      ".guitar-recommended-board .guitar-fretboard-shell",
    ) as HTMLDivElement;
    const fretboard = container.querySelector(
      ".guitar-fretboard-grid",
    ) as HTMLDivElement;
    const scrollTo = vi.fn();
    const getBoundingClientRectSpy = vi.spyOn(
      HTMLElement.prototype,
      "getBoundingClientRect",
    );

    Object.defineProperty(scrollShell, "clientWidth", {
      configurable: true,
      value: 282,
    });
    Object.defineProperty(fretboard, "scrollWidth", {
      configurable: true,
      value: 540,
    });
    Object.defineProperty(scrollShell, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });
    getBoundingClientRectSpy.mockImplementation(function mockRect(this: HTMLElement) {
      if (this === fretboard) {
        return makeRect(940, 1480);
      }

      if ((this as HTMLElement).dataset?.fret === "7") {
        return makeRect(1267, 1304);
      }

      if ((this as HTMLElement).dataset?.fret === "1") {
        return makeRect(1040, 1077);
      }

      if ((this as HTMLElement).dataset?.fret === "0") {
        return makeRect(1004, 1041);
      }

      if ((this as HTMLElement).dataset?.fret === "12") {
        return makeRect(1443, 1480);
      }

      return makeRect(0, 0);
    });
    vi.mocked(getGuitarGuidanceForNotes).mockReturnValue({
      recommended: {
        status: "ideal",
        positions: [
          { stringNumber: 3, fret: 7, midi: 62, noteName: "D4" },
          { stringNumber: 2, fret: 7, midi: 66, noteName: "F#4" },
        ],
        rootNote: "D4",
        message: null,
      },
      allPositions: new Map(),
    });

    rerender(
      <GuitarFretboard notes={["D4", "F#4"]} />,
    );

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith({
        left: 205,
        behavior: "smooth",
      });
    });

    scrollTo.mockClear();
    vi.mocked(getGuitarGuidanceForNotes).mockReturnValue({
      recommended: {
        status: "ideal",
        positions: [
          { stringNumber: 2, fret: 1, midi: 60, noteName: "C4" },
        ],
        rootNote: "C4",
        message: null,
      },
      allPositions: new Map(),
    });

    rerender(<GuitarFretboard notes={["C4"]} />);

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith({
        left: 0,
        behavior: "smooth",
      });
    });

    scrollTo.mockClear();
    vi.mocked(getGuitarGuidanceForNotes).mockReturnValue({
      recommended: {
        status: "approximate",
        positions: [
          { stringNumber: 6, fret: 0, midi: 40, noteName: "E2" },
          { stringNumber: 1, fret: 12, midi: 76, noteName: "E5" },
        ],
        rootNote: "E2",
        message: "推荐形状跨度较大，仅作参考",
      },
      allPositions: new Map(),
    });

    rerender(
      <GuitarFretboard notes={["E2", "E5"]} />,
    );

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith({
        left: 0,
        behavior: "smooth",
      });
    });

    getBoundingClientRectSpy.mockRestore();
  });
});
