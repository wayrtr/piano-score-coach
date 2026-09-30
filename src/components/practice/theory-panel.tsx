"use client";

import { useEffect, useState, useTransition } from "react";

import {
  getIntervalBetweenNotes,
  getIntervalNameFromSemitones,
  getSupportedKeys,
  getTheoryForKey,
} from "@/lib/music/theory";
import { formatNoteWithSoundingEquivalent } from "@/lib/music/notes";
import { getObjectTypeLabel, getStaffLabel } from "@/lib/ui/labels";
import type { InstrumentMode } from "@/lib/domain/types";
import type { PracticeScoreObject } from "@/lib/practice/types";

type TheoryPanelProps = {
  currentKey: string;
  previousSelectedObject?: PracticeScoreObject | null;
  selectedObject?: PracticeScoreObject | null;
  onSaveKey?: (nextKey: string) => Promise<void> | void;
  instrumentMode?: InstrumentMode;
};

export function TheoryPanel({
  currentKey,
  previousSelectedObject = null,
  selectedObject = null,
  onSaveKey,
  instrumentMode = "piano",
}: TheoryPanelProps) {
  const [draftKey, setDraftKey] = useState(currentKey);
  const [intervalSemitones, setIntervalSemitones] = useState("4");
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const theory = getTheoryForKey(currentKey);
  const parsedIntervalSemitones =
    intervalSemitones.trim() === "" ? null : Number(intervalSemitones);
  const intervalName =
    parsedIntervalSemitones === null
      ? null
      : getIntervalNameFromSemitones(parsedIntervalSemitones);
  const previousPrimaryNote = previousSelectedObject?.notes[0] ?? null;
  const currentPrimaryNote = selectedObject?.notes[0] ?? null;
  const linkedInterval =
    previousPrimaryNote && currentPrimaryNote
      ? getIntervalBetweenNotes(previousPrimaryNote, currentPrimaryNote)
      : null;

  useEffect(() => {
    setDraftKey(currentKey);
  }, [currentKey]);

  return (
    <aside className="practice-card theory-card">
      <details
        className="inspector-details"
        open={isInspectorOpen}
      >
        <summary
          className="inspector-summary"
          onClick={(event) => {
            event.preventDefault();
            setIsInspectorOpen((current) => !current);
          }}
        >
          <span>
            <span className="eyebrow">理解谱面</span>
            <strong>当前音与调性</strong>
          </span>
          <span className="inspector-summary-hint">
            {isInspectorOpen ? "收起" : "点开查看"}
          </span>
        </summary>

        <div
          className="theory-panel-grid"
          role="group"
          aria-label="乐理参考工具"
        >
          <div className="section-stack">
            <div className="section-title">
              <h2>当前对象</h2>
              <span>
                {selectedObject ? getObjectTypeLabel(selectedObject.type) : "尚未选中"}
              </span>
            </div>

            {selectedObject ? (
              <div className="info-card">
                <p>
                  <strong>谱面音名：</strong>
                  {selectedObject.notes
                    .map((note) =>
                      formatNoteWithSoundingEquivalent(note, {
                        equivalentLabel:
                          instrumentMode === "piano" ? "对应琴键" : "对应音高",
                      }),
                    )
                    .join(" · ")}
                </p>
                <p>{`谱表：${getStaffLabel(selectedObject.staff)}`}</p>
                <p>{`小节：${selectedObject.measure}`}</p>
                <p>
                  <strong>识别状态：</strong>
                  {selectedObject.confidence < 0.6 ? "待确认" : "看起来可靠"}
                </p>
              </div>
            ) : (
              <div className="empty-state">
                点一个音或和弦，展开后会显示详细信息。
              </div>
            )}
          </div>

          <div className="section-stack">
            <div className="section-title">
              <h2>当前调</h2>
              <span>{theory.key}</span>
            </div>

            <label className="field">
              <span>当前调</span>
              <select
                aria-label="当前调"
                name="practice-key"
                autoComplete="off"
                value={draftKey}
                onChange={(event) => setDraftKey(event.target.value)}
              >
                {getSupportedKeys().map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className="primary-button"
              disabled={!onSaveKey || draftKey === currentKey || isPending}
              onClick={() => {
                if (!onSaveKey || draftKey === currentKey) {
                  return;
                }

                startTransition(() => {
                  void onSaveKey(draftKey);
                });
              }}
            >
              {isPending ? "保存中…" : "保存调性"}
            </button>
          </div>

          <div className="section-stack">
            <h2>音阶</h2>
            <p className="theory-line">{theory.scale.join(" - ")}</p>
          </div>

          <div className="section-stack">
            <h2>选中联动音程</h2>

            <div className="info-card">
              {linkedInterval ? (
                <>
                  <p>{`${linkedInterval.fromNote} -> ${linkedInterval.toNote}`}</p>
                  <p>
                    {`${formatIntervalDirection(linkedInterval.direction)} · ${linkedInterval.intervalName} · ${linkedInterval.semitones} 半音`}
                  </p>
                </>
              ) : (
                <p>
                  开启“音程比较”后，先点基准音，再点目标音，这里会显示两者之间的音程。
                </p>
              )}
            </div>
          </div>

          <div className="section-stack">
            <h2>半音数查音程</h2>

            <label className="field">
              <span>半音数</span>
              <input
                aria-label="半音数"
                name="interval-semitones"
                autoComplete="off"
                type="number"
                min={0}
                step={1}
                value={intervalSemitones}
                onChange={(event) => setIntervalSemitones(event.target.value)}
              />
            </label>

            <div className="info-card">
              <p>{intervalName ?? "请输入 0 以上整数"}</p>
            </div>
          </div>

          <div className="section-stack">
            <h2>三和弦</h2>
            <ul className="theory-list">
              {theory.triads.map((chord) => (
                <li key={chord.symbol}>
                  {`${chord.symbol}: ${chord.notes.join(" - ")}`}
                </li>
              ))}
            </ul>
          </div>

          <div className="section-stack">
            <h2>七和弦</h2>
            <ul className="theory-list">
              {theory.sevenths.map((chord) => (
                <li key={chord.symbol}>
                  {`${chord.symbol}: ${chord.notes.join(" - ")}`}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </details>
    </aside>
  );
}

function formatIntervalDirection(direction: "up" | "down" | "same") {
  if (direction === "up") {
    return "上行";
  }

  if (direction === "down") {
    return "下行";
  }

  return "同音";
}
