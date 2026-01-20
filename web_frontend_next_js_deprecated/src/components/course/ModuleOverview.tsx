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
  currentStageIndex: number | null;
  viewedStageIndex?: number | null; // Which stage is currently being viewed (for selection ring)
  onStageClick?: (index: number) => void;
  onStartModule?: () => void;
  showActions?: boolean;
};

export default function ModuleOverview({
  moduleTitle,
  stages,
  status,
  currentStageIndex,
  viewedStageIndex,
  onStageClick,
  onStartModule,
  showActions = true,
}: ModuleOverviewProps) {
  const effectiveCurrentIndex = currentStageIndex ?? -1;
  const effectiveViewedIndex = viewedStageIndex ?? effectiveCurrentIndex;

  const getStageState = (index: number) => {
    if (status === "completed") return "completed";
    if (index < effectiveCurrentIndex) return "completed";
    if (index === effectiveCurrentIndex) return "current";
    return "future";
  };

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
          <div className="absolute left-[1.125rem] top-5 bottom-5 w-0.5 -translate-x-1/2 bg-slate-200" />
          {status !== "not_started" && (
            <div
              className="absolute left-[1.125rem] top-5 w-0.5 -translate-x-1/2 bg-blue-500 transition-all duration-300"
              style={{
                height:
                  status === "completed"
                    ? "calc(100% - 2.5rem)"
                    : `calc(${((effectiveCurrentIndex + 0.5) / stages.length) * 100}% - 1.25rem)`,
              }}
            />
          )}

          {/* Stages */}
          <div className="space-y-2">
            {stages.map((stage, index) => {
              const state = getStageState(index);
              const isClickable = onStageClick && stage.type !== "chat";
              const isViewed = index === effectiveViewedIndex;

              return (
                <div
                  key={index}
                  className={`flex items-center gap-4 py-2 rounded-lg ${
                    isClickable ? "cursor-pointer hover:bg-slate-50" : ""
                  }`}
                  onClick={() => isClickable && onStageClick(index)}
                >
                  {/* Circle - ring shows for viewed stage, dashed border for optional */}
                  <div
                    className={`relative z-10 w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                      stage.optional
                        ? "bg-white border-2 border-dashed border-slate-400 text-slate-400"
                        : state === "completed" || state === "current"
                          ? "bg-blue-500 text-white"
                          : "bg-slate-300 text-slate-500"
                    } ${isViewed ? "ring-2 ring-offset-2 ring-blue-500" : ""}`}
                  >
                    <StageIcon type={stage.type} small />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`font-medium ${
                          state === "future"
                            ? "text-slate-400"
                            : "text-slate-900"
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
