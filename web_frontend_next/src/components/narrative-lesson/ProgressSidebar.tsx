// web_frontend_next/src/components/narrative-lesson/ProgressSidebar.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { StageIcon } from "@/components/unified-lesson/StageProgressBar";
import type { NarrativeSection } from "@/types/narrative-lesson";

function getSectionLabel(section: NarrativeSection, index: number): string {
  if (section.type === "text") {
    return `Section ${index + 1}`;
  }
  return section.meta.title || `${section.type} ${index + 1}`;
}

type ProgressSidebarProps = {
  sections: NarrativeSection[];
  sectionRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  onSectionClick: (index: number) => void;
};

/**
 * JS-driven progress sidebar with 60fps positioning.
 * Uses direct DOM manipulation for smooth scrolling.
 */
export default function ProgressSidebar({
  sections,
  sectionRefs,
  onSectionClick,
}: ProgressSidebarProps) {
  // Only use state for things that need React re-render (current index for styling)
  const [currentIndex, setCurrentIndex] = useState(0);

  // Refs for direct DOM manipulation (no re-renders)
  const iconRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const rafId = useRef<number>(0);

  // Configuration
  const headerOffset = 100;
  const iconSpacing = 44;

  useEffect(() => {
    let lastCurrentIndex = 0;

    const updatePositions = () => {
      const viewportCenter = window.innerHeight / 2;
      let newCurrentIndex = 0;

      sections.forEach((_, index) => {
        const sectionEl = sectionRefs.current.get(index);
        const iconEl = iconRefs.current.get(index);
        if (!sectionEl || !iconEl) return;

        const rect = sectionEl.getBoundingClientRect();
        let iconTop: number;

        if (rect.bottom < viewportCenter) {
          // Completed: stack at top
          iconTop = headerOffset + index * iconSpacing;
        } else if (rect.top > viewportCenter) {
          // Future: follow section (clamped)
          iconTop = Math.min(rect.top, window.innerHeight - 50);
        } else {
          // Current: at center
          iconTop = viewportCenter - 20;
          newCurrentIndex = index;
        }

        // Direct DOM update - no React re-render
        iconEl.style.transform = `translateY(${iconTop}px)`;
      });

      // Only trigger React re-render when current index changes
      if (newCurrentIndex !== lastCurrentIndex) {
        lastCurrentIndex = newCurrentIndex;
        setCurrentIndex(newCurrentIndex);
      }
    };

    const handleScroll = () => {
      // Cancel any pending frame
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
      }
      rafId.current = requestAnimationFrame(updatePositions);
    };

    // Initial position
    updatePositions();

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", updatePositions);

    return () => {
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
      }
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", updatePositions);
    };
  }, [sections, sectionRefs, headerOffset, iconSpacing]);

  return (
    <div className="fixed left-4 top-0 bottom-0 z-40 w-16 pointer-events-none">
      {sections.map((section, index) => {
        const isCurrent = index === currentIndex;
        // Determine completed based on index relative to current
        const isCompleted = index < currentIndex;

        return (
          <div
            key={index}
            ref={(el) => {
              if (el) iconRefs.current.set(index, el);
            }}
            className="absolute left-1/2 -translate-x-1/2 pointer-events-auto will-change-transform"
            style={{ top: 0 }} // Position controlled by transform
          >
            <button
              onClick={() => onSectionClick(index)}
              className={`
                rounded-full flex items-center justify-center
                transition-[width,height,background-color,box-shadow] duration-150
                ${isCurrent ? "w-12 h-12" : "w-10 h-10"}
                ${
                  isCompleted
                    ? "bg-blue-500 text-white"
                    : isCurrent
                      ? "bg-blue-500 text-white ring-2 ring-offset-2 ring-blue-500"
                      : "bg-gray-200 text-gray-500"
                }
                hover:scale-110
              `}
              title={getSectionLabel(section, index)}
            >
              <StageIcon
                type={section.type === "text" ? "article" : section.type}
                small={!isCurrent}
              />
            </button>
            {isCurrent && (
              <div className="mt-1 text-xs font-medium text-gray-700 text-center max-w-[70px] leading-tight">
                {getSectionLabel(section, index)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
