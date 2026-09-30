type ScrollAxis = "both" | "horizontal" | "vertical";

export function revealElementWithinScrollContainer({
  container,
  target,
  axis = "both",
  behavior = "auto",
}: {
  container: HTMLElement;
  target: Element;
  axis?: ScrollAxis;
  behavior?: ScrollBehavior;
}) {
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const options: ScrollToOptions = { behavior };
  let shouldScroll = false;

  if (
    axis !== "horizontal" &&
    (targetRect.top < containerRect.top || targetRect.bottom > containerRect.bottom)
  ) {
    options.top = clampScrollPosition(
      container.scrollTop +
        (targetRect.top + targetRect.bottom - containerRect.top - containerRect.bottom) / 2,
      container.scrollHeight - container.clientHeight,
    );
    shouldScroll = true;
  }

  if (
    axis !== "vertical" &&
    (targetRect.left < containerRect.left || targetRect.right > containerRect.right)
  ) {
    options.left = clampScrollPosition(
      container.scrollLeft +
        (targetRect.left + targetRect.right - containerRect.left - containerRect.right) / 2,
      container.scrollWidth - container.clientWidth,
    );
    shouldScroll = true;
  }

  if (!shouldScroll) {
    return false;
  }

  if (typeof container.scrollTo === "function") {
    container.scrollTo(options);
  } else {
    if (options.top !== undefined) {
      container.scrollTop = options.top;
    }
    if (options.left !== undefined) {
      container.scrollLeft = options.left;
    }
  }

  return true;
}

function clampScrollPosition(value: number, maximum: number) {
  return Math.max(0, Math.min(value, Math.max(0, maximum)));
}
