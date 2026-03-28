import { useEffect, useState } from "react";
import { useMedia } from "react-use";
import { Menu, X } from "lucide-react";
import { Popover } from "./Popover";
import { CoursesDropdown, UserMenu } from "./nav";
import { DISCORD_INVITE_URL } from "../config";

const NAV_LINKS = [
  { label: "Community", href: DISCORD_INVITE_URL, external: true as const },
  { label: "About", href: "/about", external: false as const },
  { label: "Referrals", href: "/referrals", external: false as const },
];

const CTA_HREF = "/course/default/module/introduction";

export function LandingNav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const isMobile = useMedia("(max-width: 767px)", false);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (menuOpen) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [menuOpen]);

  return (
    <>
      <nav
        className={`
          fixed top-0 left-0 right-0 z-50
          backdrop-blur-md border-b
          transition-transform duration-300
          translate-y-0
        `}
        style={{
          backgroundColor:
            "color-mix(in srgb, var(--landing-bg) 80%, transparent)",
          borderColor: "var(--landing-border)",
          fontFamily: "var(--landing-font-body)",
        }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <a href="/" className="flex items-center gap-2">
              <img
                src="/assets/Logo_magnifying_glass.png"
                alt="Lens Academy"
                className="h-8"
              />
              <span
                className="text-xl font-medium"
                style={{
                  color: "var(--landing-text)",
                  fontFamily: "var(--landing-font-display)",
                }}
              >
                Lens Academy
              </span>
            </a>

            {isMobile ? (
              /* Mobile: hamburger button */
              <button
                onClick={() => setMenuOpen(true)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center transition-colors"
                style={{ color: "var(--landing-text-muted)" }}
                aria-label="Open menu"
              >
                <Menu className="w-6 h-6" />
              </button>
            ) : (
              /* Desktop: nav links + user menu + CTA */
              <div className="flex items-center gap-6">
                <Popover
                  placement="bottom-start"
                  hover
                  className="bg-[var(--landing-bg)] border border-[var(--landing-border)] rounded-lg shadow-lg p-2 z-50 min-w-[220px]"
                  content={(close) => <CoursesDropdown onNavigate={close} />}
                >
                  <button
                    className="text-sm font-medium transition-colors duration-200 hover:text-[var(--landing-text)]"
                    style={{ color: "var(--landing-text-muted)" }}
                  >
                    Courses
                  </button>
                </Popover>
                {NAV_LINKS.map((link) => (
                  <a
                    key={link.label}
                    href={link.href}
                    className="text-sm font-medium transition-colors duration-200 hover:text-[var(--landing-text)]"
                    style={{ color: "var(--landing-text-muted)" }}
                    {...(link.external
                      ? { target: "_blank", rel: "noopener noreferrer" }
                      : {})}
                  >
                    {link.label}
                  </a>
                ))}
                <UserMenu signInRedirect="/course" compact />
                <a
                  href={CTA_HREF}
                  className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-semibold transition-colors duration-200"
                  style={{
                    backgroundColor: "var(--landing-accent)",
                    color: "var(--landing-accent-text)",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.backgroundColor =
                      "var(--landing-accent-hover)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.backgroundColor =
                      "var(--landing-accent)")
                  }
                >
                  Start Learning
                </a>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Landing mobile menu overlay */}
      {/* Backdrop */}
      <div
        className={`
          fixed inset-0 bg-black/50 z-50
          transition-opacity duration-300
          ${menuOpen ? "opacity-100" : "opacity-0 pointer-events-none"}
        `}
        onClick={() => setMenuOpen(false)}
        aria-hidden="true"
      />

      {/* Menu panel */}
      <div
        className={`
          fixed top-0 right-0 h-dvh w-[80%] max-w-sm
          z-60
          transition-transform duration-300 [transition-timing-function:var(--ease-spring)]
          ${menuOpen ? "translate-x-0" : "translate-x-full"}
        `}
        style={{
          backgroundColor: "var(--landing-bg)",
          fontFamily: "var(--landing-font-body)",
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
            onClick={() => setMenuOpen(false)}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center transition-transform active:scale-95"
            style={{ color: "var(--landing-text-muted)" }}
            aria-label="Close menu"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Navigation links */}
        <nav className="flex flex-col gap-6 px-6 pt-4">
          <div>
            <div
              className="text-sm font-medium uppercase tracking-wide mb-1"
              style={{ color: "var(--landing-text-muted)" }}
            >
              Courses
            </div>
            <CoursesDropdown onNavigate={() => setMenuOpen(false)} />
          </div>
          {NAV_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className="text-lg font-medium py-3 transition-transform active:scale-[0.97]"
              style={{ color: "var(--landing-text)" }}
              {...(link.external
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
            >
              {link.label}
            </a>
          ))}

          {/* CTA button */}
          <a
            href={CTA_HREF}
            onClick={() => setMenuOpen(false)}
            className="inline-flex items-center justify-center px-4 py-3 rounded-lg text-base font-semibold transition-colors duration-200 mt-2"
            style={{
              backgroundColor: "var(--landing-accent)",
              color: "var(--landing-accent-text)",
            }}
          >
            Start Learning
          </a>

          <div
            className="border-t pt-6"
            style={{ borderColor: "var(--landing-border)" }}
          >
            <UserMenu signInRedirect="/course" inline />
          </div>
        </nav>
      </div>
    </>
  );
}
