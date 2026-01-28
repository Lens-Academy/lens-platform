/**
 * Vertical stage list with progress line.
 * Reused in course overview main panel and in-player drawer.
 */

import type { StageInfo, ModuleStatus } from "../../types/course";
import { StageIcon } from "../module/StageProgressBar";
import {
  getHighestCompleted,
  getCircleFillClasses,
  getRingClasses,
} from "../../utils/stageProgress";

type ModuleOverviewProps = {
  moduleTitle: string;
  stages: StageInfo[];
  status: ModuleStatus;
  completedStages: Set<number>;
  viewingIndex: number;
  onStageClick?: (index: number) => void;
  onStartModule?: () => void;
  showActions?: boolean;
  // Lens progress (for new progress format)
  completedLenses?: number;
  totalLenses?: number;
};

export default function ModuleOverview({
  moduleTitle,
  stages,
  status,
  completedStages,
  viewingIndex,
  onStageClick,
  onStartModule,
  showActions = true,
  completedLenses,
  totalLenses,
}: ModuleOverviewProps) {
  // Calculate highest completed index for line coloring
  const highestCompleted = getHighestCompleted(completedStages);

  const getActionLabel = () => {
    if (status === "completed") return "Review Module";
    if (status === "in_progress") return "Continue Module";
    return "Start Module";
  };

  return (
    <div className="flex flex-col h-full">
      {/* Module title and progress badge */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900">{moduleTitle}</h2>
        {/* Progress badge for in-progress modules */}
        {status === "in_progress" &&
          completedLenses !== undefined &&
          totalLenses !== undefined &&
          totalLenses > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all"
                  style={{
                    width: `${(completedLenses / totalLenses) * 100}%`,
                  }}
                />
              </div>
              <span className="text-sm text-slate-600 font-medium">
                {completedLenses}/{totalLenses}
              </span>
            </div>
          )}
        {status === "completed" && (
          <div className="mt-2 flex items-center gap-1 text-sm text-green-600 font-medium">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            Completed
          </div>
        )}
      </div>

      {/* Stage list */}
      <div className="flex-1 overflow-y-auto">
        {/* pl-1 gives space for the selection ring to not be cut off */}
        <div className="relative pl-1">
          {/* Continuous progress line - left-[1.125rem] = pl-1 (4px) + half of w-7 (14px) = 18px */}
          {/* Base gray line */}
          <div className="absolute left-[1.125rem] top-5 bottom-5 w-0.5 -translate-x-1/2 bg-gray-200" />
          {/* Blue line: up to highest completed, or to viewing if adjacent to completed */}
          {(() => {
            const viewingIsAdjacent = completedStages.has(viewingIndex - 1);
            const blueEndIndex =
              viewingIsAdjacent && viewingIndex > highestCompleted
                ? viewingIndex
                : highestCompleted;

            if (blueEndIndex < 0) return null;

            return (
              <div
                className="absolute left-[1.125rem] top-5 w-0.5 -translate-x-1/2 bg-blue-400 transition-all duration-300"
                style={{
                  height: `calc(${((blueEndIndex + 0.5) / stages.length) * 100}% - 1.25rem)`,
                }}
              />
            );
          })()}
          {/* Dark gray line from blue end to viewing (if viewing is beyond and not adjacent) */}
          {viewingIndex > highestCompleted &&
            !completedStages.has(viewingIndex - 1) && (
              <div
                className="absolute left-[1.125rem] w-0.5 -translate-x-1/2 bg-gray-400 transition-all duration-300"
                style={{
                  top:
                    highestCompleted >= 0
                      ? `calc(${((highestCompleted + 0.5) / stages.length) * 100}%)`
                      : "1.25rem",
                  height: `calc(${((viewingIndex - Math.max(highestCompleted, -0.5)) / stages.length) * 100}%)`,
                }}
              />
            )}

          {/* Stages */}
          <div className="space-y-2">
            {stages.map((stage, index) => {
              const isCompleted = completedStages.has(index);
              const isViewing = index === viewingIndex;
              const isClickable = onStageClick && stage.type !== "chat";

              const fillClasses = getCircleFillClasses(
                { isCompleted, isViewing, isOptional: stage.optional },
                { includeHover: false },
              );
              const ringClasses = getRingClasses(isViewing, isCompleted);

              return (
                <div
                  key={index}
                  className={`flex items-center gap-4 py-2 rounded-lg ${
                    isClickable ? "cursor-pointer hover:bg-slate-50" : ""
                  }`}
                  onClick={() => isClickable && onStageClick(index)}
                >
                  {/* Circle */}
                  <div
                    className={`relative z-10 w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${fillClasses} ${ringClasses}`}
                  >
                    <StageIcon type={stage.type} small />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`font-medium ${
                          isCompleted || isViewing
                            ? "text-slate-900"
                            : "text-slate-400"
                        }`}
                      >
                        {stage.title}
                      </span>
                      {stage.optional && (
                        <span className="text-xs text-slate-400 border border-slate-200 rounded px-1">
                          Optional
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-slate-500 mt-0.5">
                      {stage.type === "chat"
                        ? "Discuss with AI tutor"
                        : stage.duration ||
                          (stage.type === "article" ? "Article" : "Video")}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Action button */}
      {showActions && onStartModule && (
        <div className="pt-6 mt-auto border-t border-slate-100">
          <button
            onClick={onStartModule}
            className="w-full py-3 px-4 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            {getActionLabel()}
          </button>
        </div>
      )}
    </div>
  );
}
