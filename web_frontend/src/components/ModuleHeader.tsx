import { useEffect, useRef, useState } from "react";
import { useMedia } from "react-use";
import { useScrollDirection } from "../hooks/useScrollDirection";
import { ChevronLeft, ChevronRight, Menu } from "lucide-react";
import { UserMenu } from "./nav/UserMenu";
import StageProgressBar from "./module/StageProgressBar";
import type { Stage } from "../types/module";

interface ModuleHeaderProps {
  moduleTitle: string;
  stages: Stage[];
  completedStages: Set<number>;
  currentSectionIndex: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onStageClick: (index: number) => void;
  onPrevious: () => void;
  onNext: () => void;
  onMenuToggle: () => void;
  testModeActive?: boolean;
}

export function ModuleHeader({
  moduleTitle,
  stages,
  completedStages,
  currentSectionIndex,
  canGoPrevious,
  canGoNext,
  onStageClick,
  onPrevious,
  onNext,
  onMenuToggle,
  testModeActive,
}: ModuleHeaderProps) {
  const scrollDirection = useScrollDirection(100);
  const isMobile = useMedia("(max-width: 767px)", false);

  // True viewport centering with clamped position to avoid overlap
  const containerRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const centerRef = useRef<HTMLDivElement>(null);
  const [centerX, setCenterX] = useState<number | undefined>();
  const [barFits, setBarFits] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    const left = leftRef.current;
    const right = rightRef.current;
    const center = centerRef.current;
    if (!container || !left || !right || !center) return;

    const update = () => {
      const x1 = left.offsetLeft + left.offsetWidth; // right edge of left section
      const x2 = right.offsetLeft; // left edge of right section
      const L = center.scrollWidth; // natural width of progress bar
      const mid = container.clientWidth / 2; // viewport center
      const gap = 8;
      setBarFits(x2 - x1 >= L + 2 * gap);
      setCenterX(Math.max(x1 + L / 2 + gap, Math.min(mid, x2 - L / 2 - gap)));
    };

    const ro = new ResizeObserver(update);
    ro.observe(container);
    ro.observe(left);
    ro.observe(right);
    ro.observe(center);
    update();
    return () => ro.disconnect();
  }, [isMobile]);

  // Hide header on scroll down only when viewport is compact (mobile or short)
  const isCompactViewport = useMedia(
    "(max-width: 767px), (max-height: 700px)",
    false,
  );
  const shouldHideHeader = isCompactViewport && scrollDirection === "down";

  // Pipe header visibility into CSS variable for sticky dependents
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--header-offset",
      shouldHideHeader ? "0px" : "var(--module-header-height)",
    );
  }, [shouldHideHeader]);

  // Current viewing position (1-indexed for display)
  const displayIndex = currentSectionIndex + 1;
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
      <div ref={containerRef} className="relative flex items-center justify-between px-4 py-3">
        {/* Left: Hamburger + Logo + Title */}
        <div ref={leftRef} className="flex items-center gap-2 min-w-0 flex-shrink-0">
          <button
            onMouseDown={onMenuToggle}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-gray-100 transition-all active:scale-95 shrink-0"
            aria-label="Module overview"
          >
            <Menu className="w-5 h-5 text-gray-600" />
          </button>
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

        {/* Center: Simple prev/next navigation (mobile or when progress bar doesn't fit) */}
        {(isMobile || !barFits) && stages.length > 1 && (
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

        {/* Center: StageProgressBar (desktop, truly viewport-centered with clamped position) */}
        {/* Always rendered for measurement; hidden when it doesn't fit */}
        {!isMobile && stages.length > 1 && (
          <div
            ref={centerRef}
            className={`absolute -translate-x-1/2${barFits ? "" : " invisible"}`}
            style={{ left: centerX }}
          >
            <StageProgressBar
              stages={stages}
              completedStages={completedStages}
              currentSectionIndex={currentSectionIndex}
              onStageClick={onStageClick}
              onPrevious={onPrevious}
              onNext={onNext}
              canGoPrevious={canGoPrevious}
              canGoNext={canGoNext}
              compact
              testModeActive={testModeActive}
            />
          </div>
        )}

        {/* Right: UserMenu only (skip button removed) */}
        <div ref={rightRef} className="flex items-center gap-1 md:gap-3 shrink-0">
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
