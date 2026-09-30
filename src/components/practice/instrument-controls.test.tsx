import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { InstrumentControls } from "@/components/practice/instrument-controls";

describe("InstrumentControls", () => {
  it("switches instrument mode from piano to guitar", () => {
    const handleInstrumentModeChange = vi.fn();

    render(
      <InstrumentControls
        instrumentMode="piano"
        onInstrumentModeChange={handleInstrumentModeChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "吉他" }));

    expect(handleInstrumentModeChange).toHaveBeenCalledWith("guitar");
  });

  it("lets the player choose a custom pitch for every guitar string", () => {
    const handleTuningChange = vi.fn();

    render(
      <InstrumentControls
        instrumentMode="guitar"
        onInstrumentModeChange={() => undefined}
        onGuitarTuningChange={handleTuningChange}
      />,
    );

    fireEvent.click(screen.getByText("调弦与调音器"));
    expect(screen.getAllByLabelText(/第 \d 弦调弦/)).toHaveLength(6);
    expect(screen.getByText("麦克风调音器")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("第 6 弦调弦"), {
      target: { value: "D2" },
    });

    expect(handleTuningChange).toHaveBeenCalledWith(
      expect.objectContaining({
        1: "E4",
        6: "D2",
      }),
    );
  });

});
