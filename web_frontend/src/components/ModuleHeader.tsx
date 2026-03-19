import { useEffect, useRef, useState } from "react";
import { useMedia } from "react-use";
import { useScrollDirection } from "../hooks/useScrollDirection";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { UserMenu } from "./nav/UserMenu";
import StageProgressBar from "./module/StageProgressBar";
import BreadcrumbNav from "./module/BreadcrumbNav";
import type { Stage } from "../types/module";
import type { ModuleInfo } from "../types/course";

// CSS styles for hiding elements while keeping them measurable
const hiddenStyle: React.CSSProperties = {
  visibility: "hidden",
  position: "absolute",
  pointerEvents: "none",
};

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
  // Breadcrumb context (optional — falls back to plain title when absent)
  unitName?: string;
  unitModules?: ModuleInfo[];
  currentModuleSlug?: string;
  sidebarOpen?: boolean;
}

// 0 = show everything, 1 = hide brand, 2 = hide brand+username, 3 = compact nav, 4 = hide title
type Priority = 0 | 1 | 2 | 3 | 4;

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
  unitName,
  unitModules,
  currentModuleSlug,
  sidebarOpen,
}: ModuleHeaderProps) {
  const scrollDirection = useScrollDirection(100);

  // Ref for the header element — used to dynamically set --module-header-height
  const headerRef = useRef<HTMLElement>(null);

  // Refs for layout measurement
  const containerRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const centerRef = useRef<HTMLDivElement>(null);
  const brandRef = useRef<HTMLSpanElement>(null);
  const titleRef = useRef<HTMLElement>(null);
  const compactNavRef = useRef<HTMLDivElement>(null);

  // Priority-based visibility: single number, strictly ordered
  const [priority, setPriority] = useState<Priority>(0);
  const priorityRef = useRef<Priority>(0);

  // Cached username width (from when it was visible)
  const usernameWRef = useRef(0);
  // Cached title width (from when it was visible)
  const titleWRef = useRef(0);

  // Center position for viewport-centered progress bar
  const [centerX, setCenterX] = useState<number | undefined>();

  useEffect(() => {
    const container = containerRef.current;
    const left = leftRef.current;
    const right = rightRef.current;
    const center = centerRef.current;
    const brand = brandRef.current;
    if (!container || !left || !right) return;

    const title = titleRef.current;
    const compactNav = compactNavRef.current;

    const update = () => {
      const gap = 8;
      const containerWidth = container.clientWidth;
      const barWidth = center ? center.scrollWidth : 0;
      const curP = priorityRef.current;

      // Brand width: always measurable (position:absolute still has intrinsic width)
      const brandW = brand ? brand.offsetWidth + gap : 0;

      // Cache title width when visible (priority < 4 means title is shown)
      if (curP < 4 && title) {
        titleWRef.current = title.offsetWidth + gap;
      }
      const titleW = titleWRef.current;

      // Cache username width when visible (priority < 2 means username is shown)
      const rightWidth = right.offsetWidth;
      if (curP < 2 && rightWidth > 44) {
        usernameWRef.current = rightWidth - 44;
      }
      const usernameW = usernameWRef.current;

      // Reconstruct "full" layout widths by adding back hidden element widths.
      // When priority >= 1, brand is position:absolute so left doesn't include it.
      // When priority >= 2, username is conditionally hidden so right is smaller.
      // When priority >= 4, title is position:absolute so left doesn't include it.
      const fullLeft =
        left.offsetWidth + (curP >= 1 ? brandW : 0) + (curP >= 4 ? titleW : 0);
      const fullRight = rightWidth + (curP >= 2 ? usernameW : 0);
      // Subtract container padding (px-4 = 16px each side) since clientWidth
      // includes padding but flex children are laid out inside the content box.
      const padding =
        parseFloat(getComputedStyle(container).paddingLeft) +
        parseFloat(getComputedStyle(container).paddingRight);
      let available = containerWidth - fullLeft - fullRight - padding;

      let p: Priority = 0;
      if (available < barWidth + 2 * gap) {
        p = 1;
        available += brandW;
      }
      if (available < barWidth + 2 * gap) {
        p = 2;
        available += Math.max(0, usernameW);
      }
      if (available < barWidth + 2 * gap) {
        p = 3;
      }

      // At priority 3, compact nav replaces progress bar.
      // Check if left + compact nav + right still overflows.
      if (p >= 3) {
        const compactW = compactNav ? compactNav.offsetWidth : 0;
        // At p3, brand is hidden. Remove brandW from fullLeft to get actual left width.
        const leftAtP3 = fullLeft - brandW;
        const rightAtP3 = fullRight - usernameW;
        const totalNeeded = leftAtP3 + compactW + rightAtP3 + padding;
        if (totalNeeded + 2 * gap > containerWidth) {
          p = 4;
        }
      }

      priorityRef.current = p;
      setPriority((prev) => (prev === p ? prev : p));

      // Compute centerX for progress bar positioning
      if (center && p < 3) {
        const visX1 = left.offsetLeft + left.offsetWidth;
        const visX2 = right.offsetLeft;
        const mid = containerWidth / 2;
        setCenterX(
          Math.max(
            visX1 + barWidth / 2 + gap,
            Math.min(mid, visX2 - barWidth / 2 - gap),
          ),
        );
      }
    };

    const ro = new ResizeObserver(update);
    ro.observe(container);
    ro.observe(left);
    ro.observe(right);
    if (center) ro.observe(center);
    update();
    return () => ro.disconnect();
  }, []); // stable — no dependencies

  // Keep --module-header-height in sync with actual header size
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const ro = new ResizeObserver(() => {
      document.documentElement.style.setProperty(
        "--module-header-height",
        `${header.offsetHeight}px`,
      );
    });
    ro.observe(header);
    return () => ro.disconnect();
  }, []);

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
      ref={headerRef}
      className={`
        fixed top-0 left-0 right-0 z-40
        border-b bg-[var(--brand-bg)]
        transition-transform duration-300
        ${shouldHideHeader ? "-translate-y-full" : "translate-y-0"}
      `}
      style={{
        paddingTop: "var(--safe-top)",
        borderColor: "var(--brand-border)",
      }}
    >
      <div
        ref={containerRef}
        className="relative flex items-center justify-between px-4 py-2.5"
      >
        {/* Left: Hamburger + Logo + Brand + Title */}
        <div
          ref={leftRef}
          className="flex items-center gap-2 min-w-0 flex-shrink-0"
        >
          <a href="/" className="min-h-[44px] flex items-center shrink-0">
            <img
              src="/assets/Logo_magnifying_glass.png"
              alt="Lens Academy"
              className="h-6"
            />
          </a>
          {/* Brand separator: always in DOM for measurement, hidden at priority >= 1 */}
          <span
            ref={brandRef}
            style={priority >= 1 ? hiddenStyle : undefined}
          >
            <span className="text-gray-300 mx-1">|</span>
          </span>
          {unitName ? (
            <BreadcrumbNav
              ref={titleRef}
              unitName={unitName}
              currentModuleSlug={currentModuleSlug!}
              unitModules={unitModules!}
              priority={priority}
              onToggleSidebar={onMenuToggle}
              sidebarOpen={sidebarOpen}
            />
          ) : (
            <h1
              ref={titleRef}
              className="text-base font-semibold text-gray-900 truncate max-w-[200px] font-display"
              style={priority >= 4 ? hiddenStyle : undefined}
            >
              {moduleTitle}
            </h1>
          )}
        </div>

        {/* Center: Compact nav — always in DOM for measurement, hidden when priority < 3 */}
        {stages.length >= 1 && (
          <div
            ref={compactNavRef}
            className="flex items-center gap-1 shrink-0 mx-2"
            style={priority < 3 ? hiddenStyle : undefined}
          >
            <button
              onClick={onPrevious}
              disabled={!canGoPrevious}
              tabIndex={priority < 3 ? -1 : undefined}
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full hover:bg-black/5 disabled:opacity-30 transition-all active:scale-95"
              aria-label="Previous section"
            >
              <ChevronLeft className="w-5 h-5 text-gray-500" />
            </button>

            <span className="text-sm text-gray-500 tabular-nums min-w-[3rem] text-center">
              {displayIndex}/{totalStages}
            </span>

            <button
              onClick={onNext}
              disabled={!canGoNext}
              tabIndex={priority < 3 ? -1 : undefined}
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full hover:bg-black/5 disabled:opacity-30 transition-all active:scale-95"
              aria-label="Next section"
            >
              <ChevronRight className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        )}

        {/* Center: StageProgressBar — always in DOM for measurement, hidden when priority >= 3 */}
        {stages.length >= 1 && (
          <div
            ref={centerRef}
            className="absolute -translate-x-1/2"
            style={{
              left: centerX,
              visibility: priority < 3 ? "visible" : "hidden",
              pointerEvents: priority < 3 ? "auto" : "none",
            }}
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

        {/* Right: UserMenu */}
        <div ref={rightRef} className="flex items-center gap-1 shrink-0">
          <UserMenu compact={priority >= 2} />
        </div>
      </div>
    </header>
  );
}
