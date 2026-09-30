import { render, screen } from "@testing-library/react";

import { GuitarFretboard } from "@/components/practice/guitar-fretboard";

describe("guitar note lookup", () => {
  it("shows all four notes even when two require the same string", () => {
    const { container } = render(<GuitarFretboard notes={["A4", "D5", "E5", "F#4"]} />);
    const markers = [...container.querySelectorAll('.guitar-fret-marker[data-note-role="current"]')];

    expect(markers.map((marker) => marker.getAttribute("title")).sort()).toEqual(["A4", "D5", "E5", "F#4"]);
    expect(screen.getByRole("status")).toHaveTextContent("逐音位置，不能同时按下");
  });

  it("names each note outside the available fret range", () => {
    const { container } = render(<GuitarFretboard notes={["A#5", "D5", "D6", "G5"]} />);

    expect(container.querySelectorAll('.guitar-fret-marker[data-note-role="current"]')).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("前 12 品无对应位置：A#5、D6、G5");
    expect(container.querySelector('.guitar-fret-marker[title="D5"]')).toBeInTheDocument();
  });

  it("preserves a complete playable three-note chord", () => {
    const { container } = render(<GuitarFretboard notes={["B4", "D#5", "F#4"]} />);
    const markers = [...container.querySelectorAll('.guitar-fret-marker[data-note-role="current"]')];

    expect(markers).toHaveLength(3);
    expect(new Set(markers.map((marker) => marker.parentElement?.getAttribute("data-string-number"))).size).toBe(3);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
