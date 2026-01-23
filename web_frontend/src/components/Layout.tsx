import { useState } from "react";
import { useMedia } from "react-use";
import { Menu } from "lucide-react";
import CookieSettings from "./CookieSettings";
import { BottomNav, DiscordInviteButton, MobileMenu, UserMenu } from "./nav";
import { useScrollDirection } from "../hooks/useScrollDirection";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [showCookieSettings, setShowCookieSettings] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const isMobile = useMedia("(max-width: 767px)", false);
  const scrollDirection = useScrollDirection(100);

  // Hide header on scroll down, but keep visible when menu is open
  const shouldHideHeader = scrollDirection === "down" && !menuOpen;

  return (
    <div className="min-h-dvh bg-stone-50 text-slate-900 antialiased flex flex-col">
      <nav
        className={`
          fixed top-0 left-0 right-0 z-50
          backdrop-blur-md bg-stone-50/70 border-b border-slate-200/50
          transition-transform duration-300
          ${shouldHideHeader ? "-translate-y-full" : "translate-y-0"}
        `}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <a href="/" className="flex items-center gap-2">
              <img
                src="/assets/Logo only.png"
                alt="Lens Academy"
                className="h-8"
              />
              <span className="text-xl font-semibold text-slate-800">
                Lens Academy
              </span>
            </a>

            {isMobile ? (
              /* Mobile: hamburger menu button */
              <button
                onClick={() => setMenuOpen(true)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-600 hover:text-slate-900"
                aria-label="Open menu"
              >
                <Menu className="w-6 h-6" />
              </button>
            ) : (
              /* Desktop: full navigation */
              <div className="flex items-center gap-4">
                <a
                  href="/course"
                  className="text-slate-600 font-medium text-sm hover:text-slate-900 transition-colors duration-200"
                >
                  Course
                </a>
                <DiscordInviteButton />
                <UserMenu />
              </div>
            )}
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-16 md:pb-0 flex-1">
        {children}
      </main>

      <footer className="border-t border-slate-200 py-6 mt-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-center gap-4 text-sm text-slate-500">
            <a href="/privacy" className="hover:text-slate-700">
              Privacy Policy
            </a>
            <span>·</span>
            <a href="/terms" className="hover:text-slate-700">
              Terms of Service
            </a>
            <span>·</span>
            <button
              onClick={() => setShowCookieSettings(true)}
              className="hover:text-slate-700"
            >
              Cookie Settings
            </button>
          </div>
        </div>
      </footer>

      <CookieSettings
        isOpen={showCookieSettings}
        onClose={() => setShowCookieSettings(false)}
      />

      <MobileMenu isOpen={menuOpen} onClose={() => setMenuOpen(false)} />

      <BottomNav />
    </div>
  );
}
