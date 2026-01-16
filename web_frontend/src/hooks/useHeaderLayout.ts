import { useMeasure } from 'react-use';
import { useLayoutEffect, useState, type RefCallback } from 'react';

const MIN_GAP = 24; // Minimum gap between sections (in pixels)

interface HeaderLayoutState {
  needsTwoRows: boolean;
  needsTruncation: boolean;
}

interface HeaderLayoutRefs {
  containerRef: RefCallback<HTMLElement>;
  leftRef: RefCallback<HTMLElement>;
  centerRef: RefCallback<HTMLElement>;
  rightRef: RefCallback<HTMLElement>;
}

export function useHeaderLayout(): [HeaderLayoutState, HeaderLayoutRefs] {
  const [containerRef, containerBounds] = useMeasure<HTMLElement>();
  const [leftRef, leftBounds] = useMeasure<HTMLElement>();
  const [centerRef, centerBounds] = useMeasure<HTMLElement>();
  const [rightRef, rightBounds] = useMeasure<HTMLElement>();

  const [state, setState] = useState<HeaderLayoutState>({
    needsTwoRows: true,  // Default to two rows until measured (prevents flash)
    needsTruncation: false,
  });

  useLayoutEffect(() => {
    const containerWidth = containerBounds.width;
    const leftWidth = leftBounds.width;
    const centerWidth = centerBounds.width;
    const rightWidth = rightBounds.width;

    // Skip if not measured yet
    if (containerWidth === 0) return;

    // Total space needed for single row: left + center + right + gaps
    const totalNeeded = leftWidth + centerWidth + rightWidth + MIN_GAP * 2;
    const needsTwoRows = totalNeeded > containerWidth;

    // If two rows, check if first row (left + right) still fits
    const firstRowNeeded = leftWidth + rightWidth + MIN_GAP;
    const needsTruncation = needsTwoRows && firstRowNeeded > containerWidth;

    setState({ needsTwoRows, needsTruncation });
  }, [containerBounds.width, leftBounds.width, centerBounds.width, rightBounds.width]);

  return [
    state,
    { containerRef, leftRef, centerRef, rightRef },
  ];
}
