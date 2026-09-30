import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

import { TheoryPanel } from "@/components/practice/theory-panel";
import type { PracticeScoreObject } from "@/lib/practice/types";

const selectedChord: PracticeScoreObject = {
  id: "obj_page_1_low",
  type: "chord",
  bbox: { x: 320, y: 480, width: 60, height: 50 },
  staff: "grand",
  measure: 4,
  notes: ["C4", "E4", "G4"],
  confidence: 0.42,
  source: "model",
};

const previousNote: PracticeScoreObject = {
  id: "obj_page_1_prev",
  type: "note",
  bbox: { x: 220, y: 420, width: 40, height: 40 },
  staff: "treble",
  measure: 3,
  notes: ["E4"],
  confidence: 0.97,
  source: "model",
};

const currentNote: PracticeScoreObject = {
  id: "obj_page_1_curr",
  type: "note",
  bbox: { x: 260, y: 420, width: 40, height: 40 },
  staff: "treble",
  measure: 3,
  notes: ["G4"],
  confidence: 0.98,
  source: "model",
};

describe("TheoryPanel", () => {
  it("keeps the secondary theory inspector collapsed until requested", () => {
    render(<TheoryPanel currentKey="C major" selectedObject={selectedChord} />);

    const summary = screen.getByText("当前音与调性").closest("summary");
    const details = summary?.parentElement;

    expect(details).not.toHaveAttribute("open");
    expect(screen.getByText("点开查看")).toBeInTheDocument();

    if (!summary) {
      throw new Error("未找到乐理面板展开按钮");
    }

    fireEvent.click(summary);

    expect(screen.getByText("收起")).toBeInTheDocument();
  });

  it("groups the expanded content as one theory reference workspace", () => {
    render(<TheoryPanel currentKey="C major" selectedObject={selectedChord} />);

    const summary = screen.getByText("当前音与调性").closest("summary");

    if (!summary) {
      throw new Error("未找到乐理面板展开按钮");
    }

    fireEvent.click(summary);

    expect(
      screen.getByRole("group", { name: "乐理参考工具" }),
    ).toBeInTheDocument();
  });

  it("uses readable Chinese labels for staff names", () => {
    render(
      <TheoryPanel
        currentKey="C major"
        selectedObject={{
          id: "object-staff",
          type: "note",
          bbox: { x: 0, y: 0, width: 1, height: 1 },
          staff: "treble",
          measure: 1,
          notes: ["C4"],
          confidence: 1,
          source: "model",
        }}
      />,
    );

    const summary = screen.getByText("当前音与调性").closest("summary");

    if (!summary) {
      throw new Error("未找到乐理面板展开按钮");
    }

    fireEvent.click(summary);
    expect(screen.getByText("谱表：高音谱表")).toBeInTheDocument();
  });

  it("renders major and natural minor theory locally", () => {
    const { rerender } = render(
      <TheoryPanel currentKey="E major" selectedObject={selectedChord} />,
    );

    expect(screen.getByText("E - F# - G# - A - B - C# - D#")).toBeInTheDocument();
    expect(screen.getByText("I: E - G# - B")).toBeInTheDocument();
    expect(screen.getByText("V7: B - D# - F# - A")).toBeInTheDocument();

    rerender(<TheoryPanel currentKey="A minor" selectedObject={selectedChord} />);

    expect(screen.getByText("A - B - C - D - E - F - G")).toBeInTheDocument();
    expect(screen.getByText("i: A - C - E")).toBeInTheDocument();
    expect(screen.getByText("VII7: G - B - D - F")).toBeInTheDocument();
  });

  it("persists a manual key change and survives a reload cycle", async () => {
    let storedKey = "C major";

    function Harness() {
      const [currentKey, setCurrentKey] = useState(storedKey);

      return (
        <TheoryPanel
          currentKey={currentKey}
          selectedObject={selectedChord}
          onSaveKey={async (nextKey) => {
            storedKey = nextKey;
            setCurrentKey(nextKey);
          }}
        />
      );
    }

    const { unmount } = render(<Harness />);

    fireEvent.change(screen.getByLabelText("当前调"), {
      target: {
        value: "A minor",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存调性" }));

    await waitFor(() => {
      expect(screen.getByText("A - B - C - D - E - F - G")).toBeInTheDocument();
    });

    unmount();
    render(<Harness />);

    expect(screen.getByDisplayValue("A minor")).toBeInTheDocument();
    expect(screen.getByText("A - B - C - D - E - F - G")).toBeInTheDocument();
  });

  it("looks up interval names from semitone counts", () => {
    render(<TheoryPanel currentKey="C major" selectedObject={selectedChord} />);

    expect(screen.getByDisplayValue("4")).toBeInTheDocument();
    expect(screen.getByText("大三度")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("半音数"), {
      target: {
        value: "7",
      },
    });

    expect(screen.getByText("纯五度")).toBeInTheDocument();
  });

  it("shows the linked interval between the previous and current selected notes", () => {
    render(
      <TheoryPanel
        currentKey="C major"
        previousSelectedObject={previousNote}
        selectedObject={currentNote}
      />,
    );

    expect(screen.getByText("E4 -> G4")).toBeInTheDocument();
    expect(screen.getByText("上行 · 小三度 · 3 半音")).toBeInTheDocument();
  });
});
