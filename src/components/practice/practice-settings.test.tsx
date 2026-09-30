import { useEffect, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { PracticeSettings } from "@/components/practice/practice-settings";

describe("PracticeSettings", () => {
  beforeEach(() => {
    // jsdom has no dialog methods; model the open/close attribute without
    // pretending to verify the browser's native focus trap or Escape handling.
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) {
        this.open = true;
      }),
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) {
        this.open = false;
        this.dispatchEvent(new Event("close"));
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  });

  it("opens a native dialog and keeps its children mounted across closing", () => {
    const onMount = vi.fn();
    const onUnmount = vi.fn();

    function PersistentControl() {
      const [count, setCount] = useState(0);

      useEffect(() => {
        onMount();
        return onUnmount;
      }, []);

      return <button onClick={() => setCount(count + 1)}>{`状态 ${count}`}</button>;
    }

    const { container, unmount } = render(
      <PracticeSettings><PersistentControl /></PracticeSettings>,
    );
    const dialog = container.querySelector("dialog")!;

    expect(dialog.open).toBe(false);
    expect(onMount).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "吉他调弦" }));
    expect(dialog.showModal).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog", { name: "吉他调弦" })).toBe(dialog);
    fireEvent.click(screen.getByRole("button", { name: "状态 0" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭吉他调弦" }));

    expect(dialog.open).toBe(false);
    expect(onUnmount).not.toHaveBeenCalled();
    expect(container.querySelector("dialog")).toBe(dialog);

    fireEvent.click(screen.getByRole("button", { name: "吉他调弦" }));
    expect(screen.getByRole("button", { name: "状态 1" })).toBeInTheDocument();
    expect(onMount).toHaveBeenCalledTimes(1);

    unmount();
    expect(onUnmount).toHaveBeenCalledTimes(1);
  });

  it("closes on a backdrop click while keeping clicks inside the dialog open", () => {
    render(<PracticeSettings><span>乐器选项</span></PracticeSettings>);
    fireEvent.click(screen.getByRole("button", { name: "吉他调弦" }));
    const dialog = screen.getByRole("dialog", { name: "吉他调弦" }) as HTMLDialogElement;
    vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({
      left: 100, right: 500, top: 100, bottom: 400,
      width: 400, height: 300, x: 100, y: 100, toJSON: () => ({}),
    });

    fireEvent.click(screen.getByText("乐器选项"));
    fireEvent.click(dialog, { clientX: 120, clientY: 120 });
    expect(dialog.open).toBe(true);
    expect(dialog.close).not.toHaveBeenCalled();

    fireEvent.click(dialog, { clientX: 80, clientY: 120 });
    expect(dialog.open).toBe(false);
    expect(dialog.close).toHaveBeenCalledTimes(1);
  });

  it("does not prevent the native cancel action", () => {
    render(<PracticeSettings><span>乐器选项</span></PracticeSettings>);
    fireEvent.click(screen.getByRole("button", { name: "吉他调弦" }));
    const dialog = screen.getByRole("dialog", { name: "吉他调弦" });
    const cancelEvent = new Event("cancel", { cancelable: true });

    expect(dialog.dispatchEvent(cancelEvent)).toBe(true);
    expect(cancelEvent.defaultPrevented).toBe(false);
  });
});
