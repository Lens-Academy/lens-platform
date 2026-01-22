import { useMedia } from "react-use";
import { useScrollDirection } from "../hooks/useScrollDirection";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { UserMenu } from "./nav/UserMenu";
import StageProgressBar from "./module/StageProgressBar";
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
  const scrollDirection = useScrollDirection(100);
  const isMobile = useMedia("(max-width: 767px)", false);

  // Hide header on scroll down (100px threshold via useScrollDirection)
  const shouldHideHeader = scrollDirection === "down";

  // Current viewing position (1-indexed for display)
  const displayIndex = (viewingStageIndex ?? currentStageIndex) + 1;
  const totalStages = stages.length;

  return (
    <header
      className={`
        fixed top-0 left-0 right-0 z-40
        bg-white border-b border-gray-200
        transition-transform duration-300
        ${shouldHideHeader ? "-translate-y-full" : "translate-y-0"}
      `}
      style={{ paddingTop: "var(--safe-top)" }}
    >
      <div className="relative flex items-center justify-between px-4 py-3">
        {/* Left: Logo + Title */}
        <div className="flex items-center gap-2 min-w-0 flex-shrink-0">
          <a href="/" className="min-h-[44px] flex items-center gap-2 shrink-0">
            <img
              src="/assets/Logo only.png"
              alt="Lens Academy"
              className="h-6"
            />
            <span className="hidden md:inline text-base font-semibold text-gray-900">
              Lens Academy
            </span>
          </a>
          <span className="hidden md:inline text-gray-300">|</span>
          <h1 className="text-base md:text-lg font-semibold text-gray-900 truncate max-w-[200px]">
            {moduleTitle}
          </h1>
        </div>

        {/* Center: Simple prev/next navigation (mobile only) */}
        {isMobile && (
          <div className="flex items-center gap-1 shrink-0 mx-2">
            <button
              onClick={onPrevious}
              disabled={!canGoPrevious}
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full hover:bg-gray-100 disabled:opacity-30 transition-all active:scale-95"
              aria-label="Previous section"
            >
              <ChevronLeft className="w-5 h-5 text-gray-600" />
            </button>

            <span className="text-sm text-gray-500 tabular-nums min-w-[3rem] text-center">
              {displayIndex}/{totalStages}
            </span>

            <button
              onClick={onNext}
              disabled={!canGoNext}
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full hover:bg-gray-100 disabled:opacity-30 transition-all active:scale-95"
              aria-label="Next section"
            >
              <ChevronRight className="w-5 h-5 text-gray-600" />
            </button>
          </div>
        )}

        {/* Center: StageProgressBar (desktop only) - absolutely centered */}
        {!isMobile && (
          <div className="absolute left-1/2 -translate-x-1/2">
            <StageProgressBar
              stages={stages}
              currentStageIndex={currentStageIndex}
              viewingStageIndex={viewingStageIndex}
              onStageClick={onStageClick}
              onPrevious={onPrevious}
              onNext={onNext}
              canGoPrevious={canGoPrevious}
              canGoNext={canGoNext}
              compact
            />
          </div>
        )}

        {/* Right: Skip/Return + UserMenu */}
        <div className="flex items-center gap-1 md:gap-3 shrink-0">
          {isViewingOther ? (
            <button
              onClick={onReturnToCurrent}
              className="min-h-[44px] px-3 flex items-center text-emerald-600 hover:text-emerald-700 text-sm font-medium whitespace-nowrap"
            >
              <span className="hidden md:inline">Return to current</span>
              <span className="md:hidden">Return</span>
            </button>
          ) : (
            <button
              onClick={onSkipSection}
              className="min-h-[44px] px-3 flex items-center text-gray-500 hover:text-gray-700 text-sm whitespace-nowrap"
            >
              <span className="hidden md:inline">Skip section</span>
              <span className="md:hidden">Skip</span>
            </button>
          )}
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
