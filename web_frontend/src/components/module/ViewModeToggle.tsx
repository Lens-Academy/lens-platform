// web_frontend_next/src/components/module/ViewModeToggle.tsx

import type { ViewMode } from "@/types/viewMode";

interface ViewModeToggleProps {
  viewMode: ViewMode;
  onChange: (mode: ViewMode) => void;
}

/**
 * Segmented control for switching between continuous scroll and paginated view.
 * Uses a sliding pill indicator to show the active selection.
 */
export default function ViewModeToggle({
  viewMode,
  onChange,
}: ViewModeToggleProps) {
  return (
    <div className="relative flex rounded-full bg-gray-200 p-0.5 text-sm">
      {/* Sliding pill indicator */}
      <div
        className={`absolute top-0.5 bottom-0.5 w-[calc(50%-2px)] bg-gray-700 rounded-full transition-transform duration-200 ease-out ${
          viewMode === "paginated" ? "translate-x-[calc(100%+2px)]" : ""
        }`}
      />

      {/* Scroll option */}
      <button
        onClick={() => onChange("continuous")}
        className={`relative z-10 px-3 py-1 rounded-full transition-colors duration-200 ${
          viewMode === "continuous"
            ? "text-white"
            : "text-gray-600 hover:text-gray-900"
        }`}
      >
        Scroll
      </button>

      {/* Pages option */}
      <button
        onClick={() => onChange("paginated")}
        className={`relative z-10 px-3 py-1 rounded-full transition-colors duration-200 ${
          viewMode === "paginated"
            ? "text-white"
            : "text-gray-600 hover:text-gray-900"
        }`}
      >
        Pages
      </button>
    </div>
  );
}
