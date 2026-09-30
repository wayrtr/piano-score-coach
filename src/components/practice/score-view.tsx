"use client";

/* eslint-disable @next/next/no-img-element */

import { MusicXmlScoreView } from "@/components/practice/musicxml-score-view";
import { ChevronLeft, ChevronRight, Minus, Plus, Image as ImageIcon } from "lucide-react";
import type { PracticePage } from "@/lib/practice/types";
import { useEffect, useRef, type ReactNode } from "react";
import { formatNoteWithSoundingEquivalent } from "@/lib/music/notes";
import { revealElementWithinScrollContainer } from "@/lib/ui/scroll-container";
import { getPreferredScrollBehavior } from "@/lib/ui/motion";

type ScoreViewProps = {
  pages: readonly PracticePage[];
  currentPageIndex: number;
  selectedObjectId: string | null;
  selectedObjectIds?: readonly string[];
  zoom: number;
  onPageChange: (pageIndex: number) => void;
  onSelectObject: (selection: { pageIndex: number; objectId: string }) => void;
  onZoomChange: (zoom: number) => void;
  lowConfidenceThreshold?: number;
  difficultObjectIds?: readonly string[];
  previewObjectIds?: readonly string[];
  noteColors?: ReadonlyMap<number, number>;
  /** Optional controls rendered beside the page indicator. */
  toolbarContent?: ReactNode;
  navigationContent?: ReactNode;
  showToolbar?: boolean;
};

const EMPTY_OBJECT_IDS: readonly string[] = [];

type ScoreToolbarProps = Pick<
  ScoreViewProps,
  "pages" | "currentPageIndex" | "zoom" | "onPageChange" | "onZoomChange" | "toolbarContent"
>;

export function ScoreToolbar({
  pages,
  currentPageIndex,
  zoom,
  onPageChange,
  onZoomChange,
  toolbarContent,
}: ScoreToolbarProps) {
  const currentPage =
    pages.find((page) => page.pageIndex === currentPageIndex) ?? pages[currentPageIndex];
  const currentPagePosition = Math.max(
    0,
    pages.findIndex((page) => page.pageIndex === currentPage?.pageIndex),
  );

  if (!currentPage) return null;

  return (
    <div className="practice-toolbar" role="group" aria-label="谱面控制">
      <div className="toolbar-group score-toolbar-page-controls">
        <button type="button" className="secondary-button" aria-label="上一页" title="上一页"
          onClick={() => onPageChange(pages[currentPagePosition - 1]?.pageIndex ?? currentPageIndex)}
          disabled={currentPagePosition === 0}>
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <button type="button" className="secondary-button" aria-label="下一页" title="下一页"
          onClick={() => onPageChange(pages[currentPagePosition + 1]?.pageIndex ?? currentPageIndex)}
          disabled={currentPagePosition === pages.length - 1}>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
        <strong aria-label={`第 ${currentPagePosition + 1} / ${pages.length} 页`}>
          {`第 ${currentPagePosition + 1} / ${pages.length} 页`}
        </strong>
        {currentPage.renderMode === "musicxml" && currentPage.fallbackImageSrc ? (
          <a className="ghost-button" href={currentPage.fallbackImageSrc} target="_blank" rel="noreferrer"
            aria-label="查看原图" title="查看原图">
            <ImageIcon size={16} aria-hidden="true" />查看原图
          </a>
        ) : null}
        {toolbarContent}
      </div>
      <div className="toolbar-group score-toolbar-zoom-controls">
        <button type="button" className="secondary-button" aria-label="缩小谱面" title="缩小谱面"
          disabled={zoom <= 0.5}
          onClick={() => onZoomChange(Number(Math.max(0.5, zoom - 0.25).toFixed(2)))}>
          <Minus size={18} aria-hidden="true" />
        </button>
        <button type="button" className="secondary-button" aria-label="放大谱面" title="放大谱面"
          disabled={zoom >= 2.5}
          onClick={() => onZoomChange(Number(Math.min(2.5, zoom + 0.25).toFixed(2)))}>
          <Plus size={18} aria-hidden="true" />
        </button>
        <button type="button" className="ghost-button" aria-label="重置缩放" title="重置缩放"
          onClick={() => onZoomChange(1)}>
          {`${Math.round(zoom * 100)}%`}
        </button>
      </div>
    </div>
  );
}

export function ScoreView({
  pages,
  currentPageIndex,
  selectedObjectId,
  selectedObjectIds = EMPTY_OBJECT_IDS,
  zoom,
  onPageChange,
  onSelectObject,
  onZoomChange,
  lowConfidenceThreshold = 0.6,
  difficultObjectIds = [],
  previewObjectIds = EMPTY_OBJECT_IDS,
  noteColors,
  toolbarContent,
  navigationContent,
  showToolbar = true,
}: ScoreViewProps) {
  const currentPage =
    pages.find((page) => page.pageIndex === currentPageIndex) ?? pages[currentPageIndex];
  const scoreStageRef = useRef<HTMLDivElement | null>(null);
  const difficultObjectIdSet = new Set(difficultObjectIds);
  const previewObjectIdSet = new Set(previewObjectIds);
  const selectedObjectIdSet = new Set(
    selectedObjectIds.length > 0
      ? selectedObjectIds
      : selectedObjectId
        ? [selectedObjectId]
        : EMPTY_OBJECT_IDS,
  );

  useEffect(() => {
    if (
      currentPage?.renderMode === "musicxml" ||
      !selectedObjectId ||
      !scoreStageRef.current
    ) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const target = Array.from(
        scoreStageRef.current?.querySelectorAll<HTMLElement>("[data-score-object-id]") ?? [],
      ).find((element) => element.dataset.scoreObjectId === selectedObjectId);

      if (target && scoreStageRef.current) {
        revealElementWithinScrollContainer({
          container: scoreStageRef.current,
          target,
          behavior: getPreferredScrollBehavior(),
        });
      }
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [currentPage?.id, currentPage?.renderMode, selectedObjectId, zoom]);

  if (!currentPage) {
    return (
      <section className="practice-card score-card">
        <div className="empty-state">这首作品还没有可显示的页面。</div>
      </section>
    );
  }

  return (
    <section className="practice-card score-card">
      {showToolbar ? <ScoreToolbar pages={pages} currentPageIndex={currentPageIndex} zoom={zoom}
        onPageChange={onPageChange} onZoomChange={onZoomChange} toolbarContent={toolbarContent} /> : null}

      {navigationContent}

      <div ref={scoreStageRef} className="score-stage">
        {currentPage.renderMode === "musicxml" ? (
          <MusicXmlScoreView
            page={currentPage}
            selectedObjectId={selectedObjectId}
            selectedObjectIds={selectedObjectIds}
            previewObjectIds={previewObjectIds}
            difficultObjectIds={difficultObjectIds}
            noteColors={noteColors}
            zoom={zoom}
            onSelectObject={onSelectObject}
          />
        ) : (
          <div
            className="score-canvas"
            style={{
              width: `${currentPage.imageWidth * zoom}px`,
              height: `${currentPage.imageHeight * zoom}px`,
            }}
          >
            <img
              src={currentPage.imageSrc}
              alt={`第 ${currentPage.pageIndex + 1} 页谱面`}
              width={currentPage.imageWidth}
              height={currentPage.imageHeight}
              style={{
                width: `${currentPage.imageWidth * zoom}px`,
                height: `${currentPage.imageHeight * zoom}px`,
              }}
            />

            {currentPage.objects.map((object) => {
              const label = `定位到第 ${currentPage.pageIndex + 1} 页第 ${object.measure} 小节 ${object.notes
                .map((note) => formatNoteWithSoundingEquivalent(note))
                .join(" ")}`;
              const isSelected = selectedObjectIdSet.has(object.id);
              const isPreview = !isSelected && previewObjectIdSet.has(object.id);
              const isDifficult = difficultObjectIdSet.has(object.id);

              return (
                <button
                  key={object.id}
                  type="button"
                  data-testid={`hotspot-${object.id}`}
                  data-score-object-id={object.id}
                  aria-label={`${label}${isDifficult ? "，已标记难点" : ""}${
                    isPreview ? "，下一音" : ""
                  }`}
                  aria-pressed={isSelected}
                  className={`score-hotspot${isSelected ? " is-selected" : ""}${
                    object.confidence < lowConfidenceThreshold ? " is-low-confidence" : ""
                  }${isDifficult ? " is-difficult" : ""}${isPreview ? " is-preview" : ""}`}
                  style={{
                    left: `${object.bbox.x * zoom}px`,
                    top: `${object.bbox.y * zoom}px`,
                    width: `${object.bbox.width * zoom}px`,
                    height: `${object.bbox.height * zoom}px`,
                  }}
                  onClick={() =>
                    onSelectObject({
                      pageIndex: currentPage.pageIndex,
                      objectId: object.id,
                    })
                  }
                />
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
