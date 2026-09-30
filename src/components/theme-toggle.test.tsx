import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeToggle } from "@/components/theme-toggle";

describe("ThemeToggle", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    // jsdom has no real matchMedia; default to "light" system preference.
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to 跟随系统 when nothing is stored", () => {
    render(<ThemeToggle />);

    expect(screen.getByRole("button")).toHaveTextContent("跟随系统");
  });

  it("cycles 系统 → 亮 → 暗 and persists + applies each choice", () => {
    render(<ThemeToggle />);
    const button = screen.getByRole("button");

    fireEvent.click(button);
    expect(button).toHaveTextContent("浅色");
    expect(window.localStorage.getItem("piano-score-coach:theme")).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    fireEvent.click(button);
    expect(button).toHaveTextContent("深色");
    expect(window.localStorage.getItem("piano-score-coach:theme")).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    fireEvent.click(button);
    expect(button).toHaveTextContent("跟随系统");
    expect(window.localStorage.getItem("piano-score-coach:theme")).toBe("system");
    // system + light OS preference resolves to light
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("restores a stored preference on mount", () => {
    window.localStorage.setItem("piano-score-coach:theme", "dark");

    render(<ThemeToggle />);

    expect(screen.getByRole("button")).toHaveTextContent("深色");
  });
});
