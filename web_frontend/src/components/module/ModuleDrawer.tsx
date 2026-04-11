/**
 * Slide-out drawer for unit navigation.
 * Owns its own open/close state; parent triggers via imperative toggle() ref.
 *
 * Desktop: slides down from below the header (translate-y).
 * Mobile:  slides in from the left edge (translate-x) with swipe support.
 */

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import { useMedia } from "react-use";
import { useScrollContainer } from "@/hooks/useScrollContainer";
import { useSwipePanel } from "@/hooks/useSwipePanel";
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
  /** When true, disables swipe-to-open (e.g. chat sidebar is open). */
  chatOpen?: boolean;
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
      chatOpen = false,
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
    const handleOpen = useCallback(() => setIsOpen(true), []);

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

    // --- Swipe gesture support (mobile only) ---
    const panelRef = useRef<HTMLDivElement>(null);
    const backdropRef = useRef<HTMLDivElement>(null);
    useSwipePanel({
      isOpen,
      onOpen: handleOpen,
      onClose: handleClose,
      enabled: isMobile && !chatOpen,
      panelRef,
      backdropRef,
      side: "left",
    });

    return (
      <>
        {/* Backdrop — always rendered on mobile so swipe gestures work */}
        {isMobile ? (
          <div
            ref={backdropRef}
            className={`fixed inset-0 z-30 bg-black/50 transition-opacity duration-300 ${
              isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
            }`}
            onMouseDown={handleClose}
          />
        ) : (
          isOpen && (
            <div
              className="fixed inset-0 z-30 transition-opacity duration-300"
              onMouseDown={handleClose}
            />
          )
        )}

        {/* Drawer panel */}
        <div
          ref={isMobile ? panelRef : undefined}
          className={
            isMobile
              ? // Mobile: slide from left
                `fixed left-0 z-[35] w-full transition-transform duration-300 ease-in-out ${
                  isOpen
                    ? "translate-x-0 shadow-[8px_0_30px_-5px_rgba(0,0,0,0.2)]"
                    : "-translate-x-full"
                }`
              : // Desktop: slide from top (unchanged)
                `fixed left-0 z-[35] w-[572px] transition-transform duration-300 [transition-timing-function:var(--ease-spring)] ${
                  isOpen
                    ? "translate-y-0 shadow-[8px_0_30px_-5px_rgba(0,0,0,0.2)]"
                    : "-translate-y-[calc(100%+2rem)]"
                }`
          }
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
