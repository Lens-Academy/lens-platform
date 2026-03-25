import { useEffect, useState } from "react";
import { useMedia } from "react-use";
import { Menu } from "lucide-react";
import CookieSettings from "./CookieSettings";
import { Popover } from "./Popover";
import { CoursesDropdown } from "./nav/CoursesDropdown";
import { BottomNav, DiscordInviteButton, MobileMenu, UserMenu } from "./nav";
import { useScrollDirection } from "../hooks/useScrollDirection";

export default function Layout({
  children,
  hideFooter,
  fullWidth,
}: {
  children: React.ReactNode;
  hideFooter?: boolean;
  fullWidth?: boolean;
}) {
  const [showCookieSettings, setShowCookieSettings] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const isMobile = useMedia("(max-width: 767px)", false);
  const scrollDirection = useScrollDirection(100);

  // Hide header on scroll down, but keep visible when menu is open
  const shouldHideHeader = scrollDirection === "down" && !menuOpen;

  // Pipe header visibility into CSS variable for sticky dependents
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--header-offset",
      shouldHideHeader ? "0px" : "64px",
    );
  }, [shouldHideHeader]);

  return (
    <div className="min-h-dvh bg-[var(--brand-bg)] text-[var(--brand-text)] antialiased flex flex-col">
      <nav
        className={`
          fixed top-0 left-0 right-0 z-50
          backdrop-blur-md bg-[var(--brand-bg)]/70 border-b border-[var(--brand-border)]/50
          transition-transform duration-300
          ${shouldHideHeader ? "-translate-y-full" : "translate-y-0"}
        `}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <a href="/" className="flex items-center gap-2">
              <img
                src="/assets/Logo_magnifying_glass.png"
                alt="Lens Academy"
                className="h-8"
              />
              <span
                className="text-xl font-medium"
                style={{
                  color: "var(--brand-text)",
                  fontFamily: "var(--brand-font-display)",
                }}
              >
                Lens Academy
              </span>
            </a>

            {isMobile ? (
              /* Mobile: hamburger menu button */
              <button
                onClick={() => setMenuOpen(true)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]"
                aria-label="Open menu"
              >
                <Menu className="w-6 h-6" />
              </button>
            ) : (
              /* Desktop: full navigation */
              <div className="flex items-center gap-4">
                <Popover
                  placement="bottom-start"
                  hover
                  className="bg-[var(--brand-bg)] border border-[var(--brand-border)] rounded-lg shadow-lg p-2 z-50 min-w-[220px]"
                  content={(close) => <CoursesDropdown onNavigate={close} />}
                >
                  <button
                    className="text-[var(--brand-text-muted)] font-medium text-sm hover:text-[var(--brand-text)] transition-colors duration-200"
                  >
                    Courses
                  </button>
                </Popover>
                <DiscordInviteButton />
                <UserMenu />
              </div>
            )}
          </div>
        </div>
      </nav>

      <main
        className={`${fullWidth ? "px-3 pt-18" : "max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-24"} pb-16 md:pb-0 flex-1`}
      >
        {children}
      </main>

      {!hideFooter && (
        <footer className="border-t border-[var(--brand-border)] py-6 mt-auto">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-center gap-4 text-sm text-[var(--brand-text-muted)]">
              <a href="/privacy" className="hover:text-[var(--brand-text)]">
                Privacy Policy
              </a>
              <span>·</span>
              <a href="/terms" className="hover:text-[var(--brand-text)]">
                Terms of Service
              </a>
              <span>·</span>
              <button
                onClick={() => setShowCookieSettings(true)}
                className="hover:text-[var(--brand-text)]"
              >
                Cookie Settings
              </button>
            </div>
          </div>
        </footer>
      )}

      <CookieSettings
        isOpen={showCookieSettings}
        onClose={() => setShowCookieSettings(false)}
      />

      <MobileMenu isOpen={menuOpen} onClose={() => setMenuOpen(false)} />

      <BottomNav />
    </div>
  );
}
