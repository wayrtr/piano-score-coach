type MusicXmlClickTarget = {
  objectId: string;
  label: string;
  renderedElements: readonly (SVGElement | null)[];
};

type BindMusicXmlClickTargetsInput = {
  hostElement: HTMLElement;
  targets: readonly MusicXmlClickTarget[];
  selectedObjectId?: string | null;
  difficultObjectIds?: readonly string[];
  onSelectObject: (objectId: string) => void;
};

const MUSICXML_OBJECT_ID_ATTRIBUTE = "data-musicxml-object-id";
const MUSICXML_PRIMARY_TARGET_ATTRIBUTE = "data-musicxml-primary-target";

export function bindMusicXmlClickTargets(
  input: BindMusicXmlClickTargetsInput,
) {
  const decoratedTargets = new Set<SVGElement>();
  const difficultObjectIdSet = new Set(input.difficultObjectIds ?? []);

  for (const target of input.targets) {
    const resolvedTargets = new Set<SVGElement>();
    let hasPrimaryTarget = false;

    for (const renderedElement of target.renderedElements) {
      const interactiveElement = resolveMusicXmlClickTarget(renderedElement);

      if (!interactiveElement || resolvedTargets.has(interactiveElement)) {
        continue;
      }

      resolvedTargets.add(interactiveElement);
      decoratedTargets.add(interactiveElement);
      interactiveElement.classList.add("musicxml-click-target");
      interactiveElement.classList.toggle(
        "musicxml-click-target-difficult",
        difficultObjectIdSet.has(target.objectId),
      );
      interactiveElement.setAttribute(MUSICXML_OBJECT_ID_ATTRIBUTE, target.objectId);

      if (!hasPrimaryTarget) {
        hasPrimaryTarget = true;
        interactiveElement.setAttribute(MUSICXML_PRIMARY_TARGET_ATTRIBUTE, "");
        interactiveElement.setAttribute("role", "button");
        interactiveElement.setAttribute("aria-label", target.label);
      }
    }
  }

  updateMusicXmlRovingTabIndex(
    input.hostElement,
    input.selectedObjectId ?? null,
  );

  const handleSelection = (event: Event) => {
    const interactiveElement = resolveMusicXmlInteractionTarget(event.target);

    if (!interactiveElement) {
      return;
    }

    if (event instanceof KeyboardEvent) {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
    }

    const objectId = interactiveElement.getAttribute(MUSICXML_OBJECT_ID_ATTRIBUTE);

    if (!objectId) {
      return;
    }

    updateMusicXmlRovingTabIndex(input.hostElement, objectId);
    input.onSelectObject(objectId);
  };

  input.hostElement.addEventListener("click", handleSelection);
  input.hostElement.addEventListener("keydown", handleSelection);

  return () => {
    input.hostElement.removeEventListener("click", handleSelection);
    input.hostElement.removeEventListener("keydown", handleSelection);

    for (const interactiveElement of decoratedTargets) {
      interactiveElement.classList.remove("musicxml-click-target");
      interactiveElement.classList.remove("musicxml-click-target-difficult");
      interactiveElement.removeAttribute(MUSICXML_OBJECT_ID_ATTRIBUTE);
      interactiveElement.removeAttribute(MUSICXML_PRIMARY_TARGET_ATTRIBUTE);
      interactiveElement.removeAttribute("tabindex");
      interactiveElement.removeAttribute("role");
      interactiveElement.removeAttribute("aria-label");
    }
  };
}

export function updateMusicXmlRovingTabIndex(
  hostElement: HTMLElement,
  selectedObjectId: string | null,
) {
  const primaryTargets = Array.from(
    hostElement.querySelectorAll<SVGElement>(
      `[${MUSICXML_PRIMARY_TARGET_ATTRIBUTE}]`,
    ),
  );
  const selectedTarget =
    primaryTargets.find(
      (element) =>
        element.getAttribute(MUSICXML_OBJECT_ID_ATTRIBUTE) === selectedObjectId,
    ) ??
    primaryTargets[0] ??
    null;

  for (const target of primaryTargets) {
    target.setAttribute("tabindex", target === selectedTarget ? "0" : "-1");
  }

  return selectedTarget;
}

export function resolveMusicXmlClickTarget(
  renderedElement: SVGElement | null,
) {
  if (!renderedElement) {
    return null;
  }

  const staveNoteGroup = renderedElement.closest("g.vf-stavenote");

  if (staveNoteGroup instanceof SVGElement) {
    return staveNoteGroup;
  }

  const noteGroup = renderedElement.closest("g.vf-note");

  if (noteGroup instanceof SVGElement) {
    return noteGroup;
  }

  if (renderedElement instanceof SVGGElement) {
    return renderedElement;
  }

  const genericGroup = renderedElement.closest("g");

  return genericGroup instanceof SVGElement ? genericGroup : null;
}

function resolveMusicXmlInteractionTarget(eventTarget: EventTarget | null) {
  if (!(eventTarget instanceof Element)) {
    return null;
  }

  const interactiveElement = eventTarget.closest(
    `[${MUSICXML_OBJECT_ID_ATTRIBUTE}]`,
  );

  return interactiveElement instanceof SVGElement ? interactiveElement : null;
}
