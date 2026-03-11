import { useEffect, useRef, type RefObject } from "react";
import { LandingNav } from "@/components/LandingNav";
import { LandingFooter } from "@/components/LandingFooter";
import { Target, MessageSquare, Users } from "lucide-react";

// ---------------------------------------------------------------------------
// useReveal — fade-in-up on scroll via IntersectionObserver
// ---------------------------------------------------------------------------
function useReveal(threshold = 0.15): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Respect prefers-reduced-motion
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) {
      el.style.opacity = "1";
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("revealed");
          observer.unobserve(el);
        }
      },
      { threshold },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return ref;
}

// Convenience wrapper that returns style + ref for a reveal section
function RevealSection({
  children,
  className = "",
  style,
  as: Tag = "section",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  as?: "section" | "div" | "footer";
  delay?: number;
}) {
  const ref = useReveal(0.12);
  return (
    <Tag
      ref={ref}
      className={`reveal-section ${className}`}
      style={{
        transitionDelay: `${delay}ms`,
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}

// ---------------------------------------------------------------------------
// Shared style objects
// ---------------------------------------------------------------------------
const fontDisplay: React.CSSProperties = {
  fontFamily: "var(--landing-font-display)",
};
const fontBody: React.CSSProperties = {
  fontFamily: "var(--landing-font-body)",
};

// ---------------------------------------------------------------------------
// Product screenshot — swap placeholder for real image when asset is ready
// ---------------------------------------------------------------------------
const SCREENSHOT_SRC = "/assets/screenshots/course-interface.png";

function ProductScreenshot() {
  if (!SCREENSHOT_SRC) {
    return (
      <div
        className="aspect-video flex items-center justify-center"
        style={{ color: "var(--landing-text-muted)" }}
      >
        <span className="text-sm">Screenshot coming soon</span>
      </div>
    );
  }
  return (
    <img
      src={SCREENSHOT_SRC}
      alt="Lens Academy course interface with AI tutor"
      className="w-full block"
    />
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function LandingPage() {
  return (
    <div
      className="min-h-dvh antialiased"
      style={{
        backgroundColor: "var(--landing-bg)",
        color: "var(--landing-text)",
        ...fontBody,
      }}
    >
      {/* Reveal animation styles */}
      <style>{`
        .reveal-section {
          opacity: 0;
          transform: translateY(24px);
          transition: opacity 0.7s ease-out, transform 0.7s ease-out;
        }
        .reveal-section.revealed {
          opacity: 1;
          transform: translateY(0);
        }
        @media (prefers-reduced-motion: reduce) {
          .reveal-section {
            opacity: 1;
            transform: none;
            transition: none;
          }
        }
      `}</style>

      <LandingNav />

      {/* ================================================================= */}
      {/* HERO                                                              */}
      {/* ================================================================= */}
      <section
        className="relative pt-28 pb-20 sm:pt-36 sm:pb-28 lg:pt-44 lg:pb-36 px-4"
        style={{ backgroundColor: "var(--landing-bg)" }}
      >
        {/* Subtle decorative dot grid */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.035]"
          style={{
            backgroundImage:
              "radial-gradient(circle, var(--landing-text) 0.8px, transparent 0.8px)",
            backgroundSize: "24px 24px",
          }}
        />

        <div className="relative z-10 max-w-4xl mx-auto text-center">
          <h1
            className="text-[2.25rem] sm:text-[3.5rem] lg:text-[4.25rem] leading-[1.08] tracking-tight mb-8"
            style={fontDisplay}
          >
            Some of the smartest people alive are worried about AI. Understand
            why.
          </h1>

          <p
            className="text-lg sm:text-xl max-w-2xl mx-auto mb-10 leading-relaxed"
            style={{ color: "var(--landing-text-muted)" }}
          >
            Learn why superintelligent AI could be catastrophic for
            humanity&thinsp;&mdash;&thinsp;and what to do about it.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-6">
            <a
              href="/course/default/module/introduction"
              className="inline-flex items-center justify-center px-7 py-3.5 rounded-lg text-base font-semibold transition-colors duration-200"
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
            <a
              href="/enroll"
              className="inline-flex items-center justify-center px-7 py-3.5 rounded-lg text-base font-semibold border transition-colors duration-200"
              style={{
                borderColor: "var(--landing-border)",
                color: "var(--landing-text)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "var(--landing-bg-alt)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              Enroll in the Course
            </a>
          </div>

          <p
            className="text-sm mb-2"
            style={{ color: "var(--landing-text-muted)" }}
          >
            Get started in under 1 minute. Continue for as long as you like.
          </p>
          <p className="text-sm" style={{ color: "var(--landing-text-muted)" }}>
            Free for you. Funded by people who believe AI Safety education
            should reach everyone.
          </p>
        </div>
      </section>

      {/* ================================================================= */}
      {/* SCREENSHOT                                                        */}
      {/* ================================================================= */}
      <RevealSection className="py-20 sm:py-28 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-[3fr_2fr] gap-8 md:gap-12 items-center">
            <div
              className="rounded-xl overflow-hidden"
              style={{
                border: "1px solid var(--landing-border)",
                boxShadow:
                  "0 4px 6px -1px rgba(0,0,0,0.04), 0 20px 50px -12px rgba(0,0,0,0.08)",
              }}
            >
              <ProductScreenshot />
            </div>
            <div>
              <h2
                className="text-2xl sm:text-3xl mb-4 leading-snug"
                style={fontDisplay}
              >
                A tailor-made learning experience
              </h2>
              <p
                className="text-base leading-relaxed"
                style={{ color: "var(--landing-text-muted)" }}
              >
                Designed by a team with years of AI Safety experience and formal
                training in education. We&rsquo;re building a learning
                experience grounded in evidence-based
                principles&thinsp;&mdash;&thinsp;from the course design to the
                AI tutor.
              </p>
            </div>
          </div>
        </div>
      </RevealSection>

      {/* ================================================================= */}
      {/* WHAT MAKES THIS DIFFERENT                                         */}
      {/* ================================================================= */}
      <section
        className="py-20 sm:py-28 px-4"
        style={{ backgroundColor: "var(--landing-bg-alt)" }}
      >
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8 lg:gap-12">
          {(
            [
              {
                icon: Target,
                title: "Focused, Not Broad",
                body: "AI raises many risks. We help you focus on what matters most: why superintelligent AI could go very wrong, and what to do about it.",
              },
              {
                icon: MessageSquare,
                title: "AI Tutoring",
                body: "Your AI tutor meets you where you are, challenges your reasoning, and stays with you until things actually click.",
              },
              {
                icon: Users,
                title: "Group Discussions",
                body: "You\u2019re not figuring this out alone. Weekly group discussions with others who care about getting things right.",
              },
            ] as const
          ).map((card, i) => (
            <RevealSection
              key={card.title}
              as="div"
              delay={i * 120}
              className="p-8 rounded-xl"
              style={{
                backgroundColor: "var(--landing-bg)",
                border: "1px solid var(--landing-border)",
              }}
            >
              <card.icon
                className="w-7 h-7 mb-5"
                style={{ color: "var(--landing-accent)" }}
                strokeWidth={1.5}
              />
              <h3
                className="text-xl sm:text-2xl mb-3 leading-snug"
                style={fontDisplay}
              >
                {card.title}
              </h3>
              <p
                className="text-base leading-relaxed"
                style={{ color: "var(--landing-text-muted)" }}
              >
                {card.body}
              </p>
            </RevealSection>
          ))}
        </div>
      </section>

      {/* ================================================================= */}
      {/* OUR COURSES                                                       */}
      {/* ================================================================= */}
      <RevealSection className="py-20 sm:py-28 px-4">
        <div className="max-w-5xl mx-auto">
          <h2
            className="text-3xl sm:text-4xl mb-12 text-center"
            style={fontDisplay}
          >
            Our Courses
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Course 1 */}
            <div
              className="p-8 sm:p-10 rounded-xl flex flex-col"
              style={{
                backgroundColor: "var(--landing-bg-alt)",
                border: "1px solid var(--landing-border)",
              }}
            >
              <span
                className="inline-block self-start text-xs font-semibold tracking-wide uppercase px-3 py-1 rounded-full mb-5"
                style={{
                  backgroundColor: "var(--landing-accent)",
                  color: "var(--landing-accent-text)",
                }}
              >
                Available now
              </span>
              <h3
                className="text-2xl sm:text-3xl mb-4 leading-snug"
                style={fontDisplay}
              >
                Introduction to AI Safety
              </h3>
              <p
                className="text-base leading-relaxed mb-8 flex-1"
                style={{ color: "var(--landing-text-muted)" }}
              >
                The core arguments for why superintelligence poses an
                existential risk, what makes alignment genuinely hard, and how
                to think about what to do about it. Interactive, tutor-guided,
                and free.
              </p>
              <div className="flex flex-wrap gap-3">
                <a
                  href="/course/default/module/introduction"
                  className="inline-flex items-center justify-center px-6 py-3 rounded-lg text-sm font-semibold transition-colors duration-200"
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
                <a
                  href="/course/default"
                  className="inline-flex items-center justify-center px-6 py-3 rounded-lg text-sm font-semibold border transition-colors duration-200"
                  style={{
                    borderColor: "var(--landing-border)",
                    color: "var(--landing-text)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "var(--landing-bg)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "transparent";
                  }}
                >
                  Browse Curriculum
                </a>
              </div>
            </div>

            {/* Course 2 */}
            <div
              className="p-8 sm:p-10 rounded-xl flex flex-col"
              style={{
                backgroundColor: "var(--landing-bg-alt)",
                border: "1px solid var(--landing-border)",
              }}
            >
              <span
                className="inline-block self-start text-xs font-semibold tracking-wide uppercase px-3 py-1 rounded-full mb-5 border"
                style={{
                  borderColor: "var(--landing-border)",
                  color: "var(--landing-text-muted)",
                }}
              >
                Starting April 2026
              </span>
              <h3
                className="text-2xl sm:text-3xl mb-4 leading-snug"
                style={fontDisplay}
              >
                Book Club: If Anyone Builds It, Everyone Dies
              </h3>
              <p
                className="text-base leading-relaxed mb-8 flex-1"
                style={{ color: "var(--landing-text-muted)" }}
              >
                Read and discuss the book together with a cohort. Weekly
                sessions exploring the arguments, evidence, and implications
                with fellow students and an AI tutor.
              </p>
              <p
                className="text-sm font-semibold"
                style={{ color: "var(--landing-text-muted)" }}
              >
                Available soon
              </p>
            </div>
          </div>
        </div>
      </RevealSection>

      {/* ================================================================= */}
      {/* BOTTOM CTA                                                        */}
      {/* ================================================================= */}
      <RevealSection className="py-20 sm:py-28 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl mb-8" style={fontDisplay}>
            Start learning today
          </h2>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-6">
            <a
              href="/course/default/module/introduction"
              className="inline-flex items-center justify-center px-7 py-3.5 rounded-lg text-base font-semibold transition-colors duration-200"
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
              Try the intro module
            </a>
            <a
              href="/enroll"
              className="inline-flex items-center justify-center px-7 py-3.5 rounded-lg text-base font-semibold border transition-colors duration-200"
              style={{
                borderColor: "var(--landing-border)",
                color: "var(--landing-text)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "var(--landing-bg-alt)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              Enroll in the Course
            </a>
          </div>

          <p className="text-sm" style={{ color: "var(--landing-text-muted)" }}>
            Free. No application process. Takes 1 minute to get started.
          </p>
        </div>
      </RevealSection>

      {/* ================================================================= */}
      {/* FOOTER                                                            */}
      {/* ================================================================= */}
      <LandingFooter />
    </div>
  );
}
