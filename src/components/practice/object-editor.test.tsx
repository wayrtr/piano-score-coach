import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { vi } from "vitest";

import { Keyboard } from "@/components/practice/keyboard";
import { ObjectEditor } from "@/components/practice/object-editor";
import type { PracticeScoreObject } from "@/lib/practice/types";

const initialObject: PracticeScoreObject = {
  id: "obj_1",
  type: "note",
  bbox: { x: 120, y: 200, width: 42, height: 30 },
  staff: "treble",
  measure: 3,
  notes: ["E4"],
  confidence: 0.91,
  source: "model",
};

describe("ObjectEditor", () => {
  it("updates keyboard highlights after editing a note", async () => {
    function Harness() {
      const [object, setObject] = useState(initialObject);

      return (
        <>
          <Keyboard highlightedNotes={object.notes} />
          <ObjectEditor
            object={object}
            onSave={async (nextNotes) => {
              setObject((currentObject) => ({
                ...currentObject,
                notes: nextNotes,
              }));
            }}
          />
        </>
      );
    }

    const { container } = render(<Harness />);

    fireEvent.change(screen.getByLabelText("音符内容"), {
      target: {
        value: "F4",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存当前对象" }));

    await waitFor(() => {
      expect(container.querySelector('[data-midi="65"]')).toHaveAttribute(
        "data-active",
        "true",
      );
    });

    expect(container.querySelector('[data-midi="64"]')).toHaveAttribute(
      "data-active",
      "false",
    );
  });

  it("validates note names and can undo an unsaved correction", () => {
    const onSave = vi.fn();

    render(<ObjectEditor object={initialObject} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText("音符内容"), {
      target: { value: "not-a-note" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存当前对象" }));

    const validationAlert = screen.getByRole("alert");

    expect(validationAlert).toHaveTextContent(/不是可识别的音名/);
    expect(screen.getByLabelText("音符内容")).toHaveAttribute(
      "aria-describedby",
      expect.stringContaining(validationAlert.id),
    );
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "撤销本次修改" }));

    expect(screen.getByLabelText("音符内容")).toHaveValue("E4");
    expect(screen.getByText("内容已保存")).toBeInTheDocument();
  });

  it("refreshes the draft when a rerun returns new notes for the same object", () => {
    function Harness({ notes }: { notes: string[] }) {
      const object = { ...initialObject, notes };

      return (
        <ObjectEditor
          key={`${object.id}:${object.notes.join("|")}`}
          object={object}
          onSave={() => undefined}
        />
      );
    }

    const { rerender } = render(<Harness notes={["E4"]} />);

    fireEvent.change(screen.getByLabelText("音符内容"), {
      target: { value: "F4" },
    });

    rerender(
      <Harness notes={["G4"]} />,
    );

    expect(screen.getByLabelText("音符内容")).toHaveValue("G4");
    expect(screen.getByText("内容已保存")).toBeInTheDocument();
  });

  it("protects unsaved corrections from a local rerun", () => {
    const onRerun = vi.fn();

    render(
      <ObjectEditor
        object={initialObject}
        onSave={() => undefined}
        onRerun={onRerun}
      />,
    );

    fireEvent.change(screen.getByLabelText("音符内容"), {
      target: { value: "F4" },
    });

    const rerunButton = screen.getByRole("button", { name: "先保存或撤销修改" });
    expect(rerunButton).toBeDisabled();
    expect(onRerun).not.toHaveBeenCalled();
  });
});
