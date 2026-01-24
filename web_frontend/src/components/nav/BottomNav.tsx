import { useMedia } from "react-use";
import { Home, BookOpen } from "lucide-react";
import { useViewTransition } from "@/hooks/useViewTransition";

interface NavItemProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
}

function NavItem({ href, icon, label, isActive }: NavItemProps) {
  const { navigateWithTransition } = useViewTransition();

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    navigateWithTransition(href);
  };

  return (
    <a
      href={href}
      onClick={handleClick}
      className={`
        min-h-[44px] min-w-[44px] flex flex-col items-center justify-center gap-0.5
        transition-all duration-200 active:scale-[0.97]
        ${isActive ? "text-blue-600" : "text-slate-500 hover:text-slate-700"}
      `}
    >
      {icon}
      <span className="text-xs font-medium">{label}</span>
    </a>
  );
}

/**
 * Bottom navigation bar for mobile devices.
 * Provides quick access to primary sections.
 * Respects safe-area-inset-bottom for iOS home indicator.
 */
export function BottomNav() {
  const isMobile = useMedia("(max-width: 767px)", false);

  // Determine current page for active state
  // SSR-safe: check if window exists
  const currentPath =
    typeof window !== "undefined" ? window.location.pathname : "";
  const isHome = currentPath === "/";
  const isCourse = currentPath.startsWith("/course");

  if (!isMobile) return null;

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-slate-200"
      style={{ paddingBottom: "var(--safe-bottom)" }}
      aria-label="Mobile navigation"
    >
      <div className="flex items-center justify-around h-14">
        <NavItem
          href="/"
          icon={<Home className="w-5 h-5" />}
          label="Home"
          isActive={isHome}
        />
        <NavItem
          href="/course"
          icon={<BookOpen className="w-5 h-5" />}
          label="Course"
          isActive={isCourse}
        />
      </div>
    </nav>
  );
}
