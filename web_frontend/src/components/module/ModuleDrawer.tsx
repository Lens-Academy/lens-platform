/**
 * Self-contained slide-out drawer with its own toggle.
 * Manages open/close state internally to avoid re-rendering parent.
 */

import { useState, useEffect, useCallback } from "react";
import { PanelLeftOpen, PanelLeftClose } from "lucide-react";
import type { StageInfo } from "../../types/course";
import ModuleOverview from "../course/ModuleOverview";

type ModuleDrawerProps = {
  moduleTitle: string;
  stages: StageInfo[];
  currentStageIndex: number;
  viewedStageIndex?: number;
  onStageClick: (index: number) => void;
};

export default function ModuleDrawer({
  moduleTitle,
  stages,
  currentStageIndex,
  viewedStageIndex,
  onStageClick,
}: ModuleDrawerProps) {
  // State is owned here - not in parent
  const [isOpen, setIsOpen] = useState(false);

  const handleOpen = useCallback(() => setIsOpen(true), []);
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

  return (
    <>
      {/* Floating toggle - always mounted, hidden via CSS when drawer is open */}
      <button
        onMouseDown={handleOpen}
        className={`fixed left-0 top-16 z-50 bg-white border border-l-0 border-gray-200 rounded-r-lg shadow-md px-1.5 py-3 hover:bg-gray-50 transition-colors ${
          isOpen ? "opacity-0 pointer-events-none" : ""
        }`}
        title="Module Overview"
      >
        <PanelLeftOpen className="w-5 h-5 text-slate-600" />
      </button>

      {/* Invisible click area to close drawer */}
      {isOpen && (
        <div className="fixed inset-0 z-40" onMouseDown={handleClose} />
      )}

      {/* Drawer panel - slides in from left */}
      <div
        className={`fixed top-0 left-0 h-full w-[40%] max-w-md bg-white z-50 transition-transform duration-200 ${
          isOpen
            ? "translate-x-0 shadow-[8px_0_30px_-5px_rgba(0,0,0,0.2)]"
            : "-translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h3 className="text-lg font-medium text-slate-900">
            Module Overview
          </h3>
          <button
            onMouseDown={handleClose}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            title="Close sidebar"
          >
            <PanelLeftClose className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 h-[calc(100%-4rem)] overflow-y-auto">
          <ModuleOverview
            moduleTitle={moduleTitle}
            stages={stages}
            status="in_progress"
            currentStageIndex={currentStageIndex}
            viewedStageIndex={viewedStageIndex}
            onStageClick={onStageClick}
            showActions={false}
          />
        </div>
      </div>
    </>
  );
}
