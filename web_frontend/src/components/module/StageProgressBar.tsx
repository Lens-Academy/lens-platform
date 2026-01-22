// web_frontend/src/components/unified-lesson/StageProgressBar.tsx
import type { Stage } from "../../types/module";
import { Tooltip } from "../Tooltip";

type StageProgressBarProps = {
  stages: Stage[];
  completedStages: Set<number>; // Which stages are completed (can be non-contiguous)
  viewingIndex: number; // What's currently being viewed
  onStageClick: (index: number) => void;
  onPrevious: () => void;
  onNext: () => void;
  canGoPrevious: boolean;
  canGoNext: boolean;
};

export function StageIcon({
  type,
  small = false,
}: {
  type: string;
  small?: boolean;
}) {
  if (type === "article") {
    const size = small ? "w-4 h-4" : "w-5 h-5";
    return (
      <svg className={size} fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"
          clipRule="evenodd"
        />
      </svg>
    );
  }

  if (type === "video") {
    const size = small ? "w-5 h-5" : "w-6 h-6";
    return (
      <svg className={size} fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
          clipRule="evenodd"
        />
      </svg>
    );
  }

  // Chat
  const size = small ? "w-5 h-5" : "w-6 h-6";
  return (
    <svg className={size} fill="currentColor" viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function getTooltipContent(
  stage: Stage,
  index: number,
  isCompleted: boolean,
  isViewing: boolean,
): string {
  const isOptional = "optional" in stage && stage.optional === true;
  const optionalPrefix = isOptional ? "(Optional) " : "";

  if (isViewing) {
    return isCompleted ? "Currently viewing (completed)" : "Currently viewing";
  }
  if (isCompleted) {
    return `${optionalPrefix}View ${stage.type} section (completed)`;
  }
  return `${optionalPrefix}View ${stage.type} section`;
}

export default function StageProgressBar({
  stages,
  completedStages,
  viewingIndex,
  onStageClick,
  onPrevious,
  onNext,
  canGoPrevious,
  canGoNext,
}: StageProgressBarProps) {
  // Calculate highest completed index for bar coloring
  const highestCompleted = completedStages.size > 0
    ? Math.max(...completedStages)
    : -1;

  // Bar color logic:
  // - Blue up to highest completed
  // - Blue to viewing if viewing is adjacent to a completed section
  // - Dark gray to viewing if we skipped sections
  // - Light gray beyond
  const getBarColor = (index: number) => {
    if (index <= highestCompleted) return "bg-blue-400";
    if (index === viewingIndex && completedStages.has(index - 1)) return "bg-blue-400";
    if (index <= viewingIndex) return "bg-gray-400";
    return "bg-gray-200";
  };

  const handleDotClick = (index: number) => {
    onStageClick(index);
  };

  return (
    <div className="flex items-center gap-2">
      {/* Previous button */}
      <Tooltip content="Previous content">
        <button
          onClick={onPrevious}
          disabled={!canGoPrevious}
          className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-default"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
      </Tooltip>

      {/* Stage dots */}
      <div className="flex items-center">
        {stages.map((stage, index) => {
          const isCompleted = completedStages.has(index);
          const isViewing = index === viewingIndex;
          const isOptional = "optional" in stage && stage.optional === true;

          // Determine fill color:
          // - Completed: blue
          // - Not completed + viewing: dark gray
          // - Not completed + not viewing: light gray
          const getFillClasses = () => {
            if (isOptional) {
              return isCompleted
                ? "bg-transparent text-blue-500 border-2 border-dashed border-blue-400 hover:border-blue-500"
                : "bg-transparent text-gray-400 border-2 border-dashed border-gray-400 hover:border-gray-500";
            }
            if (isCompleted) {
              return "bg-blue-500 text-white hover:bg-blue-600";
            }
            if (isViewing) {
              return "bg-gray-500 text-white hover:bg-gray-600"; // Dark gray for viewing + not completed
            }
            return "bg-gray-200 text-gray-400 hover:bg-gray-300"; // Light gray for not completed
          };

          return (
            <div key={index} className="flex items-center">
              {/* Connector line (except before first) */}
              {index > 0 && (
                <div
                  className={`w-4 h-0.5 ${getBarColor(index)}`}
                />
              )}

              {/* Dot */}
              <Tooltip
                content={getTooltipContent(stage, index, isCompleted, isViewing)}
                placement="bottom"
              >
                <button
                  onClick={() => handleDotClick(index)}
                  className={`
                    relative w-7 h-7 rounded-full flex items-center justify-center
                    transition-all duration-150
                    ${getFillClasses()}
                    ${isViewing ? `ring-2 ring-offset-2 ${isCompleted ? "ring-blue-500" : "ring-gray-500"}` : ""}
                  `}
                >
                  <StageIcon type={stage.type} small />
                </button>
              </Tooltip>
            </div>
          );
        })}
      </div>

      {/* Next button */}
      <Tooltip content="Next content">
        <button
          onClick={onNext}
          disabled={!canGoNext}
          className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-default"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
      </Tooltip>
    </div>
  );
}
