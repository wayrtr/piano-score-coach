type EffectiveWorkStatusInput = {
  sourceType: string;
  status: string;
  totalObjectCount: number;
};

type SortableWorkListItem = {
  status: string;
  updatedAt: string;
};

export function deriveEffectiveWorkStatus(input: EffectiveWorkStatusInput) {
  if (
    input.sourceType === "musicxml" &&
    input.status === "ready" &&
    input.totalObjectCount === 0
  ) {
    return "failed";
  }

  return input.status;
}

export function compareWorkListOrder(
  left: SortableWorkListItem,
  right: SortableWorkListItem,
) {
  const leftIsFailed = left.status === "failed";
  const rightIsFailed = right.status === "failed";

  if (leftIsFailed !== rightIsFailed) {
    return leftIsFailed ? 1 : -1;
  }

  return right.updatedAt.localeCompare(left.updatedAt);
}
