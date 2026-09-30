export type MusicXmlAnchorRect = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

const STAFFLINE_SYSTEM_GAP = 16;

export function buildMusicXmlSystemAnchors(
  stafflineRects: readonly MusicXmlAnchorRect[],
) {
  const sortedRects = [...stafflineRects]
    .filter(
      (rect) =>
        Number.isFinite(rect.top) &&
        Number.isFinite(rect.bottom) &&
        rect.bottom > rect.top,
    )
    .sort((left, right) => left.top - right.top);

  const systems: MusicXmlAnchorRect[] = [];

  for (const rect of sortedRects) {
    const lastSystem = systems.at(-1);

    if (!lastSystem || rect.top > lastSystem.bottom + STAFFLINE_SYSTEM_GAP) {
      systems.push({ ...rect });
      continue;
    }

    lastSystem.top = Math.min(lastSystem.top, rect.top);
    lastSystem.bottom = Math.max(lastSystem.bottom, rect.bottom);
    lastSystem.left = Math.min(lastSystem.left, rect.left);
    lastSystem.right = Math.max(lastSystem.right, rect.right);
  }

  return systems;
}

export function findMusicXmlSystemAnchor(
  systems: readonly MusicXmlAnchorRect[],
  targetRect: MusicXmlAnchorRect,
) {
  if (systems.length === 0) {
    return null;
  }

  const targetCenterY = (targetRect.top + targetRect.bottom) / 2;
  let nearestSystem = systems[0];
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const system of systems) {
    if (targetCenterY >= system.top && targetCenterY <= system.bottom) {
      return system;
    }

    const distance =
      targetCenterY < system.top
        ? system.top - targetCenterY
        : targetCenterY - system.bottom;

    if (distance < nearestDistance) {
      nearestSystem = system;
      nearestDistance = distance;
    }
  }

  return nearestSystem;
}
