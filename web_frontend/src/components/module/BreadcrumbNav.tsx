import { forwardRef } from "react";
import { ChevronDown } from "lucide-react";
import type { ModuleInfo } from "@/types/course";

const hiddenStyle: React.CSSProperties = {
  visibility: "hidden",
  position: "absolute",
  pointerEvents: "none",
};

interface BreadcrumbNavProps {
  unitName: string;
  currentModuleSlug: string;
  unitModules: ModuleInfo[];
  priority: number;
  onToggleSidebar: () => void;
}

const BreadcrumbNav = forwardRef<HTMLElement, BreadcrumbNavProps>(
  function BreadcrumbNav(
    { unitName, currentModuleSlug, unitModules, priority, onToggleSidebar },
    ref,
  ) {
    const hasMultipleModules = unitModules.length > 1;
    const currentModule = unitModules.find((m) => m.slug === currentModuleSlug);
    const moduleName = currentModule?.title ?? currentModuleSlug;

    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        onClick={onToggleSidebar}
        className="text-sm font-display cursor-pointer hover:bg-black/5 rounded-md px-1.5 py-1 -mx-1.5 transition-colors truncate max-w-full"
        style={priority >= 4 ? hiddenStyle : undefined}
      >
        {hasMultipleModules && (
          <>
            <span className="text-[#9a5c10]">{unitName}</span>
            <span className="text-gray-300 mx-1">&rsaquo;</span>
          </>
        )}
        <span className="font-semibold text-gray-900">{moduleName}</span>
        <ChevronDown className="w-3.5 h-3.5 text-gray-400 ml-1 inline align-middle" />
      </button>
    );
  },
);

export default BreadcrumbNav;
