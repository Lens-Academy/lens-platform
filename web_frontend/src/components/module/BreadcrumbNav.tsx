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
  sidebarOpen?: boolean;
}

const BreadcrumbNav = forwardRef<HTMLElement, BreadcrumbNavProps>(
  function BreadcrumbNav(
    {
      unitName,
      currentModuleSlug,
      unitModules,
      priority,
      onToggleSidebar,
      sidebarOpen,
    },
    ref,
  ) {
    const hasMultipleModules = unitModules.length > 1;
    const currentModule = unitModules.find((m) => m.slug === currentModuleSlug);
    const moduleName = currentModule?.title ?? currentModuleSlug;

    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        type="button"
        className="flex! items-center min-w-0 shrink-0 whitespace-nowrap font-display text-[15px] text-gray-900 hover:text-gray-600 transition-colors cursor-pointer"
        style={priority >= 4 ? hiddenStyle : undefined}
        onMouseDown={onToggleSidebar}
      >
        {hasMultipleModules && (
          <span
            className="inline-flex items-center shrink-0"
            data-breadcrumb-unit
            style={priority >= 3 ? hiddenStyle : undefined}
          >
            <span className="whitespace-nowrap shrink-0">{unitName}</span>
            <span className="shrink-0 mx-1.5">&rsaquo;</span>
          </span>
        )}
        <span className="truncate">{moduleName}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 shrink-0 ml-1.5 transition-transform duration-200 ${
            sidebarOpen ? "rotate-180" : ""
          }`}
        />
      </button>
    );
  },
);

export default BreadcrumbNav;
