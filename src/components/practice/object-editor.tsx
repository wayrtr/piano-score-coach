"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import type { PracticeScoreObject } from "@/lib/practice/types";
import { noteNameToMidi } from "@/lib/music/piano";
import { formatNoteWithSoundingEquivalent } from "@/lib/music/notes";
import { getObjectSourceLabel, getObjectTypeLabel } from "@/lib/ui/labels";

type ObjectEditorProps = {
  object: PracticeScoreObject | null;
  onSave: (nextNotes: string[]) => Promise<boolean | void> | boolean | void;
  onRerun?: () => Promise<void> | void;
};

export function ObjectEditor({
  object,
  onSave,
  onRerun,
}: ObjectEditorProps) {
  const initialNotes = object?.notes ?? [];
  const [draftNotes, setDraftNotes] = useState(initialNotes.join(", "));
  const [savedNotes, setSavedNotes] = useState(initialNotes);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const parsedNotes = useMemo(() => parseNotes(draftNotes), [draftNotes]);
  const isDirty = draftNotes.trim() !== savedNotes.join(", ");

  useEffect(() => {
    if (!isDirty) {
      return;
    }

    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [isDirty]);

  if (!object) {
    return (
      <section className="practice-card object-editor-card">
        <div className="section-title">
          <h2>手动修正</h2>
          <span>还没有选中对象</span>
        </div>
        <div className="empty-state">先在谱面上点一个对象，再决定要手改还是局部复看。</div>
      </section>
    );
  }

  const helpTextId = `object-editor-help-${object.id}`;
  const validationErrorId = `object-editor-error-${object.id}`;

  return (
    <section className="practice-card object-editor-card">
      <div className="section-title">
        <h2>手动修正</h2>
        <span>{`${getObjectTypeLabel(object.type)} · ${getObjectSourceLabel(object.source)}`}</span>
      </div>

      <p id={helpTextId} className="practice-muted editor-help">
        只改当前对象的音名，不会改变原始谱面。多个音符用逗号分隔。
      </p>

      <label className="field">
        <span>音符内容</span>
        <input
          aria-label="音符内容"
          name="score-object-notes"
          autoComplete="off"
          spellCheck={false}
          value={draftNotes}
          onChange={(event) => {
            setDraftNotes(event.target.value);
            setValidationError(null);
          }}
          placeholder="例如：E4 或 C4, E4, G4…"
          aria-invalid={validationError ? "true" : "false"}
          aria-describedby={
            validationError
              ? `${helpTextId} ${validationErrorId}`
              : helpTextId
          }
        />
      </label>

      {parsedNotes.length > 0 ? (
        <div className="note-chip-list" aria-label="当前音符预览">
          {parsedNotes.map((note) => (
            <span key={note} className="note-chip">
              {formatNoteWithSoundingEquivalent(note)}
            </span>
          ))}
        </div>
      ) : null}

      {validationError ? (
        <p id={validationErrorId} className="inline-error" role="alert">
          {validationError}
        </p>
      ) : null}

      <div className="toolbar-group">
        <button
          type="button"
          className="primary-button"
          disabled={isPending || !isDirty}
          onClick={() => {
            if (parsedNotes.length === 0) {
              setValidationError("至少保留一个音名，例如 E4。");
              return;
            }

            const invalidNote = parsedNotes.find((note) => noteNameToMidi(note) === null);

            if (invalidNote) {
              setValidationError(`“${invalidNote}” 不是可识别的音名，请写成 C4、F#4、Bb3 或 B##4。`);
              return;
            }

            startTransition(() => {
              void Promise.resolve(onSave(parsedNotes))
                .then((saved) => {
                  if (saved === false) {
                    return;
                  }

                  setSavedNotes(parsedNotes);
                  setDraftNotes(parsedNotes.join(", "));
                })
                .catch(() => {
                  setValidationError("保存失败，修改还在输入框里，可以稍后再试。");
                });
            });
          }}
        >
          {isPending ? "保存中…" : "保存当前对象"}
        </button>

        <button
          type="button"
          className="ghost-button"
          disabled={isPending || !isDirty}
          onClick={() => {
            setDraftNotes(savedNotes.join(", "));
            setValidationError(null);
          }}
        >
          撤销本次修改
        </button>

        {onRerun ? (
          <button
            type="button"
            className="ghost-button"
            disabled={isPending || isDirty}
            title={isDirty ? "请先保存或撤销当前修改" : undefined}
            onClick={() => {
              startTransition(() => {
                void onRerun();
              });
            }}
          >
            {isDirty ? "先保存或撤销修改" : "局部重新识别"}
          </button>
        ) : null}
      </div>

      <p className="practice-muted editor-dirty-state" aria-live="polite">
        {isDirty ? "有未保存的修改" : "内容已保存"}
      </p>
    </section>
  );
}

function parseNotes(value: string) {
  return value
    .split(/[，,\s]+/)
    .map((note) => note.trim())
    .filter(Boolean);
}
