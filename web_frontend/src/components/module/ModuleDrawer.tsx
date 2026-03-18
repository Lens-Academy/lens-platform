/**
 * Slide-out drawer for unit navigation.
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
import { useScrollContainer } from "@/hooks/useScrollContainer";
import { X } from "lucide-react";
import type { ModuleInfo, StageInfo } from "../../types/course";
import UnitNavigationPanel from "./UnitNavigationPanel";

export type ModuleDrawerHandle = {
  toggle: () => void;
};

type ModuleDrawerProps = {
  unitName: string;
  unitModules: ModuleInfo[];
  currentModuleSlug: string;
  currentModuleSections: StageInfo[];
  completedSections: Set<number>;
  currentSectionIndex: number;
  onSectionClick: (index: number) => void;
  courseId: string;
};

const ModuleDrawer = forwardRef<ModuleDrawerHandle, ModuleDrawerProps>(
  function ModuleDrawer(
    {
      unitName,
      unitModules,
      currentModuleSlug,
      currentModuleSections,
      completedSections,
      currentSectionIndex,
      onSectionClick,
      courseId,
    },
    ref,
  ) {
    const [isOpen, setIsOpen] = useState(false);
    const isMobile = useMedia("(max-width: 767px)", false);
    const scrollContainer = useScrollContainer();

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

    // Lock scroll when drawer is open on mobile
    useEffect(() => {
      if (isMobile && isOpen) {
        const target = scrollContainer ?? document.body;
        target.style.overflow = "hidden";
        return () => {
          target.style.overflow = "";
        };
      }
    }, [isMobile, isOpen, scrollContainer]);

    const currentModule = unitModules.find((m) => m.slug === currentModuleSlug);
    const moduleTitle = currentModule?.title ?? currentModuleSlug;

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
          className={`fixed top-0 left-0 h-full z-50 transition-transform duration-300 [transition-timing-function:var(--ease-spring)] ${
            isMobile ? "w-[90%]" : "w-[572px]"
          } ${
            isOpen
              ? "translate-x-0 shadow-[8px_0_30px_-5px_rgba(0,0,0,0.2)]"
              : "-translate-x-full"
          }`}
          style={{
            paddingTop: "var(--safe-top)",
            paddingBottom: "var(--safe-bottom)",
            backgroundColor: "var(--brand-bg)",
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between p-4 border-b"
            style={{ borderColor: "var(--brand-border)" }}
          >
            <div className="flex items-center gap-1.5 min-w-0 text-sm">
              <span className="text-slate-600 truncate shrink-0 font-display">
                {unitName}
              </span>
              <span className="text-slate-400 shrink-0">&rsaquo;</span>
              <span className="font-medium text-slate-900 truncate font-display">
                {moduleTitle}
              </span>
            </div>
            <button
              onMouseDown={handleClose}
              className="p-3 min-h-[44px] min-w-[44px] hover:bg-black/5 rounded-lg transition-all active:scale-95 flex items-center justify-center shrink-0"
              title="Close sidebar"
            >
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>

          {/* Content */}
          <div className="py-4 pl-2 pr-4 h-[calc(100%-4rem)] overflow-y-auto overscroll-contain">
            <UnitNavigationPanel
              unitName={unitName}
              currentModuleSlug={currentModuleSlug}
              currentSectionIndex={currentSectionIndex}
              completedSections={completedSections}
              unitModules={unitModules}
              currentModuleSections={currentModuleSections}
              courseId={courseId}
              onSectionClick={onSectionClick}
              onClose={handleClose}
            />
          </div>
        </div>
      </>
    );
  },
);

export default ModuleDrawer;
