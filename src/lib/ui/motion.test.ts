import { afterEach, describe, expect, it, vi } from "vitest";

import { getPreferredScrollBehavior } from "@/lib/ui/motion";

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: originalMatchMedia,
  });
});

describe("getPreferredScrollBehavior", () => {
  it("disables smooth scrolling when reduced motion is requested", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    });

    expect(getPreferredScrollBehavior()).toBe("auto");
  });

  it("keeps smooth scrolling for the default motion preference", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: false })),
    });

    expect(getPreferredScrollBehavior()).toBe("smooth");
  });
});
