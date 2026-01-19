import { useMeasure } from "react-use";
import { useMemo, type RefCallback } from "react";

const MIN_GAP = 24; // Minimum gap between sections (in pixels)

interface HeaderLayoutState {
  needsTwoRows: boolean;
  needsTruncation: boolean;
}

type UseHeaderLayoutReturn = [
  HeaderLayoutState,
  RefCallback<HTMLElement>,
  RefCallback<HTMLElement>,
  RefCallback<HTMLElement>,
  RefCallback<HTMLElement>,
];

export function useHeaderLayout(): UseHeaderLayoutReturn {
  const [containerRef, containerBounds] = useMeasure<HTMLElement>();
  const [leftRef, leftBounds] = useMeasure<HTMLElement>();
  const [centerRef, centerBounds] = useMeasure<HTMLElement>();
  const [rightRef, rightBounds] = useMeasure<HTMLElement>();

  const state = useMemo<HeaderLayoutState>(() => {
    const containerWidth = containerBounds.width;
    const leftWidth = leftBounds.width;
    const centerWidth = centerBounds.width;
    const rightWidth = rightBounds.width;

    // Default to two rows until measured (prevents flash)
    if (containerWidth === 0) {
      return { needsTwoRows: true, needsTruncation: false };
    }

    // Total space needed for single row: left + center + right + gaps
    const totalNeeded = leftWidth + centerWidth + rightWidth + MIN_GAP * 2;
    const needsTwoRows = totalNeeded > containerWidth;

    // If two rows, check if first row (left + right) still fits
    const firstRowNeeded = leftWidth + rightWidth + MIN_GAP;
    const needsTruncation = needsTwoRows && firstRowNeeded > containerWidth;

    return { needsTwoRows, needsTruncation };
  }, [
    containerBounds.width,
    leftBounds.width,
    centerBounds.width,
    rightBounds.width,
  ]);

  return [state, containerRef, leftRef, centerRef, rightRef];
}
