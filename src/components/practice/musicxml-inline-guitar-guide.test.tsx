import { render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { MusicXmlInlineGuitarGuide } from "@/components/practice/musicxml-inline-guitar-guide";
import { getGuitarGuidanceForNotes } from "@/lib/music/guitar";

vi.mock("@/lib/music/guitar", () => ({
  getGuitarGuidanceForNotes: vi.fn(() => ({
    recommended: {
      status: "ideal",
      positions: [{ stringNumber: 1, fret: 5, midi: 69, noteName: "A4" }],
      rootNote: "A4",
      message: null,
    },
    allPositions: new Map([
      [
        "A4",
        [
          { stringNumber: 1, fret: 5, midi: 69, noteName: "A4" },
          { stringNumber: 2, fret: 10, midi: 69, noteName: "A4" },
        ],
      ],
    ]),
  })),
}));

describe("MusicXmlInlineGuitarGuide", () => {
  it("renders a compact recommended strip for the current system", () => {
    render(<MusicXmlInlineGuitarGuide notes={["A4"]} />);

    expect(screen.getByLabelText("当前谱行吉他提示")).toBeInTheDocument();
    expect(screen.getByText("吉他 · 推荐把位")).toBeInTheDocument();
    expect(screen.getByText("A · 1弦 5品")).toBeInTheDocument();
    expect(screen.queryByText("A · 2弦 10品")).not.toBeInTheDocument();
  });

  it("renders the available subset for a multi-note recommendation", () => {
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
      allPositions: new Map(),
    });

    render(<MusicXmlInlineGuitarGuide notes={["A4", "C#5", "E5"]} />);

    expect(screen.getByText("A · 2弦 10品")).toBeInTheDocument();
    expect(screen.getByText("C# · 1弦 9品")).toBeInTheDocument();
    expect(screen.queryByText("当前音在前 12 品里没有可用位置")).not.toBeInTheDocument();
  });
});
