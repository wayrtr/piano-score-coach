import { act, render, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import { Keyboard } from "@/components/practice/keyboard";

describe("Keyboard", () => {
  it("keeps the compact keyboard labelled without a repeated heading or empty prompt", () => {
    const { container, rerender } = render(<Keyboard compact />);
    expect(container.querySelector("section")).toHaveAttribute("aria-label", "钢琴键盘");
    expect(container.querySelector("h2")).toBeNull();
    expect(container.querySelector(".section-title")).toBeNull();
    expect(container).not.toHaveTextContent("选中音符后显示附近键位");
    rerender(<Keyboard compact highlightedNotes={["C4"]} />);
    expect(container.querySelector(".instrument-note-list")).toHaveTextContent("C4");
    expect(container.querySelector("h2")).toBeNull();
    expect(container.querySelectorAll(".keyboard-region-label")).toHaveLength(1);
  });

  it("renders a traditional 52-white-36-black piano layout", () => {
    const { container } = render(<Keyboard highlightedNotes={[]} />);

    expect(container.querySelectorAll(".piano-key-white")).toHaveLength(52);
    expect(container.querySelectorAll(".piano-key-black")).toHaveLength(36);
  });

  it("keeps both octave extremes in the compact lookup range", () => {
    const { container } = render(<Keyboard compact highlightedNotes={["C3", "C5"]} />);

    expect(container.querySelector('[data-midi="48"]')).toHaveAttribute("data-active", "true");
    expect(container.querySelector('[data-midi="72"]')).toHaveAttribute("data-active", "true");
    expect(container.querySelectorAll(".piano-key-white").length).toBeLessThan(52);
  });

  it("reflows all chord notes on container resize while preserving octave colors and previews", () => {
    let notifyResize: (() => void) | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { notifyResize = callback; }
      observe() {}
      disconnect = disconnect;
    });
    const { container, unmount } = render(
      <Keyboard compact highlightedNotes={["C2", "E2", "G2", "C5", "E5", "G5"]} previewNotes={["F#5", "C2"]} />,
    );
    try {
      const shell = container.querySelector(".keyboard-scroll-shell")!;
      Object.defineProperty(shell, "clientWidth", { configurable: true, value: 280 });
      act(() => notifyResize?.());
      expect(container.querySelector(".keyboard-layout")).toHaveAttribute("data-rows", "2");
      expect(container.querySelectorAll('.piano-key[data-active="true"]')).toHaveLength(6);
      expect(container.querySelector('[data-midi="36"]')).toHaveTextContent("C2");
      expect(container.querySelector('[data-midi="72"]')).toHaveTextContent("C5");
      expect(container.querySelector('[data-midi="36"]')).toHaveAttribute("data-note-color", "0");
      expect(container.querySelector('[data-midi="72"]')).toHaveAttribute("data-note-color", "3");
      expect(container.querySelector('[data-midi="36"]')).toHaveAttribute("data-next-repeat", "true");
      expect(container.querySelector('[data-midi="78"]')).toHaveClass("piano-key-black", "is-preview");
      expect(container.querySelector(".keyboard-layout-caption")?.textContent).toBe("中间音区省略");

      Object.defineProperty(shell, "clientWidth", { configurable: true, value: 1200 });
      act(() => notifyResize?.());
      expect(container.querySelector(".keyboard-layout")).toHaveAttribute("data-rows", "1");
      expect(container.querySelector(".keyboard-layout-caption")).toBeNull();
      expect(container.querySelectorAll('.piano-key[data-active="true"]')).toHaveLength(6);
    } finally {
      unmount();
      vi.unstubAllGlobals();
    }
    expect(disconnect).toHaveBeenCalled();
  });

  it("labels each distant keyboard region and keeps both extreme selected notes", () => {
    const { container } = render(<Keyboard compact highlightedNotes={["C1", "C8"]} />);
    expect(container.querySelector(".keyboard-layout")).toHaveAttribute("data-rows", "2");
    expect(container.querySelectorAll(".keyboard-region-label")).toHaveLength(2);
    expect(container.querySelector('[data-midi="24"]')).toHaveTextContent("C1");
    expect(container.querySelector('[data-midi="108"]')).toHaveTextContent("C8");
  });

  it("highlights one selected note on the 88-key keyboard", () => {
    const { container } = render(<Keyboard highlightedNotes={["E4"]} />);

    expect(container.querySelector('[data-midi="64"]')).toHaveAttribute("data-active", "true");
    expect(container.querySelector('[data-midi="65"]')).toHaveAttribute("data-active", "false");
  });

  it("uses a short label on a selected black key while keeping the octave above it", () => {
    const { container } = render(<Keyboard compact highlightedNotes={["F#4"]} />);

    expect(container.querySelector('.piano-key-black.is-active .piano-key-label')).toHaveTextContent("F#");
    expect(container.querySelector('.instrument-note-chip')).toHaveTextContent(/F[♯#]4/);
  });

  it("renders the keyboard as a non-interactive visual reference", () => {
    const { container } = render(<Keyboard highlightedNotes={["E4"]} />);

    expect(container.querySelector(".keyboard-stage")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelectorAll(".keyboard-stage button")).toHaveLength(0);
  });

  it("highlights multiple notes for a chord selection", () => {
    const { container } = render(<Keyboard highlightedNotes={["C4", "E4", "G4"]} />);

    expect(container.querySelector('[data-midi="60"]')).toHaveAttribute("data-active", "true");
    expect(container.querySelector('[data-midi="64"]')).toHaveAttribute("data-active", "true");
    expect(container.querySelector('[data-midi="67"]')).toHaveAttribute("data-active", "true");
    expect(container.querySelector('[data-midi="69"]')).toHaveAttribute("data-active", "false");
  });

  it("gives every current note its own color, including same-letter octaves", () => {
    // D4 and D3 share a letter but must be distinguishable on the keyboard.
    const { container } = render(
      <Keyboard highlightedNotes={["D4", "F#4", "D3"]} />,
    );

    const d4 = container.querySelector('[data-midi="62"]');
    const fSharp4 = container.querySelector('[data-midi="66"]');
    const d3 = container.querySelector('[data-midi="50"]');

    expect(d4).toHaveAttribute("data-note-color", "0");
    expect(fSharp4).toHaveAttribute("data-note-color", "1");
    expect(d3).toHaveAttribute("data-note-color", "2");
    // The two D keys are different colors.
    expect(d4?.getAttribute("data-note-color")).not.toBe(
      d3?.getAttribute("data-note-color"),
    );
  });

  it("uses one visible color map for current and preview keys", () => {
    // Current notes claim colors first; a different preview pitch gets the next
    // swatch, while fill vs. ring still carries the current/next distinction.
    const { container } = render(
      <Keyboard highlightedNotes={["C4"]} previewNotes={["G4"]} />,
    );

    expect(container.querySelector('[data-midi="60"]')).toHaveAttribute(
      "data-note-color",
      "0",
    );
    expect(container.querySelector('[data-midi="67"]')).toHaveAttribute(
      "data-note-color",
      "1",
    );
  });

  it("shows the next score event with a distinct preview marker", () => {
    const { container } = render(
      <Keyboard highlightedNotes={["C4", "E4"]} previewNotes={["G4", "E4"]} />,
    );

    expect(container.querySelector('[data-midi="60"]')).toHaveAttribute(
      "data-note-role",
      "current",
    );
    expect(container.querySelector('[data-midi="64"]')).toHaveAttribute(
      "data-note-role",
      "current",
    );
    expect(container.querySelector('[data-midi="67"]')).toHaveAttribute(
      "data-note-role",
      "preview",
    );
    expect(container.querySelector('[data-midi="67"]')).toHaveClass("is-preview");
  });

  it("marks a repeated pitch as the next event without hiding the current key", () => {
    const { container } = render(
      <Keyboard highlightedNotes={["E4"]} previewNotes={["E4"]} />,
    );

    expect(container.querySelector('[data-midi="64"]')).toHaveAttribute(
      "data-note-role",
      "current",
    );
    expect(container.querySelector('[data-midi="64"]')).toHaveAttribute(
      "data-next-repeat",
      "true",
    );
    expect(container.querySelector('[data-midi="64"]')).toHaveAttribute(
      "data-note-color",
      "0",
    );
    expect(container.querySelector('[data-midi="64"]')).toHaveClass(
      "is-repeat-preview",
    );
  });

  it("keeps black keys directly highlightable in the traditional layout", () => {
    const { container } = render(<Keyboard highlightedNotes={["G#4"]} />);

    expect(container.querySelector('[data-midi="68"]')).toHaveAttribute("data-active", "true");
  });

  it("positions black keys from the fixed white-key width", () => {
    const { container } = render(
      <Keyboard highlightedNotes={["G#3", "B4"]} compact />,
    );

    const whiteKeysBefore = [...container.querySelectorAll(".piano-key-white")]
      .filter((key) => Number(key.getAttribute("data-midi")) < 56).length;
    expect(container.querySelector('[data-midi="56"]')).toHaveStyle({
      left: `calc(var(--white-key-width) * ${whiteKeysBefore})`,
    });
  });

  it("auto-scrolls the keyboard viewport to the highlighted note range", async () => {
    const { container, rerender } = render(<Keyboard highlightedNotes={["C4"]} />);
    const scrollShell = container.querySelector(".keyboard-scroll-shell") as HTMLDivElement;
    const stage = container.querySelector(".keyboard-stage") as HTMLDivElement;
    const scrollTo = vi.fn();
    const getBoundingClientRectSpy = vi.spyOn(
      HTMLElement.prototype,
      "getBoundingClientRect",
    );

    Object.defineProperty(scrollShell, "clientWidth", {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(stage, "scrollWidth", {
      configurable: true,
      value: 2200,
    });
    Object.defineProperty(scrollShell, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });
    getBoundingClientRectSpy.mockImplementation(function mockRect(this: HTMLElement) {
      if (this === stage) {
        return {
          left: 100,
          right: 2300,
          top: 0,
          bottom: 170,
          width: 2200,
          height: 170,
          x: 100,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      }

      if ((this as Element).getAttribute?.("data-midi") === "90") {
        return {
          left: 1720,
          right: 1754,
          top: 0,
          bottom: 158,
          width: 34,
          height: 158,
          x: 1720,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      }

      return {
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });

    rerender(<Keyboard highlightedNotes={["F#6"]} />);

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith({
        left: 1337,
        behavior: "smooth",
      });
    });

    scrollTo.mockClear();
    Object.defineProperty(scrollShell, "clientWidth", {
      configurable: true,
      value: 400,
    });
    window.dispatchEvent(new Event("resize"));

    expect(scrollTo).toHaveBeenCalledWith({
      left: 1437,
      behavior: "auto",
    });

    getBoundingClientRectSpy.mockRestore();
  });
});
