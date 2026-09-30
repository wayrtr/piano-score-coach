import { render, screen } from "@testing-library/react";

import { InstrumentPanel } from "@/components/practice/instrument-panel";

vi.mock("@/components/practice/keyboard", () => ({
  Keyboard: ({
    highlightedNotes,
    previewNotes,
    compact,
  }: {
    highlightedNotes: readonly string[];
    previewNotes: readonly string[];
    compact?: boolean;
  }) => (
    <div aria-label="钢琴键盘">
      {`${highlightedNotes.join(",") || "none"}|next:${previewNotes.join(",") || "none"}|compact:${compact === true}`}
    </div>
  ),
}));

vi.mock("@/components/practice/guitar-fretboard", () => ({
  GuitarFretboard: ({
    notes,
    previewNotes,
  }: {
    notes: readonly string[];
    previewNotes: readonly string[];
  }) => (
    <div aria-label="吉他指板">
      {`${notes.join(",")}|next:${previewNotes.join(",")}`}
    </div>
  ),
}));

describe("InstrumentPanel", () => {
  it("renders piano mode as a pure reference display", () => {
    render(
      <InstrumentPanel
        instrumentMode="piano"
        highlightedNotes={["E4"]}
        previewNotes={["G4"]}
      />
    );

    expect(screen.getByLabelText("钢琴键盘")).toBeInTheDocument();
    expect(screen.getByLabelText("钢琴键盘")).toHaveTextContent(
      "E4|next:G4|compact:true",
    );
    expect(screen.queryByLabelText("吉他指板")).not.toBeInTheDocument();
  });

  it("renders guitar mode as a pure reference display", () => {
    render(
      <InstrumentPanel
        instrumentMode="guitar"
        highlightedNotes={["E4", "G#4", "B4"]}
        previewNotes={["D5"]}
      />
    );

    expect(screen.getByLabelText("吉他指板")).toHaveTextContent(
      "E4,G#4,B4|next:D5",
    );
  });
});
