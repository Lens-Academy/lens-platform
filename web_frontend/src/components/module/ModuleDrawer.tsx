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
  onOpenChange?: (open: boolean) => void;
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
      onOpenChange,
    },
    ref,
  ) {
    const [isOpen, setIsOpen] = useState(false);

    // Notify parent of open state changes
    useEffect(() => {
      onOpenChange?.(isOpen);
    }, [isOpen, onOpenChange]);
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

    return (
      <>
        {/* Backdrop to close drawer - dimmed on mobile */}
        {isOpen && (
          <div
            className={`fixed inset-0 z-30 transition-opacity duration-300 ${
              isMobile ? "bg-black/50" : ""
            }`}
            onMouseDown={handleClose}
          />
        )}

        {/* Drawer panel - below header, slides down from top */}
        <div
          className={`fixed left-0 z-[35] transition-transform duration-300 [transition-timing-function:var(--ease-spring)] ${
            isMobile ? "w-[90%]" : "w-[572px]"
          } ${
            isOpen
              ? "translate-y-0 shadow-[8px_0_30px_-5px_rgba(0,0,0,0.2)]"
              : "-translate-y-[calc(100%+2rem)]"
          }`}
          style={{
            top: "var(--module-header-height)",
            height: "calc(100dvh - var(--module-header-height))",
            paddingBottom: "var(--safe-bottom)",
            backgroundColor: "var(--brand-bg)",
          }}
        >
          {/* Content */}
          <div className="p-1 h-full">
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
