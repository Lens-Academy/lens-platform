import { useState } from "react";
import { DISCORD_INVITE_URL } from "../config";
import CookieSettings from "./CookieSettings";

export function LandingFooter() {
  const [showCookieSettings, setShowCookieSettings] = useState(false);

  return (
    <>
      <footer
        className="border-t py-12 px-4"
        style={{
          fontFamily: "var(--landing-font-body)",
          borderColor: "var(--landing-border)",
          backgroundColor: "var(--landing-bg)",
          color: "var(--landing-text-muted)",
        }}
      >
        <div className="max-w-4xl mx-auto text-center">
          <nav className="flex items-center justify-center gap-8 mb-6 text-sm font-medium">
            <a
              href="/course/default"
              className="hover:text-[var(--landing-text)] transition-colors"
            >
              Courses
            </a>
            <a
              href={DISCORD_INVITE_URL}
              className="hover:text-[var(--landing-text)] transition-colors"
            >
              Community
            </a>
            <a
              href="/about"
              className="hover:text-[var(--landing-text)] transition-colors"
            >
              About
            </a>
          </nav>
          <div className="flex items-center justify-center gap-4 mb-6 text-sm">
            <a
              href="/privacy"
              className="hover:text-[var(--landing-text)] transition-colors"
            >
              Privacy Policy
            </a>
            <span>·</span>
            <a
              href="/terms"
              className="hover:text-[var(--landing-text)] transition-colors"
            >
              Terms of Service
            </a>
            <span>·</span>
            <button
              onClick={() => setShowCookieSettings(true)}
              className="hover:text-[var(--landing-text)] transition-colors"
            >
              Cookie Settings
            </button>
          </div>
          <p className="text-sm">Lens Academy is a registered nonprofit.</p>
        </div>
      </footer>

      <CookieSettings
        isOpen={showCookieSettings}
        onClose={() => setShowCookieSettings(false)}
      />
    </>
  );
}
