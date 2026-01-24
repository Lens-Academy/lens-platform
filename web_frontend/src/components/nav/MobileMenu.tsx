import { useEffect } from "react";
import { X } from "lucide-react";
import { DiscordInviteButton } from "./DiscordInviteButton";
import { UserMenu } from "./UserMenu";

interface MobileMenuProps {
  isOpen: boolean;
  onClose: () => void;
  signInRedirect?: string;
}

/**
 * Full-screen mobile menu overlay with navigation links.
 * Slides in from right with backdrop dismissal.
 */
export function MobileMenu({
  isOpen,
  onClose,
  signInRedirect,
}: MobileMenuProps) {
  // Lock body scroll when menu is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [isOpen]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`
          fixed inset-0 bg-black/50 z-50
          transition-opacity duration-300
          ${isOpen ? "opacity-100" : "opacity-0 pointer-events-none"}
        `}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Menu panel */}
      <div
        className={`
          fixed top-0 right-0 h-dvh w-[80%] max-w-sm
          bg-white z-60
          transition-transform duration-300 [transition-timing-function:var(--ease-spring)]
          ${isOpen ? "translate-x-0" : "translate-x-full"}
        `}
        style={{
          paddingTop: "var(--safe-top)",
          paddingBottom: "var(--safe-bottom)",
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Mobile navigation menu"
      >
        {/* Close button */}
        <div className="flex justify-end p-4">
          <button
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-600 hover:text-slate-900 transition-transform active:scale-95"
            aria-label="Close menu"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Navigation links */}
        <nav className="flex flex-col gap-6 px-6 pt-4">
          <a
            href="/course"
            onClick={onClose}
            className="text-lg font-medium text-slate-900 py-3 transition-transform active:scale-[0.97]"
          >
            Course
          </a>

          <div className="py-2">
            <DiscordInviteButton />
          </div>

          <div className="border-t border-slate-200 pt-6">
            <UserMenu signInRedirect={signInRedirect} />
          </div>
        </nav>
      </div>
    </>
  );
}
