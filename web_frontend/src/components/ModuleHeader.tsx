import { useHeaderLayout } from "../hooks/useHeaderLayout";
import StageProgressBar from "./module/StageProgressBar";
import { UserMenu } from "./nav/UserMenu";
import type { Stage } from "../types/module";

interface ModuleHeaderProps {
  moduleTitle: string;
  stages: Stage[];
  currentStageIndex: number;
  viewingStageIndex: number | null;
  isViewingOther: boolean;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onStageClick: (index: number) => void;
  onPrevious: () => void;
  onNext: () => void;
  onReturnToCurrent: () => void;
  onSkipSection: () => void;
}

export function ModuleHeader({
  moduleTitle,
  stages,
  currentStageIndex,
  viewingStageIndex,
  isViewingOther,
  canGoPrevious,
  canGoNext,
  onStageClick,
  onPrevious,
  onNext,
  onReturnToCurrent,
  onSkipSection,
}: ModuleHeaderProps) {
  const [
    { needsTwoRows, needsTruncation },
    containerRef,
    leftRef,
    centerRef,
    rightRef,
  ] = useHeaderLayout();

  return (
    <header
      ref={containerRef}
      className="relative bg-white border-b border-gray-200 px-4 py-3 z-40"
    >
      <div className={needsTwoRows ? "flex flex-col gap-3" : ""}>
        {/* First row: Spacer pattern for soft centering */}
        {/* [Left] [spacer flex-1] [Center] [spacer flex-1] [Right] */}
        {/* Spacers try to be equal, so center is centered. When sides grow, spacers shrink and center yields */}
        <div className="flex items-center">
          {/* Left section: Logo and title */}
          <div
            ref={leftRef}
            className={`flex items-center gap-2 ${needsTruncation ? "min-w-0" : ""}`}
          >
            <a href="/" className="flex items-center gap-1.5 shrink-0">
              <img
                src="/assets/Logo only.png"
                alt="Lens Academy"
                className="h-6"
              />
              <span className="text-lg font-semibold text-slate-800">
                Lens Academy
              </span>
            </a>
            <span className="text-slate-300 shrink-0">|</span>
            <h1
              className={`text-lg font-semibold text-gray-900 ${needsTruncation ? "truncate" : ""}`}
            >
              {moduleTitle}
            </h1>
          </div>

          {/* Left spacer */}
          <div className="flex-1 min-w-3" />

          {/* Center section: Progress bar */}
          <div
            ref={centerRef}
            className={
              needsTwoRows ? "invisible fixed -left-[9999px]" : "shrink-0"
            }
          >
            <StageProgressBar
              stages={stages}
              currentStageIndex={currentStageIndex}
              viewingStageIndex={viewingStageIndex}
              onStageClick={onStageClick}
              onPrevious={onPrevious}
              onNext={onNext}
              canGoPrevious={canGoPrevious}
              canGoNext={canGoNext}
            />
          </div>

          {/* Right spacer */}
          <div className="flex-1 min-w-3" />

          {/* Right section: Controls */}
          <div ref={rightRef} className="flex items-center gap-4">
            {/* Fixed width container to prevent layout shift when text changes */}
            <div className="w-[120px] flex justify-end">
              {isViewingOther ? (
                <button
                  onClick={onReturnToCurrent}
                  className="text-emerald-600 hover:text-emerald-700 text-sm font-medium whitespace-nowrap"
                >
                  Return to current →
                </button>
              ) : (
                <button
                  onClick={onSkipSection}
                  className="text-gray-500 hover:text-gray-700 text-sm cursor-pointer whitespace-nowrap"
                >
                  Skip section
                </button>
              )}
            </div>
            <UserMenu />
          </div>
        </div>

        {/* Second row: Progress bar (only if two-row mode) */}
        {needsTwoRows && (
          <div className="flex justify-center">
            <StageProgressBar
              stages={stages}
              currentStageIndex={currentStageIndex}
              viewingStageIndex={viewingStageIndex}
              onStageClick={onStageClick}
              onPrevious={onPrevious}
              onNext={onNext}
              canGoPrevious={canGoPrevious}
              canGoNext={canGoNext}
            />
          </div>
        )}
      </div>
    </header>
  );
}
