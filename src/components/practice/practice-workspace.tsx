"use client";

import {
  startTransition,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { ArrowLeft, Guitar, Piano, ScanLine } from "lucide-react";
import { GlassSurface } from "@/components/glass-surface";
import { ThemeToggle } from "@/components/theme-toggle";
import { PracticeSettings } from "@/components/practice/practice-settings";

import { GuitarTuningEditor } from "@/components/practice/instrument-controls";
import { GuitarModeToggle } from "@/components/practice/guitar-mode-toggle";
import { InstrumentPanel } from "@/components/practice/instrument-panel";
import { ScoreToolbar, ScoreView } from "@/components/practice/score-view";
import { usePracticeProgress } from "@/components/practice/use-practice-progress";
import {
  getAdjacentPracticeSelection,
} from "@/lib/practice/navigation";
import { assignVisibleNoteColors } from "@/lib/music/note-colors";
import { getTheoryForKey } from "@/lib/music/theory";
import {
  STANDARD_TUNING,
  normalizeGuitarTuning,
  type GuitarTuning,
} from "@/lib/music/guitar";
import type { PracticeWorkDetail } from "@/lib/works/practice";

type PracticeWorkspaceProps = {
  initialWork: PracticeWorkDetail;
};

const GUITAR_TUNING_STORAGE_KEY = "piano-score-coach:guitar-tuning";
const EMPTY_OBJECT_IDS: readonly string[] = [];
const EMPTY_NOTES: readonly string[] = [];

function getKeySignatureSummary(work: PracticeWorkDetail) {
  if (work.sourceType !== "musicxml" && !work.manualKeyOverride) {
    return { label: "调号", name: "待确认", accidentals: "" };
  }

  const theory = getTheoryForKey(work.currentKey);
  const tonic = theory.key.split(" ")[0];
  const formatTonic = (note: string) => note.replaceAll("#", "♯").replaceAll("b", "♭");
  const major = theory.mode === "major" ? tonic : theory.scale[2];
  const minor = theory.mode === "minor" ? tonic : theory.scale[5];
  const sharps = theory.scale.filter((note) => note.includes("#")).length;
  const flats = theory.scale.filter((note) => note.includes("b")).length;

  return {
    label: work.manualKeyOverride ? "设定调性" : "起始调号",
    name: work.manualKeyOverride
      ? `${formatTonic(tonic)}${theory.mode === "major" ? "大调" : "小调"}`
      : `${formatTonic(major)}大调 / ${formatTonic(minor)}小调`,
    accidentals: sharps ? `${sharps}♯` : flats ? `${flats}♭` : "无升降号",
  };
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }

  if (target instanceof HTMLElement && target.isContentEditable) {
    return true;
  }

  const managedControl = target.closest(
    "input, textarea, select, button, a, summary, dialog, [contenteditable='true']",
  );

  if (!managedControl) {
    return false;
  }

  return !target.closest("[data-score-object-id], [data-musicxml-object-id]");
}

export function PracticeWorkspace({ initialWork }: PracticeWorkspaceProps) {
  const initialPageIndex =
    initialWork.practiceState?.lastPageIndex ?? initialWork.pages[0]?.pageIndex ?? 0;
  const initialPage =
    initialWork.pages.find((page) => page.pageIndex === initialPageIndex) ??
    initialWork.pages[0] ??
    null;
  const restoredObjectId = initialWork.practiceState?.lastObjectId ?? null;
  const initialObjectId =
    restoredObjectId && initialPage?.objects.some((object) => object.id === restoredObjectId)
      ? restoredObjectId
      : null;
  const [work, setWork] = useState(initialWork);
  const [currentPageIndex, setCurrentPageIndex] = useState(initialPage?.pageIndex ?? 0);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(initialObjectId);
  const [zoom, setZoom] = useState(1);
  const [pageError, setPageError] = useState<string | null>(null);
  const [isRerunning, setIsRerunning] = useState(false);
  const [instrumentMode, setInstrumentMode] = useState(
    initialWork.practiceState?.instrumentMode ?? "piano",
  );
  // The guitar view is always the recommended fingering now; the field is kept
  // in the persisted practice state (defaulting to "recommended") but is no
  // longer user-toggleable.
  const guitarViewMode = "recommended" as const;
  const [guitarTuning, setGuitarTuning] = useState<GuitarTuning>(STANDARD_TUNING);
  const [isGuitarTuningReady, setIsGuitarTuningReady] = useState(false);

  const currentPage =
    work.pages.find((page) => page.pageIndex === currentPageIndex) ?? work.pages[0] ?? null;
  const selectedObject =
    currentPage?.objects.find((object) => object.id === selectedObjectId) ?? null;
  // A lookup describes the clicked object, never the other staff or next beat.
  const highlightedNotes = selectedObject?.notes ?? EMPTY_NOTES;
  const selectedObjectIds = selectedObjectId ? [selectedObjectId] : EMPTY_OBJECT_IDS;
  const noteColors = useMemo(
    () => assignVisibleNoteColors(highlightedNotes, EMPTY_NOTES),
    [highlightedNotes],
  );
  const keySignature = getKeySignatureSummary(work);
  const isBrokenMusicXmlImport =
    work.sourceType === "musicxml" &&
    work.status === "failed" &&
    (currentPage?.objects.length ?? 0) === 0;

  useEffect(() => {
    try {
      const storedTuning = window.localStorage.getItem(GUITAR_TUNING_STORAGE_KEY);

      if (storedTuning) {
        setGuitarTuning(normalizeGuitarTuning(JSON.parse(storedTuning)));
      }
    } catch {
      // A malformed or unavailable local store should fall back to standard tuning.
    } finally {
      setIsGuitarTuningReady(true);
    }
  }, []);

  useEffect(() => {
    if (!isGuitarTuningReady) {
      return;
    }

    try {
      window.localStorage.setItem(
        GUITAR_TUNING_STORAGE_KEY,
        JSON.stringify(guitarTuning),
      );
    } catch {
      // Custom tuning remains usable for the current page even without persistence.
    }
  }, [guitarTuning, isGuitarTuningReady]);

  const { error: resumeError } = usePracticeProgress({
    workId: work.id,
    pageIndex: currentPage?.pageIndex ?? null,
    objectId: selectedObjectId,
    measure: selectedObject?.measure ?? null,
    instrumentMode,
    guitarViewMode,
    isPlaying: false,
  });

  const hasPendingRecognition = work.status === "processing" || work.pages.some(
    (page) => ["queued", "normalizing", "recognizing"].includes(page.recognitionStatus),
  );
  const applyRecognitionUpdate = useEffectEvent((nextWork: PracticeWorkDetail) => {
    setWork(nextWork);
    const page = nextWork.pages.find((item) => item.pageIndex === currentPageIndex)
      ?? nextWork.pages[0];
    if (page) {
      setCurrentPageIndex(page.pageIndex);
      if (!page.objects.some((object) => object.id === selectedObjectId)) {
        setSelectedObjectId(null);
      }
    }
  });

  useEffect(() => {
    if (!hasPendingRecognition) return;
    const controller = new AbortController();
    let timer: number;
    async function refreshRecognition() {
      try {
        const response = await fetch(`/api/works/${work.id}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Recognition status unavailable");
        const payload = await response.json() as { work?: PracticeWorkDetail };
        if (!payload.work) throw new Error("Recognition status unavailable");
        if (!controller.signal.aborted) {
          setPageError(null);
          applyRecognitionUpdate(payload.work);
        }
      } catch {
        if (!controller.signal.aborted) {
          setPageError("识谱状态暂时无法更新，正在自动重试。");
        }
      } finally {
        if (!controller.signal.aborted) {
          timer = window.setTimeout(() => void refreshRecognition(), 2000);
        }
      }
    }
    timer = window.setTimeout(() => void refreshRecognition(), 2000);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [hasPendingRecognition, work.id]);

  async function handleRerunPage() {
    if (!currentPage || isRerunning || hasPendingRecognition) {
      return;
    }

    setPageError(null);
    setIsRerunning(true);

    try {
      const response = await fetch(`/api/works/${work.id}/pages/${currentPage.id}/rerun`, {
        method: "POST",
      });

      const payload = (await response.json()) as {
        error?: string;
        work?: PracticeWorkDetail;
      };

      if (!response.ok || !payload.work) {
        setPageError(payload.error ?? "重新识别整份谱面失败，请稍后再试。");
        return;
      }

      startTransition(() => {
        setWork(payload.work!);
      });
    } catch {
      setPageError("重新识别整份谱面失败，请检查本地服务后再试。");
    } finally {
      setIsRerunning(false);
    }
  }

  function handlePageChange(nextPageIndex: number) {
    setCurrentPageIndex(nextPageIndex);
    setSelectedObjectId(null);
  }

  function handleSelectObject(selection: { pageIndex: number; objectId: string }) {
    setCurrentPageIndex(selection.pageIndex);
    setSelectedObjectId(selection.objectId);
  }

  const moveSelection = useEffectEvent(
    (direction: "previous" | "next" | "up_staff" | "down_staff") => {
      const nextSelection = getAdjacentPracticeSelection({
        pages: work.pages,
        currentPageIndex,
        selectedObjectId,
        direction,
      });

      if (!nextSelection) {
        return;
      }

      handleSelectObject(nextSelection);
    },
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) {
        return;
      }

      const direction =
        event.key === "ArrowLeft"
          ? "previous"
          : event.key === "ArrowRight"
            ? "next"
            : event.key === "ArrowUp"
              ? "up_staff"
              : event.key === "ArrowDown"
                ? "down_staff"
                : null;

      if (!direction) {
        return;
      }

      event.preventDefault();
      moveSelection(direction);
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div className="practice-layout lookup-layout">
      <header className="practice-focus-header">
        <Link className="ghost-button practice-back" href="/" aria-label="回到我的谱子" title="回到我的谱子">
          <ArrowLeft size={20} aria-hidden="true" />
        </Link>
        <div className="practice-work-identity">
          <h1 title={work.title}>{work.title}</h1>
          <div className="practice-key-signature" aria-label={`${keySignature.label}：${keySignature.name}${keySignature.accidentals ? `，${keySignature.accidentals}` : ""}`}>
            <span>{keySignature.label}</span>
            <strong>{keySignature.name}</strong>
            {keySignature.accidentals ? <small>{keySignature.accidentals}</small> : null}
          </div>
        </div>
        <ScoreToolbar pages={work.pages} currentPageIndex={currentPage?.pageIndex ?? 0}
          zoom={zoom} onPageChange={handlePageChange} onZoomChange={setZoom}
          toolbarContent={work.sourceType !== "musicxml" ? (
            <button type="button" className="secondary-button"
              aria-label={isRerunning || hasPendingRecognition ? "正在识别…" : "重新识别整份谱面"}
              title={isRerunning || hasPendingRecognition ? "正在识别…" : "重新识别整份谱面"}
              onClick={() => void handleRerunPage()}
              disabled={!currentPage || isRerunning || hasPendingRecognition}>
              <ScanLine size={16} aria-hidden="true" />
            </button>
          ) : null} />
        <ThemeToggle />
      </header>

      <div className="practice-workbench">
        <section className="score-workspace" aria-label="乐谱">
          {isBrokenMusicXmlImport ? (
            <div className="practice-notice" role="alert">
              <p>这份 MusicXML 导入缺少可点击音符对象，可以重新导入，原文件不会被删除。</p>
              <Link className="secondary-button" href="/">回到首页重新导入</Link>
            </div>
          ) : null}
          {currentPage?.recognition?.errorMessage || pageError || resumeError ? (
            <p className="practice-notice inline-error" role="alert">
              {pageError ?? currentPage?.recognition?.errorMessage ?? resumeError}
            </p>
          ) : null}
          {hasPendingRecognition ? (
            <p className="practice-notice" role="status">正在识别谱面，完成后就能点选音符。</p>
          ) : null}
          <ScoreView
            pages={work.pages}
            currentPageIndex={currentPage?.pageIndex ?? 0}
            selectedObjectId={selectedObjectId}
            selectedObjectIds={selectedObjectIds}
            zoom={zoom}
            noteColors={noteColors}
            onPageChange={handlePageChange}
            onSelectObject={handleSelectObject}
            onZoomChange={setZoom}
            showToolbar={false}
          />
        </section>

        <aside className="instrument-workbench" aria-label="键位查询结果">
          <GlassSurface className="lookup-result-surface" style={{ borderRadius: 24 }}>
            <div className="lookup-result-content">
              <div className="lookup-result-toolbar">
                <p className="lookup-selection-label" role="status">
                  {selectedObject ? `第 ${selectedObject.measure} 小节${highlightedNotes.length === 0 ? " · 该符号没有对应键位" : ""}` : "点一下谱上的音符，查看对应位置"}
                </p>
                <div className="lookup-result-actions">
                  {instrumentMode === "guitar" ? (
                    <PracticeSettings>
                      <GuitarTuningEditor tuning={guitarTuning} onChange={setGuitarTuning} />
                    </PracticeSettings>
                  ) : null}
                <GuitarModeToggle label="查看乐器" value={instrumentMode}
                  options={[
                    { value: "piano", label: "钢琴", icon: <Piano size={16} aria-hidden="true" /> },
                    { value: "guitar", label: "吉他", icon: <Guitar size={16} aria-hidden="true" /> },
                  ]}
                  onChange={setInstrumentMode}
                />
                </div>
              </div>
              <div className="instrument-reference-zone">
                <InstrumentPanel
                  instrumentMode={instrumentMode}
                  highlightedNotes={highlightedNotes}
                  noteColors={noteColors}
                  guitarTuning={guitarTuning}
                />
              </div>
            </div>
          </GlassSurface>
        </aside>
      </div>
    </div>
  );
}
