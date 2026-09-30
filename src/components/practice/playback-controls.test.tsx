import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlaybackControls } from "@/components/practice/playback-controls";

describe("PlaybackControls", () => {
  it("allows stopping while samples are still loading", () => {
    const onStop = vi.fn();

    render(
      <PlaybackControls
        status="idle"
        instrumentMode="piano"
        isLoadingSamples
        onToggle={vi.fn()}
        onStop={onStop}
      />,
    );

    expect(screen.getByRole("button", { name: "音色加载中…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "停止" }));
    expect(onStop).toHaveBeenCalledOnce();
  });
});
