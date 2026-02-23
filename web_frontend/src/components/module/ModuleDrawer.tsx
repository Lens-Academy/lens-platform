/**
 * Slide-out drawer for module overview.
 * Owns its own open/close state; parent triggers via imperative toggle() ref.
 */

import {
  useState,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import { useMedia } from "react-use";
import { X, ChevronRight } from "lucide-react";
import type { StageInfo } from "../../types/course";
import ModuleOverview from "../course/ModuleOverview";

export type ModuleDrawerHandle = {
  toggle: () => void;
};

type ModuleDrawerProps = {
  moduleTitle: string;
  stages: StageInfo[];
  completedStages: Set<number>;
  currentSectionIndex: number;
  onStageClick: (index: number) => void;
  courseId?: string;
  courseTitle?: string;
  testModeActive?: boolean;
};

const ModuleDrawer = forwardRef<ModuleDrawerHandle, ModuleDrawerProps>(
  function ModuleDrawer(
    {
      moduleTitle,
      stages,
      completedStages,
      currentSectionIndex,
      onStageClick,
      courseId,
      courseTitle,
      testModeActive,
    },
    ref,
  ) {
    const [isOpen, setIsOpen] = useState(false);
    const isMobile = useMedia("(max-width: 767px)", false);

    useImperativeHandle(ref, () => ({
      toggle: () => setIsOpen((prev) => !prev),
    }));

    const handleClose = useCallback(() => setIsOpen(false), []);

    // Close on escape
    useEffect(() => {
      if (!isOpen) return;
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === "Escape") handleClose();
      };
      window.addEventListener("keydown", handleEscape);
      return () => window.removeEventListener("keydown", handleEscape);
    }, [isOpen, handleClose]);

    // Lock body scroll when drawer is open on mobile
    useEffect(() => {
      if (isMobile && isOpen) {
        document.body.style.overflow = "hidden";
        return () => {
          document.body.style.overflow = "";
        };
      }
    }, [isMobile, isOpen]);

    return (
      <>
        {/* Backdrop to close drawer - dimmed on mobile */}
        {isOpen && (
          <div
            className={`fixed inset-0 z-40 transition-opacity duration-300 ${
              isMobile ? "bg-black/50" : ""
            }`}
            onMouseDown={handleClose}
          />
        )}

        {/* Drawer panel - slides in from left */}
        <div
          className={`fixed top-0 left-0 h-full bg-white z-50 transition-transform duration-300 [transition-timing-function:var(--ease-spring)] ${
            isMobile ? "w-[80%]" : "w-[40%] max-w-md"
          } ${
            isOpen
              ? "translate-x-0 shadow-[8px_0_30px_-5px_rgba(0,0,0,0.2)]"
              : "-translate-x-full"
          }`}
          style={{
            paddingTop: "var(--safe-top)",
            paddingBottom: "var(--safe-bottom)",
          }}
        >
          {/* Header with breadcrumb */}
          <div className="flex items-center justify-between p-4 border-b border-slate-200">
            <div className="flex items-center gap-1.5 min-w-0 text-sm">
              {courseId ? (
                <>
                  <a
                    href={`/course/${courseId}`}
                    className="text-slate-500 hover:text-slate-900 transition-colors truncate shrink-0"
                  >
                    {courseTitle || "Course"}
                  </a>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="font-medium text-slate-900 truncate">
                    {moduleTitle}
                  </span>
                </>
              ) : (
                <span className="font-medium text-slate-900 truncate">
                  {moduleTitle}
                </span>
              )}
            </div>
            <button
              onMouseDown={handleClose}
              className="p-3 min-h-[44px] min-w-[44px] hover:bg-slate-100 rounded-lg transition-all active:scale-95 flex items-center justify-center shrink-0"
              title="Close sidebar"
            >
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>

          {/* Content */}
          <div className="p-4 h-[calc(100%-4rem)] overflow-y-auto">
            <ModuleOverview
              moduleTitle={moduleTitle}
              stages={stages}
              status="in_progress"
              completedStages={completedStages}
              currentSectionIndex={currentSectionIndex}
              onStageClick={onStageClick}
              showActions={false}
              testModeActive={testModeActive}
            />
          </div>
        </div>
      </>
    );
  },
);

export default ModuleDrawer;
