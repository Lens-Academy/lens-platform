// web_frontend/src/components/unified-lesson/StageProgressBar.tsx
import type { Stage } from "../../types/unified-lesson";
import { Tooltip } from "../Tooltip";

type StageProgressBarProps = {
  stages: Stage[];
  currentStageIndex: number; // Actual progress (rightmost reached)
  viewingStageIndex: number | null; // What's being viewed (null = current)
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
  currentStageIndex: number
): string {
  const isFuture = index > currentStageIndex;
  const isPastChat = stage.type === "chat" && index < currentStageIndex;
  const isFutureChat = stage.type === "chat" && index > currentStageIndex;
  const isCurrentChat = stage.type === "chat" && index === currentStageIndex;
  const isOptional = "optional" in stage && stage.optional === true;
  const optionalPrefix = isOptional ? "(Optional) " : "";

  if (isFutureChat) return "Chat sections can't be previewed";
  if (isFuture) return `${optionalPrefix}Preview ${stage.type} section`;
  if (isPastChat) return "Chat sections can't be revisited";
  if (isCurrentChat) return "Return to chat";
  return `${optionalPrefix}View ${stage.type} section`;
}

export default function StageProgressBar({
  stages,
  currentStageIndex,
  viewingStageIndex,
  onStageClick,
  onPrevious,
  onNext,
  canGoPrevious,
  canGoNext,
}: StageProgressBarProps) {
  const viewingIndex = viewingStageIndex ?? currentStageIndex;

  const handleDotClick = (index: number, stage: Stage) => {
    // Past chat stages can't be revisited
    if (stage.type === "chat" && index < currentStageIndex) {
      return;
    }

    // Future chat stages can't be previewed (no content to show)
    if (stage.type === "chat" && index > currentStageIndex) {
      return;
    }

    // Navigate to stage (including future for preview)
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
          const isReached = index <= currentStageIndex;
          const isViewing = index === viewingIndex;
          const isPastChat = stage.type === "chat" && index < currentStageIndex;
          const isFutureChat =
            stage.type === "chat" && index > currentStageIndex;
          const isClickable = isReached && !isPastChat;
          const isFuture = index > currentStageIndex;
          const isOptional = "optional" in stage && stage.optional === true;
          const canPreview = isFuture && !isFutureChat; // Future non-chat stages can be previewed

          return (
            <div key={index} className="flex items-center">
              {/* Connector line (except before first) */}
              {index > 0 && (
                <div
                  className={`w-4 h-0.5 ${
                    index <= currentStageIndex ? "bg-blue-400" : "bg-gray-300"
                  }`}
                />
              )}

              {/* Dot */}
              <Tooltip
                content={getTooltipContent(stage, index, currentStageIndex)}
                placement="bottom"
                persistOnClick={isPastChat}
              >
                <button
                  onClick={() => handleDotClick(index, stage)}
                  disabled={
                    stage.type === "chat" &&
                    index !== currentStageIndex &&
                    index !== viewingIndex
                  }
                  className={`
                    relative w-7 h-7 rounded-full flex items-center justify-center
                    transition-all duration-150 disabled:cursor-default
                    ${
                      isOptional
                        ? "bg-transparent text-gray-400 border-2 border-dashed border-gray-400 hover:border-gray-500"
                        : isReached
                          ? isClickable
                            ? "bg-blue-500 text-white hover:bg-blue-600"
                            : "bg-blue-500 text-white"
                          : canPreview
                            ? "bg-gray-300 text-gray-500 hover:bg-gray-400"
                            : "bg-gray-300 text-gray-500"
                    }
                    ${isViewing ? "ring-2 ring-offset-2 ring-blue-500" : ""}
                    ${isFuture ? "opacity-50" : ""}
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
