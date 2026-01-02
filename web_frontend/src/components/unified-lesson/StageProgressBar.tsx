// web_frontend/src/components/unified-lesson/StageProgressBar.tsx
import { useState, useRef } from "react";
import type { Stage } from "../../types/unified-lesson";

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

function StageIcon({ type, small = false }: { type: string; small?: boolean }) {
  const size = small ? "w-3 h-3" : "w-4 h-4";

  if (type === "article") {
    return (
      <svg className={size} fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
      </svg>
    );
  }

  if (type === "video") {
    return (
      <svg className={size} fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
      </svg>
    );
  }

  // Chat
  return (
    <svg className={size} fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
    </svg>
  );
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
  const [tooltipIndex, setTooltipIndex] = useState<number | null>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showTooltip = (index: number) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setTooltipIndex(index);
  };

  const hideTooltip = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setTooltipIndex(null);
  };

  const handleMouseEnter = (index: number, isPastChat: boolean) => {
    if (!isPastChat) return;
    hoverTimeoutRef.current = setTimeout(() => {
      setTooltipIndex(index);
    }, 500); // Match native tooltip delay
  };

  const handleMouseLeave = () => {
    hideTooltip();
  };

  const handleDotClick = (index: number, stage: Stage) => {
    if (index > currentStageIndex) {
      // Can't click future stages
      return;
    }

    if (stage.type === "chat" && index < currentStageIndex) {
      // Past chat stages can't be revisited - show tooltip immediately on click
      showTooltip(index);
      return;
    }

    // Navigate to stage
    onStageClick(index);
  };

  return (
    <div className="flex items-center gap-2">
      {/* Previous button */}
      <button
        onClick={onPrevious}
        disabled={!canGoPrevious}
        className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
        title="Previous content"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      {/* Stage dots */}
      <div className="flex items-center">
        {stages.map((stage, index) => {
          const isReached = index <= currentStageIndex;
          const isViewing = index === viewingIndex;
          // Clickable: reached stages, except past chat stages (current chat IS clickable)
          const isPastChat = stage.type === "chat" && index < currentStageIndex;
          const isClickable = isReached && !isPastChat;
          const isFuture = index > currentStageIndex;

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
              <div className="relative">
                <button
                  onClick={() => handleDotClick(index, stage)}
                  onMouseEnter={() => handleMouseEnter(index, isPastChat)}
                  onMouseLeave={handleMouseLeave}
                  disabled={isFuture}
                  className={`
                    relative w-7 h-7 rounded-full flex items-center justify-center
                    transition-all duration-150
                    ${isReached
                      ? isClickable
                        ? "bg-blue-500 text-white hover:bg-blue-600 cursor-pointer"
                        : "bg-blue-500 text-white cursor-default"
                      : "bg-gray-200 text-gray-400 cursor-not-allowed"
                    }
                    ${isViewing ? "ring-2 ring-offset-2 ring-blue-500" : ""}
                  `}
                  title={
                    isPastChat
                      ? undefined // Custom tooltip instead
                      : isFuture
                        ? "Not yet reached"
                        : stage.type === "chat"
                          ? "Return to chat"
                          : `View ${stage.type} section`
                  }
                >
                  <StageIcon type={stage.type} small />
                </button>

                {/* Tooltip for past chat sections */}
                {tooltipIndex === index && isPastChat && (
                  <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 z-10">
                    <div className="bg-gray-800 text-white text-xs px-2 py-1 rounded whitespace-nowrap">
                      Chat sections can't be revisited
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Next button */}
      <button
        onClick={onNext}
        disabled={!canGoNext}
        className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
        title="Next content"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}
