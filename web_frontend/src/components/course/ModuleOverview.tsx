/**
 * Vertical stage list with progress line.
 * Reused in course overview main panel and in-player drawer.
 */

import type { StageInfo, ModuleStatus } from "../../types/course";
import { StageIcon } from "../module/StageProgressBar";

type ModuleOverviewProps = {
  moduleTitle: string;
  stages: StageInfo[];
  status: ModuleStatus;
  completedStages: Set<number>;
  viewingIndex: number;
  onStageClick?: (index: number) => void;
  onStartModule?: () => void;
  showActions?: boolean;
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
}: ModuleOverviewProps) {
  // Calculate highest completed index for line coloring
  const highestCompleted = completedStages.size > 0
    ? Math.max(...completedStages)
    : -1;

  const getActionLabel = () => {
    if (status === "completed") return "Review Module";
    if (status === "in_progress") return "Continue Module";
    return "Start Module";
  };

  return (
    <div className="flex flex-col h-full">
      {/* Module title */}
      <h2 className="text-2xl font-bold text-slate-900 mb-6">{moduleTitle}</h2>

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
            const blueEndIndex = viewingIsAdjacent && viewingIndex > highestCompleted
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
          {viewingIndex > highestCompleted && !completedStages.has(viewingIndex - 1) && (
            <div
              className="absolute left-[1.125rem] w-0.5 -translate-x-1/2 bg-gray-400 transition-all duration-300"
              style={{
                top: highestCompleted >= 0
                  ? `calc(${((highestCompleted + 0.5) / stages.length) * 100}%)`
                  : '1.25rem',
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

              // Circle fill color logic (matches horizontal bar)
              const getCircleClasses = () => {
                if (stage.optional) {
                  return isCompleted
                    ? "bg-transparent text-blue-500 border-2 border-dashed border-blue-400"
                    : "bg-transparent text-gray-400 border-2 border-dashed border-gray-400";
                }
                if (isCompleted) {
                  return "bg-blue-500 text-white";
                }
                if (isViewing) {
                  return "bg-gray-500 text-white"; // Dark gray for viewing + not completed
                }
                return "bg-gray-200 text-gray-400"; // Light gray for not completed
              };

              // Ring color matches fill
              const getRingClasses = () => {
                if (!isViewing) return "";
                return isCompleted
                  ? "ring-2 ring-offset-2 ring-blue-500"
                  : "ring-2 ring-offset-2 ring-gray-500";
              };

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
                    className={`relative z-10 w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${getCircleClasses()} ${getRingClasses()}`}
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
