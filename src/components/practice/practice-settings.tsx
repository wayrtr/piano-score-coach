"use client";

import { useId, useRef, type ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";

type PracticeSettingsProps = {
  children: ReactNode;
};

export function PracticeSettings({ children }: PracticeSettingsProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const dialogId = useId();
  const titleId = `${dialogId}-title`;

  return (
    <>
      <button
        type="button"
        className="secondary-button practice-settings-trigger"
        aria-label="吉他调弦"
        aria-haspopup="dialog"
        aria-controls={dialogId}
        onClick={() => {
          const dialog = dialogRef.current;

          if (dialog && !dialog.open) {
            dialog.showModal();
          }
        }}
      >
        <SlidersHorizontal size={17} aria-hidden="true" />
        <span>吉他调弦</span>
      </button>

      <dialog
        ref={dialogRef}
        id={dialogId}
        className="practice-settings-dialog"
        aria-labelledby={titleId}
        onClick={(event) => {
          if (event.target !== event.currentTarget) {
            return;
          }

          const bounds = event.currentTarget.getBoundingClientRect();
          const isOutside = event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom;

          if (isOutside) {
            event.currentTarget.close();
          }
        }}
      >
        <div className="practice-settings-heading">
          <h2 id={titleId}>吉他调弦</h2>
          <button
            type="button"
            className="ghost-button"
            aria-label="关闭吉他调弦"
            onClick={() => dialogRef.current?.close()}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="practice-settings-content">{children}</div>
      </dialog>
    </>
  );
}
