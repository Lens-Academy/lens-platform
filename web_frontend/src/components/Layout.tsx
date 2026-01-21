import { useState } from "react";
import CookieSettings from "./CookieSettings";
import { DiscordInviteButton, UserMenu } from "./nav";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [showCookieSettings, setShowCookieSettings] = useState(false);

  return (
    <div className="min-h-screen bg-stone-50 text-slate-900 antialiased flex flex-col">
      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-stone-50/70 border-b border-slate-200/50">
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
          </div>
        </div>
      </nav>
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 flex-1">
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
    </div>
  );
}
