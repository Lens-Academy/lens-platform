/**
 * Shared utilities for stage progress visualization.
 * Used by both StageProgressBar (horizontal) and ModuleOverview (vertical).
 */

/**
 * Get the highest completed stage index from a set of completed stages.
 */
export function getHighestCompleted(completedStages: Set<number>): number {
  return completedStages.size > 0 ? Math.max(...completedStages) : -1;
}

type CircleState = {
  isCompleted: boolean;
  isViewing: boolean;
  isOptional: boolean;
};

/**
 * Get Tailwind classes for stage circle fill color.
 * - Completed: blue
 * - Viewing + not completed: dark gray
 * - Not completed: light gray
 * - Optional: dashed border variant
 */
export function getCircleFillClasses(
  state: CircleState,
  options: { includeHover?: boolean } = {}
): string {
  const { isCompleted, isViewing, isOptional } = state;
  const { includeHover = false } = options;

  if (isOptional) {
    if (isCompleted) {
      return includeHover
        ? "bg-transparent text-blue-500 border-2 border-dashed border-blue-400 hover:border-blue-500"
        : "bg-transparent text-blue-500 border-2 border-dashed border-blue-400";
    }
    return includeHover
      ? "bg-transparent text-gray-400 border-2 border-dashed border-gray-400 hover:border-gray-500"
      : "bg-transparent text-gray-400 border-2 border-dashed border-gray-400";
  }

  if (isCompleted) {
    return includeHover
      ? "bg-blue-500 text-white hover:bg-blue-600"
      : "bg-blue-500 text-white";
  }

  if (isViewing) {
    return includeHover
      ? "bg-gray-500 text-white hover:bg-gray-600"
      : "bg-gray-500 text-white";
  }

  return includeHover
    ? "bg-gray-200 text-gray-400 hover:bg-gray-300"
    : "bg-gray-200 text-gray-400";
}

/**
 * Get Tailwind classes for stage circle ring (selection indicator).
 * Ring color matches fill: blue for completed, gray for not completed.
 */
export function getRingClasses(isViewing: boolean, isCompleted: boolean): string {
  if (!isViewing) return "";
  return isCompleted
    ? "ring-2 ring-offset-2 ring-blue-500"
    : "ring-2 ring-offset-2 ring-gray-500";
}
