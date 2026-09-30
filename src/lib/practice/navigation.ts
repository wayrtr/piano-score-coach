import type { PracticePage, PracticeScoreObject } from "@/lib/practice/types";

export type PracticeNavigationDirection =
  | "previous"
  | "next"
  | "up_staff"
  | "down_staff";

type PracticeSelection = {
  pageIndex: number;
  objectId: string;
};

export type PracticeSelectionEvent = {
  pageIndex: number;
  measure: number;
  onset: number | null;
  primaryObjectId: string;
  objectIds: string[];
  notes: string[];
  objects: PracticeScoreObject[];
};

type SelectionContext = PracticeSelection & {
  object: PracticeScoreObject;
  objectIndex: number;
};

type NavigationInput = {
  pages: PracticePage[];
  currentPageIndex: number;
  selectedObjectId: string | null;
  direction: PracticeNavigationDirection;
};

type NextPracticeSelectionInput = Omit<NavigationInput, "direction">;

type StaffFamily = "upper" | "lower";

type RankedCandidate = {
  selection: PracticeSelection;
  measureDelta: number;
  orderDelta: number;
  horizontalDelta: number;
};

export function comparePracticeScoreObjects(
  left: PracticeScoreObject,
  right: PracticeScoreObject,
) {
  if (left.measure !== right.measure) {
    return left.measure - right.measure;
  }

  const leftHasOnset = typeof left.onset === "number" && Number.isFinite(left.onset);
  const rightHasOnset = typeof right.onset === "number" && Number.isFinite(right.onset);

  if (leftHasOnset && rightHasOnset && left.onset !== right.onset) {
    return (left.onset ?? 0) - (right.onset ?? 0);
  }

  if (leftHasOnset !== rightHasOnset) {
    return leftHasOnset ? -1 : 1;
  }

  if (leftHasOnset && rightHasOnset) {
    return left.bbox.x - right.bbox.x || left.bbox.y - right.bbox.y;
  }

  return left.bbox.y - right.bbox.y || left.bbox.x - right.bbox.x;
}

function sortObjects(objects: readonly PracticeScoreObject[]) {
  return [...objects].sort(comparePracticeScoreObjects);
}

function sortPages(pages: readonly PracticePage[]) {
  return [...pages].sort((left, right) => left.pageIndex - right.pageIndex);
}

function getOrderedPageObjects(page: PracticePage | null) {
  if (!page) {
    return [];
  }

  return sortObjects(page.objects);
}

function getFiniteOnset(object: PracticeScoreObject) {
  return typeof object.onset === "number" && Number.isFinite(object.onset)
    ? object.onset
    : null;
}

function appendUniqueNotes(target: string[], notes: readonly string[]) {
  for (const note of notes) {
    if (!target.includes(note)) {
      target.push(note);
    }
  }
}

function getHorizontalOverlapRatio(
  left: PracticeScoreObject,
  right: PracticeScoreObject,
) {
  const overlap = Math.max(
    0,
    Math.min(left.bbox.x + left.bbox.width, right.bbox.x + right.bbox.width) -
      Math.max(left.bbox.x, right.bbox.x),
  );

  return overlap / Math.min(left.bbox.width, right.bbox.width);
}

function canShareImagePracticeEvent(
  eventObjects: readonly PracticeScoreObject[],
  object: PracticeScoreObject,
) {
  const objectStaffKey = getImageStaffKey(object.staff);

  if (
    object.type === "other" ||
    eventObjects.length >= 2 ||
    eventObjects.some((candidate) => getImageStaffKey(candidate.staff) === objectStaffKey)
  ) {
    return false;
  }

  return eventObjects.some((candidate) => {
    return (
      candidate.measure === object.measure &&
      candidate.type !== "other" &&
      getImageStaffKey(candidate.staff) !== objectStaffKey &&
      getHorizontalOverlapRatio(candidate, object) >= 0.8
    );
  });
}

function getImageStaffKey(staff: string) {
  const family = getStaffFamily(staff);

  return family ? `family:${family}` : `label:${staff.trim().toLowerCase()}`;
}

function getImagePracticePageEvents(page: PracticePage) {
  const eventObjects: PracticeScoreObject[][] = [];
  const objects = [...page.objects].sort((left, right) => {
    if (left.measure !== right.measure) {
      return left.measure - right.measure;
    }

    const leftCenter = left.bbox.x + left.bbox.width / 2;
    const rightCenter = right.bbox.x + right.bbox.width / 2;

    return leftCenter - rightCenter || left.bbox.y - right.bbox.y;
  });

  for (const object of objects) {
    const event = eventObjects.findLast((candidate) =>
      canShareImagePracticeEvent(candidate, object),
    );

    if (event) {
      event.push(object);
    } else {
      eventObjects.push([object]);
    }
  }

  return eventObjects.map<PracticeSelectionEvent>((objectsInEvent) => {
    const orderedObjects = [...objectsInEvent].sort((left, right) => {
      return left.bbox.y - right.bbox.y || left.bbox.x - right.bbox.x;
    });
    const notes: string[] = [];

    for (const object of orderedObjects) {
      appendUniqueNotes(notes, object.notes);
    }

    return {
      pageIndex: page.pageIndex,
      measure: orderedObjects[0].measure,
      onset: null,
      primaryObjectId: orderedObjects[0].id,
      objectIds: orderedObjects.map((object) => object.id),
      notes,
      objects: orderedObjects,
    };
  });
}

export function getPracticePageEvents(page: PracticePage | null) {
  if (!page) {
    return [];
  }

  if (page.renderMode === "image") {
    return getImagePracticePageEvents(page);
  }

  const events: PracticeSelectionEvent[] = [];

  for (const object of getOrderedPageObjects(page)) {
    const onset = getFiniteOnset(object);
    const previousEvent = events.at(-1);

    if (
      onset !== null &&
      previousEvent?.onset === onset &&
      previousEvent.measure === object.measure
    ) {
      previousEvent.objectIds.push(object.id);
      previousEvent.objects.push(object);
      appendUniqueNotes(previousEvent.notes, object.notes);
      continue;
    }

    events.push({
      pageIndex: page.pageIndex,
      measure: object.measure,
      onset,
      primaryObjectId: object.id,
      objectIds: [object.id],
      notes: [...new Set(object.notes)],
      objects: [object],
    });
  }

  return events;
}

export function getPracticeSelectionEvent(input: {
  pages: readonly PracticePage[];
  pageIndex: number;
  objectId: string | null;
}) {
  if (!input.objectId) {
    return null;
  }

  const page = input.pages.find((candidate) => candidate.pageIndex === input.pageIndex) ?? null;

  return (
    getPracticePageEvents(page).find((event) => event.objectIds.includes(input.objectId!)) ??
    null
  );
}

function getCurrentPage(pages: readonly PracticePage[], currentPageIndex: number) {
  return (
    pages.find((page) => page.pageIndex === currentPageIndex) ??
    sortPages(pages)[0] ??
    null
  );
}

function getStaffFamily(staff: string): StaffFamily | null {
  const normalizedStaff = staff.trim().toLowerCase();

  if (
    normalizedStaff.includes("treble") ||
    normalizedStaff.includes("upper") ||
    normalizedStaff.includes("right")
  ) {
    return "upper";
  }

  if (
    normalizedStaff.includes("bass") ||
    normalizedStaff.includes("lower") ||
    normalizedStaff.includes("left")
  ) {
    return "lower";
  }

  return null;
}

function findSelectedContext(input: NavigationInput): SelectionContext | null {
  if (!input.selectedObjectId) {
    return null;
  }

  const orderedPages = sortPages(input.pages);

  for (const page of orderedPages) {
    const orderedObjects = getOrderedPageObjects(page);
    const objectIndex = orderedObjects.findIndex((object) => object.id === input.selectedObjectId);

    if (objectIndex === -1) {
      continue;
    }

    return {
      pageIndex: page.pageIndex,
      objectId: orderedObjects[objectIndex].id,
      object: orderedObjects[objectIndex],
      objectIndex,
    };
  }

  return null;
}

function getFallbackSelection(input: NavigationInput): PracticeSelection | null {
  const currentPage = getCurrentPage(input.pages, input.currentPageIndex);
  const firstEvent = getPracticePageEvents(currentPage)[0];

  if (!firstEvent || !currentPage) {
    return null;
  }

  return {
    pageIndex: currentPage.pageIndex,
    objectId: firstEvent.primaryObjectId,
  };
}

function getReadingOrderEvent(
  direction: Extract<PracticeNavigationDirection, "previous" | "next">,
  input: NavigationInput,
) {
  const orderedPages = sortPages(input.pages);
  const flattenedEvents = orderedPages.flatMap((page) => getPracticePageEvents(page));

  if (flattenedEvents.length === 0) {
    return null;
  }

  if (!input.selectedObjectId) {
    const fallback = getFallbackSelection(input);

    return fallback
      ? getPracticeSelectionEvent({
          pages: input.pages,
          pageIndex: fallback.pageIndex,
          objectId: fallback.objectId,
        })
      : null;
  }

  const currentIndex = flattenedEvents.findIndex(
    (event) => event.objectIds.includes(input.selectedObjectId!),
  );

  if (currentIndex === -1) {
    const fallback = getFallbackSelection(input);

    return fallback
      ? getPracticeSelectionEvent({
          pages: input.pages,
          pageIndex: fallback.pageIndex,
          objectId: fallback.objectId,
        })
      : null;
  }

  const nextIndex = direction === "previous" ? currentIndex - 1 : currentIndex + 1;

  return flattenedEvents[nextIndex] ?? null;
}

function getReadingOrderSelection(
  direction: Extract<PracticeNavigationDirection, "previous" | "next">,
  input: NavigationInput,
) {
  const event = getReadingOrderEvent(direction, input);

  return event
    ? {
        pageIndex: event.pageIndex,
        objectId: event.primaryObjectId,
      }
    : null;
}

export function getNextPracticeEvent(input: NextPracticeSelectionInput) {
  if (!input.selectedObjectId) {
    return null;
  }

  return getReadingOrderEvent("next", {
    ...input,
    direction: "next",
  });
}

export function getNextPracticeSelection(input: NextPracticeSelectionInput) {
  if (!input.selectedObjectId) {
    return null;
  }

  return getReadingOrderSelection("next", {
    ...input,
    direction: "next",
  });
}

function getStaffSelection(
  direction: Extract<PracticeNavigationDirection, "up_staff" | "down_staff">,
  input: NavigationInput,
) {
  const context = findSelectedContext(input);

  if (!context) {
    return getFallbackSelection(input);
  }

  const currentPage = input.pages.find((page) => page.pageIndex === context.pageIndex) ?? null;
  const orderedObjects = getOrderedPageObjects(currentPage);
  const currentFamily = getStaffFamily(context.object.staff);
  const targetFamily = direction === "up_staff" ? "upper" : "lower";

  if (!currentFamily || currentFamily === targetFamily) {
    return null;
  }

  const rankedCandidates = orderedObjects.reduce<RankedCandidate[]>((candidates, object, index) => {
    if (getStaffFamily(object.staff) !== targetFamily) {
      return candidates;
    }

    candidates.push({
      selection: {
        pageIndex: context.pageIndex,
        objectId: object.id,
      },
      measureDelta: Math.abs(object.measure - context.object.measure),
      orderDelta: Math.abs(index - context.objectIndex),
      horizontalDelta: Math.abs(object.bbox.x - context.object.bbox.x),
    });

    return candidates;
  }, []);

  if (rankedCandidates.length === 0) {
    return null;
  }

  rankedCandidates.sort((left, right) => {
    if (left.measureDelta !== right.measureDelta) {
      return left.measureDelta - right.measureDelta;
    }

    if (left.horizontalDelta !== right.horizontalDelta) {
      return left.horizontalDelta - right.horizontalDelta;
    }

    if (left.orderDelta !== right.orderDelta) {
      return left.orderDelta - right.orderDelta;
    }

    return left.selection.objectId.localeCompare(right.selection.objectId);
  });

  return rankedCandidates[0]?.selection ?? null;
}

export function getAdjacentPracticeSelection(input: NavigationInput) {
  if (input.direction === "previous" || input.direction === "next") {
    return getReadingOrderSelection(input.direction, input);
  }

  return getStaffSelection(input.direction, input);
}
