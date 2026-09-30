"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type {
  Note as MusicXmlNote,
  OpenSheetMusicDisplay,
  SourceMeasure,
  VoiceEntry,
} from "opensheetmusicdisplay";

import {
  bindMusicXmlClickTargets,
  resolveMusicXmlClickTarget,
  updateMusicXmlRovingTabIndex,
} from "@/components/practice/musicxml-click-targets";
import { MusicXmlInlineGuitarGuide } from "@/components/practice/musicxml-inline-guitar-guide";
import {
  buildMusicXmlSystemAnchors,
  findMusicXmlSystemAnchor,
  type MusicXmlAnchorRect,
} from "@/components/practice/musicxml-system-anchor";
import {
  buildMusicXmlObjectId,
  musicXmlStaffNumberToLabel,
  scopeMusicXmlObjectId,
} from "@/lib/musicxml/shared";
import { formatNoteWithSoundingEquivalent } from "@/lib/music/notes";
import { noteNameToMidi } from "@/lib/music/piano";
import { assignVisibleNoteColors } from "@/lib/music/note-colors";
import { revealElementWithinScrollContainer } from "@/lib/ui/scroll-container";
import { getPreferredScrollBehavior } from "@/lib/ui/motion";
import type {
  PracticeMusicXmlPage,
  PracticeScoreObject,
} from "@/lib/practice/types";

type MusicXmlScoreViewProps = {
  page: PracticeMusicXmlPage;
  selectedObjectId: string | null;
  selectedObjectIds?: readonly string[];
  previewObjectIds?: readonly string[];
  difficultObjectIds?: readonly string[];
  noteColors?: ReadonlyMap<number, number>;
  zoom: number;
  onSelectObject: (selection: { pageIndex: number; objectId: string }) => void;
  inlineGuitarGuide?: {
    notes: readonly string[];
  };
};

const ACTIVE_NOTE_CLASS = "musicxml-click-target-active";
const PREVIEW_NOTE_CLASS = "musicxml-click-target-preview";
const EMPTY_OBJECT_IDS: readonly string[] = [];
const LEGACY_MUSICXML_OBJECT_ID_PATTERN = /^mxo-\d+-\d+-\d+$/;

type MusicXmlModule = typeof import("opensheetmusicdisplay");

type RenderedNoteColorTarget = {
  midi: number | null;
  elements: SVGElement[];
};

export function MusicXmlScoreView({
  page,
  selectedObjectId,
  selectedObjectIds = EMPTY_OBJECT_IDS,
  previewObjectIds = EMPTY_OBJECT_IDS,
  difficultObjectIds = [],
  noteColors,
  zoom,
  onSelectObject,
  inlineGuitarGuide,
}: MusicXmlScoreViewProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const osmdModuleRef = useRef<MusicXmlModule | null>(null);
  const renderedPageIdRef = useRef<string | null>(null);
  const objectToNotesRef = useRef<Map<string, MusicXmlNote[]>>(new Map());
  const objectToElementsRef = useRef<Map<string, SVGElement[]>>(new Map());
  const objectToColorTargetsRef = useRef<Map<string, RenderedNoteColorTarget[]>>(
    new Map(),
  );
  const clickTargetCleanupRef = useRef<(() => void) | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [inlineGuideLayout, setInlineGuideLayout] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const activeObjectIds = useMemo(
    () =>
      selectedObjectIds.length > 0
        ? selectedObjectIds
        : selectedObjectId
          ? [selectedObjectId]
          : EMPTY_OBJECT_IDS,
    [selectedObjectId, selectedObjectIds],
  );
  const resolvedNoteColors = useMemo(
    () =>
      noteColors ??
      assignVisibleNoteColors(
        collectObjectNotes(page.objects, activeObjectIds),
        collectObjectNotes(page.objects, previewObjectIds),
      ),
    [activeObjectIds, noteColors, page.objects, previewObjectIds],
  );
  const difficultObjectIdsKey = difficultObjectIds.join("\u0000");
  const readRenderState = useEffectEvent(() => ({
    id: page.id,
    objects: page.objects,
    zoom,
    selectedObjectId,
    selectedObjectIds: activeObjectIds,
    previewObjectIds,
    noteColors: resolvedNoteColors,
    difficultObjectIds,
    difficultObjectIdsKey,
    measureStart: page.measureStart,
    measureEnd: page.measureEnd,
  }));
  const selectObject = useEffectEvent((objectId: string) => {
    onSelectObject({
      pageIndex: page.pageIndex,
      objectId,
    });
  });
  const revealSelectedObject = useEffectEvent((behavior: ScrollBehavior) => {
    if (!selectedObjectId || !stageRef.current) {
      return;
    }

    const selectedElement = objectToElementsRef.current.get(selectedObjectId)?.[0];
    const scoreStage = stageRef.current.closest<HTMLElement>(".score-stage");
    const sheetHost = hostRef.current;

    if (!selectedElement || !scoreStage || !sheetHost) {
      return;
    }

    revealElementWithinScrollContainer({
      container: scoreStage,
      target: selectedElement,
      axis: "vertical",
      behavior,
    });
    revealElementWithinScrollContainer({
      container: sheetHost,
      target: selectedElement,
      axis: "horizontal",
      behavior,
    });
  });
  const refreshInlineGuideLayout = useEffectEvent(() => {
    if (!inlineGuitarGuide || inlineGuitarGuide.notes.length === 0 || !selectedObjectId) {
      setInlineGuideLayout(null);
      return;
    }

    const hostElement = hostRef.current;
    const stageElement = stageRef.current;

    if (!hostElement || !stageElement) {
      setInlineGuideLayout(null);
      return;
    }

    const nextLayout = resolveInlineGuideLayout({
      hostElement,
      stageElement,
      selectedObjectId,
    });

    setInlineGuideLayout(nextLayout);
  });

  useEffect(() => {
    let isCancelled = false;
    const stageElement = stageRef.current;

    if (!stageElement) {
      return;
    }

    async function renderScore() {
      const hostElement = stageElement;

      if (!hostElement) {
        return;
      }

      setStatus("loading");
      setErrorMessage(null);
      setInlineGuideLayout(null);
      clickTargetCleanupRef.current?.();
      clickTargetCleanupRef.current = null;
      osmdRef.current = null;
      osmdModuleRef.current = null;
      renderedPageIdRef.current = null;
      objectToNotesRef.current = new Map();
      objectToElementsRef.current = new Map();
      objectToColorTargetsRef.current = new Map();
      hostElement.innerHTML = "";

      try {
        const [musicxmlModule, response] = await Promise.all([
          import("opensheetmusicdisplay"),
          fetch(page.musicXmlSrc),
        ]);

        if (!response.ok) {
          throw new Error("无法读取 MusicXML 源文件。");
        }

        const xmlText = await response.text();

        if (isCancelled || !stageRef.current) {
          return;
        }

        const osmd = new musicxmlModule.OpenSheetMusicDisplay(hostElement, {
          autoResize: false,
          backend: "svg",
          drawFromMeasureNumber: page.measureStart,
          drawUpToMeasureNumber: page.measureEnd,
          drawComposer: false,
          drawCredits: false,
          drawLyrics: true,
          drawPartNames: true,
          drawSubtitle: false,
          drawTitle: false,
          followCursor: false,
          pageFormat: "Endless",
        } as const);
        await osmd.load(xmlText);

        if (isCancelled || stageRef.current !== hostElement) {
          return;
        }

        const renderState = readRenderState();

        osmd.Zoom = renderState.zoom;
        osmd.render();

        osmdRef.current = osmd;
        osmdModuleRef.current = musicxmlModule;
        renderedPageIdRef.current = page.id;

        const maps = buildRenderedObjectMaps(osmd, renderState);
        objectToNotesRef.current = maps.objectToNotes;
        const renderedElements = buildRenderedObjectElements({
          musicxmlModule,
          osmd,
          objectToNotes: maps.objectToNotes,
        });
        objectToElementsRef.current = renderedElements.objectToElements;
        objectToColorTargetsRef.current = renderedElements.objectToColorTargets;
        clickTargetCleanupRef.current = bindRenderedClickTargets({
          hostElement,
          page,
          objectToElements: objectToElementsRef.current,
          selectedObjectId: renderState.selectedObjectId,
          difficultObjectIds: renderState.difficultObjectIds,
          previewObjectIds: renderState.previewObjectIds,
          onSelectObject: selectObject,
        });
        applyObjectDifficulty(
          objectToElementsRef.current,
          renderState.difficultObjectIds,
        );
        applyObjectHighlight(
          objectToElementsRef.current,
          renderState.selectedObjectIds,
        );
        applyObjectPreview(
          objectToElementsRef.current,
          renderState.previewObjectIds,
          renderState.selectedObjectIds,
        );
        applyRenderedNoteColors(
          objectToColorTargetsRef.current,
          renderState.selectedObjectIds,
          renderState.previewObjectIds,
          renderState.noteColors,
        );
        refreshInlineGuideLayout();
        revealSelectedObject("auto");

        if (!isCancelled) {
          setStatus("ready");
        }
      } catch (error) {
        if (!isCancelled) {
          setStatus("error");
          setErrorMessage(
            error instanceof Error ? error.message : "MusicXML 渲染失败。",
          );
        }
      }
    }

    void renderScore();

    return () => {
      isCancelled = true;
      clickTargetCleanupRef.current?.();
      clickTargetCleanupRef.current = null;
    };
  }, [page, page.measureEnd, page.measureStart, page.musicXmlSrc]);

  const refreshRenderedScore = useEffectEvent(() => {
    const renderState = readRenderState();

    if (
      !osmdRef.current ||
      !osmdModuleRef.current ||
      renderedPageIdRef.current !== renderState.id
    ) {
      return;
    }

    osmdRef.current.Zoom = renderState.zoom;
    osmdRef.current.render();

    const maps = buildRenderedObjectMaps(osmdRef.current, renderState);
    objectToNotesRef.current = maps.objectToNotes;
    const renderedElements = buildRenderedObjectElements({
      musicxmlModule: osmdModuleRef.current,
      osmd: osmdRef.current,
      objectToNotes: maps.objectToNotes,
    });
    objectToElementsRef.current = renderedElements.objectToElements;
    objectToColorTargetsRef.current = renderedElements.objectToColorTargets;
    clickTargetCleanupRef.current?.();
    clickTargetCleanupRef.current = bindRenderedClickTargets({
      hostElement: stageRef.current,
      page,
      objectToElements: objectToElementsRef.current,
      selectedObjectId: renderState.selectedObjectId,
      difficultObjectIds: renderState.difficultObjectIds,
      previewObjectIds: renderState.previewObjectIds,
      onSelectObject: selectObject,
    });
    applyObjectDifficulty(
      objectToElementsRef.current,
      renderState.difficultObjectIds,
    );
    applyObjectHighlight(
      objectToElementsRef.current,
      renderState.selectedObjectIds,
    );
    applyObjectPreview(
      objectToElementsRef.current,
      renderState.previewObjectIds,
      renderState.selectedObjectIds,
    );
    applyRenderedNoteColors(
      objectToColorTargetsRef.current,
      renderState.selectedObjectIds,
      renderState.previewObjectIds,
      renderState.noteColors,
    );
    refreshInlineGuideLayout();
    revealSelectedObject("auto");
  });

  useEffect(() => {
    refreshRenderedScore();
  }, [page, zoom]);

  useEffect(() => {
    if (!osmdRef.current || !osmdModuleRef.current) {
      return;
    }

    applyObjectHighlight(
      objectToElementsRef.current,
      activeObjectIds,
    );
    applyObjectPreview(
      objectToElementsRef.current,
      previewObjectIds,
      activeObjectIds,
    );
    applyRenderedNoteColors(
      objectToColorTargetsRef.current,
      activeObjectIds,
      previewObjectIds,
      resolvedNoteColors,
    );
    updateMusicXmlObjectLabels({
      hostElement: stageRef.current,
      page,
      selectedObjectId,
      difficultObjectIds,
      previewObjectIds,
    });
    const stageElement = stageRef.current;
    const shouldMoveFocus = Boolean(
      stageElement &&
        document.activeElement instanceof Element &&
        stageElement.contains(document.activeElement),
    );
    const nextFocusTarget = stageElement
      ? updateMusicXmlRovingTabIndex(stageElement, selectedObjectId)
      : null;

    if (shouldMoveFocus && nextFocusTarget) {
      nextFocusTarget.focus({ preventScroll: true });
    }
    refreshInlineGuideLayout();
  }, [
    activeObjectIds,
    difficultObjectIds,
    page,
    previewObjectIds,
    resolvedNoteColors,
    selectedObjectId,
  ]);

  const refreshDifficultyDecorations = useEffectEvent(() => {
    if (!osmdRef.current || !osmdModuleRef.current) {
      return;
    }

    const renderState = readRenderState();
    applyObjectDifficulty(
      objectToElementsRef.current,
      renderState.difficultObjectIds,
    );
    updateMusicXmlObjectLabels({
      hostElement: stageRef.current,
      page,
      selectedObjectId: renderState.selectedObjectId,
      difficultObjectIds: renderState.difficultObjectIds,
      previewObjectIds: renderState.previewObjectIds,
    });
  });

  useEffect(() => {
    if (!osmdRef.current || !osmdModuleRef.current) {
      return;
    }

    refreshDifficultyDecorations();
  }, [difficultObjectIdsKey]);

  useEffect(() => {
    if (status !== "ready" || !selectedObjectId || !stageRef.current) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      revealSelectedObject(getPreferredScrollBehavior());
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [page.id, selectedObjectId, status, zoom]);

  useEffect(() => {
    if (!inlineGuitarGuide || inlineGuitarGuide.notes.length === 0) {
      setInlineGuideLayout(null);
      return;
    }

    const handleResize = () => {
      refreshInlineGuideLayout();
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [inlineGuitarGuide]);

  useEffect(() => {
    let frameId: number | null = null;
    const handleResize = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        refreshRenderedScore();
      });
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, []);
  return (
    <div className="musicxml-stage">
      {status === "loading" ? (
        <p className="practice-muted" role="status">MusicXML 谱面渲染中…</p>
      ) : null}
      {status === "error" ? (
        <p className="inline-error" role="alert">{errorMessage ?? "MusicXML 渲染失败。"}</p>
      ) : null}
      <div className="musicxml-sheet-frame">
        <div ref={hostRef} className="musicxml-sheet-host">
          <div ref={stageRef} className="musicxml-sheet-canvas" />
          {inlineGuitarGuide && inlineGuideLayout ? (
            <div
              className="musicxml-inline-guide-anchor"
              style={{
                top: `${inlineGuideLayout.top}px`,
                left: `${inlineGuideLayout.left}px`,
                width: `${inlineGuideLayout.width}px`,
              }}
            >
              <MusicXmlInlineGuitarGuide notes={inlineGuitarGuide.notes} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function buildRenderedObjectMaps(
  osmd: OpenSheetMusicDisplay,
  page: Pick<PracticeMusicXmlPage, "id" | "measureStart" | "measureEnd" | "objects">,
) {
  const objectToNotes = new Map<string, MusicXmlNote[]>();
  const pageObjects = page.objects.map((object) => object);
  const objectIds = new Set(pageObjects.map((object) => object.id));
  const legacyObjectsByMeasureAndStaff = buildLegacyObjectsByMeasureAndStaff(
    pageObjects,
  );
  const measures = osmd.Sheet?.SourceMeasures ?? [];

  for (const measure of measures as SourceMeasure[]) {
    const measureNumber = measure.MeasureNumber ?? measure.measureListIndex + 1;

    if (measureNumber < page.measureStart || measureNumber > page.measureEnd) {
      continue;
    }
    const completeStaves = measure?.CompleteNumberOfStaves ?? 0;

    for (let staffIndex = 0; staffIndex < completeStaves; staffIndex += 1) {
      const entries = measure.getEntriesPerStaff(staffIndex) ?? [];
      const ordinalsByVoice = new Map<number, number>();
      let soundingEntryOrdinal = 0;

      for (const entry of entries) {
        if (!entry) {
          continue;
        }

        const soundingVoiceEntries: Array<{
          notes: MusicXmlNote[];
          objectId: string;
          scopedObjectId: string;
        }> = [];

        for (const voiceEntry of entry.VoiceEntries as VoiceEntry[]) {
          const notes = voiceEntry.Notes.filter((note) => !note.isRest());

          if (notes.length === 0) {
            continue;
          }

          const voiceNumber = voiceEntry.ParentVoice?.VoiceId ?? 1;
          const ordinal = (ordinalsByVoice.get(voiceNumber) ?? 0) + 1;

          ordinalsByVoice.set(voiceNumber, ordinal);

          const objectId = buildMusicXmlObjectId({
            measureNumber: measure.measureListIndex + 1,
            staffNumber: staffIndex + 1,
            voiceNumber,
            ordinal,
          });
          const scopedObjectId = scopeMusicXmlObjectId(page.id, objectId);

          soundingVoiceEntries.push({ notes, objectId, scopedObjectId });
        }

        if (soundingVoiceEntries.length === 0) {
          continue;
        }

        soundingEntryOrdinal += 1;

        const currentObjectEntries = soundingVoiceEntries.flatMap((voiceEntry) => {
          if (objectIds.has(voiceEntry.scopedObjectId)) {
            return [{ objectId: voiceEntry.scopedObjectId, notes: voiceEntry.notes }];
          }

          if (objectIds.has(voiceEntry.objectId)) {
            return [{ objectId: voiceEntry.objectId, notes: voiceEntry.notes }];
          }

          return [];
        });

        if (currentObjectEntries.length > 0) {
          for (const currentObjectEntry of currentObjectEntries) {
            appendRenderedNotes(
              objectToNotes,
              currentObjectEntry.objectId,
              currentObjectEntry.notes,
            );
          }

          continue;
        }

        const staffLabel = musicXmlStaffNumberToLabel(staffIndex + 1);
        const legacyObjects = legacyObjectsByMeasureAndStaff.get(
          buildMeasureStaffKey(measureNumber, staffLabel),
        );
        const legacyObjectId = legacyObjects?.[soundingEntryOrdinal - 1]?.id;

        if (legacyObjectId) {
          appendRenderedNotes(
            objectToNotes,
            legacyObjectId,
            soundingVoiceEntries.flatMap((voiceEntry) => voiceEntry.notes),
          );
          continue;
        }

        for (const voiceEntry of soundingVoiceEntries) {
          appendRenderedNotes(objectToNotes, voiceEntry.objectId, voiceEntry.notes);
        }
      }
    }
  }

  return {
    objectToNotes,
  };
}

function buildLegacyObjectsByMeasureAndStaff(
  objects: readonly PracticeScoreObject[],
) {
  const objectsByMeasureAndStaff = new Map<string, PracticeScoreObject[]>();

  for (const object of objects) {
    if (!LEGACY_MUSICXML_OBJECT_ID_PATTERN.test(object.id)) {
      continue;
    }

    const key = buildMeasureStaffKey(object.measure, object.staff);
    const groupedObjects = objectsByMeasureAndStaff.get(key) ?? [];

    groupedObjects.push(object);
    objectsByMeasureAndStaff.set(key, groupedObjects);
  }

  for (const groupedObjects of objectsByMeasureAndStaff.values()) {
    groupedObjects.sort(comparePracticeObjectPosition);
  }

  return objectsByMeasureAndStaff;
}

function buildMeasureStaffKey(measure: number, staff: string) {
  return `${measure}\u0000${staff}`;
}

function comparePracticeObjectPosition(
  left: PracticeScoreObject,
  right: PracticeScoreObject,
) {
  if (left.onset !== null && left.onset !== undefined) {
    if (right.onset === null || right.onset === undefined) {
      return -1;
    }

    if (left.onset !== right.onset) {
      return left.onset - right.onset;
    }
  } else if (right.onset !== null && right.onset !== undefined) {
    return 1;
  }

  return left.id.localeCompare(right.id);
}

function appendRenderedNotes(
  objectToNotes: Map<string, MusicXmlNote[]>,
  objectId: string,
  notes: readonly MusicXmlNote[],
) {
  objectToNotes.set(objectId, [
    ...(objectToNotes.get(objectId) ?? []),
    ...notes,
  ]);
}

function collectObjectNotes(
  objects: readonly PracticeScoreObject[],
  objectIds: readonly string[],
) {
  const objectsById = new Map(objects.map((object) => [object.id, object]));

  return objectIds.flatMap((objectId) => objectsById.get(objectId)?.notes ?? []);
}

function applyObjectHighlight(
  objectToElements: Map<string, SVGElement[]>,
  selectedObjectIds: readonly string[],
) {
  const selectedObjectIdSet = new Set(selectedObjectIds);

  for (const [objectId, elements] of objectToElements.entries()) {
    for (const element of elements) {
      element.classList.toggle(
        ACTIVE_NOTE_CLASS,
        selectedObjectIdSet.has(objectId),
      );
    }
  }
}

function applyObjectPreview(
  objectToElements: Map<string, SVGElement[]>,
  previewObjectIds: readonly string[],
  selectedObjectIds: readonly string[],
) {
  const previewObjectIdSet = new Set(previewObjectIds);
  const selectedObjectIdSet = new Set(selectedObjectIds);

  for (const [objectId, elements] of objectToElements.entries()) {
    for (const element of elements) {
      element.classList.toggle(
        PREVIEW_NOTE_CLASS,
        !selectedObjectIdSet.has(objectId) && previewObjectIdSet.has(objectId),
      );
    }
  }
}

function applyRenderedNoteColors(
  objectToColorTargets: Map<string, RenderedNoteColorTarget[]>,
  selectedObjectIds: readonly string[],
  previewObjectIds: readonly string[],
  noteColors: ReadonlyMap<number, number>,
) {
  const selectedObjectIdSet = new Set(selectedObjectIds);
  const previewObjectIdSet = new Set(previewObjectIds);

  for (const [objectId, targets] of objectToColorTargets.entries()) {
    const role = selectedObjectIdSet.has(objectId)
      ? "current"
      : previewObjectIdSet.has(objectId)
        ? "preview"
        : null;

    for (const target of targets) {
      const colorIndex =
        role && target.midi !== null ? noteColors.get(target.midi) : undefined;

      for (const element of target.elements) {
        if (role === null) {
          element.removeAttribute("data-note-color");
          element.removeAttribute("data-note-midi");
          element.removeAttribute("data-note-role");
          continue;
        }

        element.setAttribute("data-note-role", role);

        if (target.midi === null) {
          element.removeAttribute("data-note-midi");
        } else {
          element.setAttribute("data-note-midi", String(target.midi));
        }

        if (colorIndex === undefined) {
          element.removeAttribute("data-note-color");
        } else {
          element.setAttribute("data-note-color", String(colorIndex));
        }
      }
    }
  }
}

function applyObjectDifficulty(
  objectToElements: Map<string, SVGElement[]>,
  difficultObjectIds: readonly string[],
) {
  const difficultObjectIdSet = new Set(difficultObjectIds);

  for (const [objectId, elements] of objectToElements.entries()) {
    for (const element of elements) {
      element.classList.toggle(
        "musicxml-click-target-difficult",
        difficultObjectIdSet.has(objectId),
      );
    }
  }
}

function updateMusicXmlObjectLabels(input: {
  hostElement: HTMLDivElement | null;
  page: PracticeMusicXmlPage;
  selectedObjectId: string | null;
  difficultObjectIds: readonly string[];
  previewObjectIds: readonly string[];
}) {
  if (!input.hostElement) {
    return;
  }

  const objectMeta = new Map(input.page.objects.map((object) => [object.id, object]));
  const difficultObjectIdSet = new Set(input.difficultObjectIds);
  const previewObjectIdSet = new Set(input.previewObjectIds);

  for (const element of input.hostElement.querySelectorAll<SVGElement>(
    "[data-musicxml-primary-target]",
  )) {
    const objectId = element.getAttribute("data-musicxml-object-id");
    const object = objectId ? objectMeta.get(objectId) : undefined;

    if (!object || !objectId) {
      continue;
    }

    const label = `定位到第 ${input.page.pageIndex + 1} 页第 ${object.measure} 小节 ${object.notes
      .map((note) => formatNoteWithSoundingEquivalent(note))
      .join(" ")}${difficultObjectIdSet.has(objectId) ? "，已标记难点" : ""}${
      objectId !== input.selectedObjectId && previewObjectIdSet.has(objectId)
        ? "，下一音"
        : ""
    }`;
    element.setAttribute("aria-label", label);
  }
}

function buildRenderedObjectElements(input: {
  musicxmlModule: MusicXmlModule;
  osmd: OpenSheetMusicDisplay;
  objectToNotes: Map<string, MusicXmlNote[]>;
}) {
  const objectToElements = new Map<string, SVGElement[]>();
  const objectToColorTargets = new Map<string, RenderedNoteColorTarget[]>();

  for (const [objectId, notes] of input.objectToNotes.entries()) {
    const resolvedElements = new Set<SVGElement>();
    const colorTargets: RenderedNoteColorTarget[] = [];

    for (const note of notes) {
      const renderedNote = getRenderedNote(
        input.musicxmlModule,
        input.osmd,
        note,
      );
      const interactiveElement = resolveMusicXmlClickTarget(renderedNote?.group ?? null);

      if (!interactiveElement) {
        continue;
      }

      resolvedElements.add(interactiveElement);
      colorTargets.push({
        midi: getMusicXmlNoteMidi(input.musicxmlModule, note),
        elements: renderedNote?.colorElements ?? [],
      });
    }

    objectToElements.set(objectId, [...resolvedElements]);
    objectToColorTargets.set(objectId, colorTargets);
  }

  return {
    objectToElements,
    objectToColorTargets,
  };
}

function bindRenderedClickTargets(input: {
  hostElement: HTMLDivElement | null;
  page: PracticeMusicXmlPage;
  objectToElements: Map<string, SVGElement[]>;
  selectedObjectId: string | null;
  difficultObjectIds: readonly string[];
  previewObjectIds: readonly string[];
  onSelectObject: (objectId: string) => void;
}) {
  if (!input.hostElement) {
    return null;
  }

  const objectMeta = new Map(input.page.objects.map((object) => [object.id, object]));
  const previewObjectIdSet = new Set(input.previewObjectIds);

  return bindMusicXmlClickTargets({
    hostElement: input.hostElement,
    selectedObjectId: input.selectedObjectId,
    difficultObjectIds: input.difficultObjectIds,
    onSelectObject: input.onSelectObject,
    targets: [...input.objectToElements.entries()].flatMap(([objectId, elements]) => {
      const object = objectMeta.get(objectId);

      if (!object) {
        return [];
      }

      return [
        {
          objectId,
          label: `定位到第 ${input.page.pageIndex + 1} 页第 ${object.measure} 小节 ${object.notes
            .map((note) => formatNoteWithSoundingEquivalent(note))
            .join(" ")}${input.difficultObjectIds.includes(objectId) ? "，已标记难点" : ""}${
            objectId !== input.selectedObjectId && previewObjectIdSet.has(objectId)
              ? "，下一音"
              : ""
          }`,
          renderedElements: elements,
        },
      ];
    }),
  });
}

function resolveInlineGuideLayout(input: {
  hostElement: HTMLDivElement;
  stageElement: HTMLDivElement;
  selectedObjectId: string;
}) {
  const targetSelector = `[data-musicxml-object-id="${escapeAttributeValue(input.selectedObjectId)}"]`;
  const selectedElement = input.stageElement.querySelector(targetSelector);

  if (!(selectedElement instanceof SVGElement)) {
    return null;
  }

  const stafflineRects = [...input.stageElement.querySelectorAll("g.staffline")]
    .map((element) => rectFromElement(element))
    .filter((rect): rect is MusicXmlAnchorRect => rect !== null);
  const systems = buildMusicXmlSystemAnchors(stafflineRects);
  const selectedRect = rectFromElement(selectedElement);

  if (!selectedRect) {
    return null;
  }

  const system = findMusicXmlSystemAnchor(systems, selectedRect);

  if (!system) {
    return null;
  }

  const hostRect = input.hostElement.getBoundingClientRect();
  const hostWidth = hostRect.width;
  const horizontalInset = 12;
  const preferredWidth = Math.max(220, Math.min(system.right - system.left - 24, 520));
  const width = Math.min(preferredWidth, hostWidth - horizontalInset * 2);
  const preferredLeft = system.left - hostRect.left + 8;
  const left = Math.max(
    horizontalInset,
    Math.min(preferredLeft, hostWidth - width - horizontalInset),
  );

  return {
    top: system.bottom - hostRect.top + 4,
    left,
    width,
  };
}

function rectFromElement(element: Element) {
  const rect = element.getBoundingClientRect();

  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  return {
    top: rect.top,
    bottom: rect.bottom,
    left: rect.left,
    right: rect.right,
  };
}

function escapeAttributeValue(value: string) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return value.replace(/["\\]/g, "\\$&");
}

function getRenderedNote(
  musicxmlModule: MusicXmlModule,
  osmd: OpenSheetMusicDisplay,
  note: MusicXmlNote,
) {
  const graphicalNote = musicxmlModule.GraphicalNote.FromNote(
    note,
    osmd.EngravingRules,
  ) as
    | (ReturnType<typeof musicxmlModule.GraphicalNote.FromNote> & {
        getSVGGElement?: () => SVGGElement | null;
        getNoteheadSVGs?: () => Element[];
        vfnoteIndex?: number;
      })
    | null;
  const group = graphicalNote?.getSVGGElement?.() ?? null;
  const noteheadElements = graphicalNote?.getNoteheadSVGs?.() ?? [];
  const notehead = noteheadElements[graphicalNote?.vfnoteIndex ?? 0];
  const colorElements = notehead instanceof SVGElement ? [notehead] : [];

  return group
    ? {
        group,
        colorElements,
      }
    : null;
}

function getMusicXmlNoteMidi(
  musicxmlModule: MusicXmlModule,
  note: MusicXmlNote,
) {
  const noteName = note.Pitch?.ToStringShort(
    musicxmlModule.Pitch.OctaveXmlDifference,
  );
  const normalizedNoteName = noteName?.replace(
    /^([A-Ga-g])[n♮](-?\d+)$/u,
    "$1$2",
  );

  return normalizedNoteName ? noteNameToMidi(normalizedNoteName) : null;
}
