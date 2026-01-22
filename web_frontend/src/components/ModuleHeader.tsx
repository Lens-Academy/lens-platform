import { useMedia } from "react-use";
import { useHeaderLayout } from "../hooks/useHeaderLayout";
import { useScrollDirection } from "../hooks/useScrollDirection";
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

  const scrollDirection = useScrollDirection(100);
  const isMobile = useMedia("(max-width: 767px)", false);

  // On mobile, always use two-row layout for consistent progress bar placement
  const showTwoRows = isMobile || needsTwoRows;
  const showTruncation = isMobile || needsTruncation;

  // Hide header on scroll down (100px threshold via useScrollDirection)
  const shouldHideHeader = scrollDirection === "down";

  return (
    <header
      ref={containerRef}
      className={`
        fixed top-0 left-0 right-0 z-40
        bg-white border-b border-gray-200 px-4 py-3
        transition-transform duration-300
        ${shouldHideHeader ? "-translate-y-full" : "translate-y-0"}
      `}
      style={{ paddingTop: "var(--safe-top)" }}
    >
      <div className={showTwoRows ? "flex flex-col gap-3" : ""}>
        {/* First row: Spacer pattern for soft centering */}
        {/* [Left] [spacer flex-1] [Center] [spacer flex-1] [Right] */}
        {/* Spacers try to be equal, so center is centered. When sides grow, spacers shrink and center yields */}
        <div className="flex items-center">
          {/* Left section: Logo and title */}
          <div
            ref={leftRef}
            className={`flex items-center gap-2 ${showTruncation ? "min-w-0" : ""}`}
          >
            <a
              href="/"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center gap-1.5 shrink-0"
            >
              <img
                src="/assets/Logo only.png"
                alt="Lens Academy"
                className="h-6"
              />
              {/* Hide "Lens Academy" text on mobile, show only logo */}
              <span className="text-lg font-semibold text-slate-800 hidden md:inline">
                Lens Academy
              </span>
            </a>
            <span className="text-slate-300 shrink-0 hidden md:inline">|</span>
            <h1
              className={`text-lg font-semibold text-gray-900 ${showTruncation ? "truncate" : ""}`}
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
              showTwoRows ? "invisible fixed -left-[9999px]" : "shrink-0"
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
          <div ref={rightRef} className="flex items-center gap-2 md:gap-4">
            {/* Fixed width container to prevent layout shift when text changes */}
            <div className="hidden md:flex w-[120px] justify-end">
              {isViewingOther ? (
                <button
                  onClick={onReturnToCurrent}
                  className="min-h-[44px] flex items-center text-emerald-600 hover:text-emerald-700 text-sm font-medium whitespace-nowrap"
                >
                  Return to current
                </button>
              ) : (
                <button
                  onClick={onSkipSection}
                  className="min-h-[44px] flex items-center text-gray-500 hover:text-gray-700 text-sm cursor-pointer whitespace-nowrap"
                >
                  Skip section
                </button>
              )}
            </div>
            {/* Mobile: simplified controls */}
            <div className="flex md:hidden">
              {isViewingOther ? (
                <button
                  onClick={onReturnToCurrent}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center text-emerald-600 hover:text-emerald-700 text-sm font-medium"
                  aria-label="Return to current section"
                >
                  Return
                </button>
              ) : (
                <button
                  onClick={onSkipSection}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-500 hover:text-gray-700 text-sm"
                  aria-label="Skip this section"
                >
                  Skip
                </button>
              )}
            </div>
            <UserMenu />
          </div>
        </div>

        {/* Second row: Progress bar (only if two-row mode) */}
        {showTwoRows && (
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
