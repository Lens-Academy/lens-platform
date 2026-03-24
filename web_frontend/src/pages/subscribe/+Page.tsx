import { useState, useEffect } from "react";
import { LandingNav } from "@/components/LandingNav";
import { LandingFooter } from "@/components/LandingFooter";
import { API_URL } from "@/config";

type CourseMode = "none" | "learner" | "navigator";

const STORAGE_KEY = "lens-prospect-submitted";

const fontDisplay: React.CSSProperties = {
  fontFamily: "var(--landing-font-display)",
};
const fontBody: React.CSSProperties = {
  fontFamily: "var(--landing-font-body)",
};

// ---------------------------------------------------------------------------
// Segmented pill
// ---------------------------------------------------------------------------
function CoursePill({
  value,
  onChange,
}: {
  value: CourseMode;
  onChange: (v: CourseMode) => void;
}) {
  const options: { val: CourseMode; label: string }[] = [
    { val: "none", label: "None" },
    { val: "learner", label: "Learner" },
    { val: "navigator", label: "Navigator" },
  ];

  return (
    <div
      className="inline-flex rounded-lg p-0.5 gap-0.5 shrink-0"
      style={{ backgroundColor: "var(--landing-border)" }}
    >
      {options.map((opt) => {
        const isActive = value === opt.val;
        const isAccent = isActive && opt.val !== "none";
        return (
          <button
            key={opt.val}
            type="button"
            onClick={() => onChange(opt.val)}
            className="px-3.5 py-1.5 text-sm font-medium rounded-md transition-all duration-150 whitespace-nowrap"
            style={{
              background: isActive
                ? isAccent
                  ? "var(--landing-accent)"
                  : "#fff"
                : "transparent",
              color: isAccent
                ? "var(--landing-accent-text)"
                : isActive
                  ? "var(--landing-text)"
                  : "var(--landing-text-muted)",
              boxShadow: isActive ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              cursor: "pointer",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toggle switch
// ---------------------------------------------------------------------------
function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative w-10 h-[22px] rounded-full shrink-0 transition-colors duration-200"
      style={{
        backgroundColor: checked ? "var(--landing-accent)" : "#ccc",
        cursor: "pointer",
      }}
    >
      <span
        className="absolute top-[2px] left-[2px] w-[18px] h-[18px] bg-white rounded-full shadow-sm transition-transform duration-200"
        style={{
          transform: checked ? "translateX(18px)" : "translateX(0)",
        }}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function SubscribePage() {
  const [courseMode, setCourseMode] = useState<CourseMode>("learner");
  const [subscribePosts, setSubscribePosts] = useState(true);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY)) {
      setStatus("success");
    }
  }, []);

  const handleSubmit = async () => {
    setErrorMsg("");

    if (courseMode === "none" && !subscribePosts) {
      setErrorMsg("Please select at least one option.");
      return;
    }

    const trimmed = email.trim();
    if (!trimmed || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
      setErrorMsg("Please enter a valid email address.");
      return;
    }

    setStatus("loading");

    try {
      const res = await fetch(`${API_URL}/api/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmed,
          subscribe_courses_learners: courseMode === "learner",
          subscribe_courses_navigators: courseMode === "navigator",
          subscribe_substack: subscribePosts,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { detail?: string }).detail || "Something went wrong.",
        );
      }

      localStorage.setItem(STORAGE_KEY, "1");
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setErrorMsg(
        err instanceof Error ? err.message : "Something went wrong.",
      );
    }
  };

  return (
    <div
      className="min-h-dvh antialiased flex flex-col"
      style={{
        backgroundColor: "var(--landing-bg)",
        color: "var(--landing-text)",
        ...fontBody,
      }}
    >
      <LandingNav />

      <main className="flex-1 flex items-center justify-center px-4 py-28 sm:py-36">
        <div
          className="w-full max-w-[600px] rounded-xl p-7 sm:p-8"
          style={{
            backgroundColor: "#fff",
            border: "1px solid var(--landing-border)",
            boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
          }}
        >
          {status === "success" ? (
            <div>
              <p
                className="text-base font-semibold py-2"
                style={{ color: "var(--landing-accent)" }}
              >
                You're all set! We'll keep you in the loop.
              </p>
              {subscribePosts && (
                <p
                  className="text-sm mt-1.5"
                  style={{ color: "var(--landing-text-muted)" }}
                >
                  You'll receive a confirmation email from Substack in 1–6
                  hours — please confirm it to start receiving posts. There's a
                  delay in this, so there's no need to check your email right
                  now.
                </p>
              )}
            </div>
          ) : (
            <>
              <h2
                className="text-2xl font-bold mb-1.5 leading-tight"
                style={{ ...fontDisplay, color: "var(--landing-text)" }}
              >
                Lens Academy
              </h2>
              <p
                className="text-base leading-relaxed mb-5"
                style={{ color: "var(--landing-text-muted)" }}
              >
                Free, tutor-guided courses on AI safety, with weekly group
                discussions and hands-on exercises.
              </p>

              {/* Options */}
              <div className="flex flex-col gap-3.5 mb-5">
                {/* Courses */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col gap-px">
                    <span className="text-[15px] font-semibold">Courses</span>
                    <span
                      className="text-[13px] leading-snug"
                      style={{ color: "var(--landing-text-muted)" }}
                    >
                      Get notified when courses open for enrollment
                    </span>
                  </div>
                  <CoursePill value={courseMode} onChange={setCourseMode} />
                </div>

                {/* Posts */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col gap-px">
                    <span className="text-[15px] font-semibold">Posts</span>
                    <span
                      className="text-[13px] leading-snug"
                      style={{ color: "var(--landing-text-muted)" }}
                    >
                      Get notified when Lens Academy or Luc (Lens's founder) publishes a new post
                    </span>
                  </div>
                  <Toggle
                    checked={subscribePosts}
                    onChange={setSubscribePosts}
                  />
                </div>
              </div>

              {/* Email + submit */}
              <div className="flex gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSubmit();
                  }}
                  placeholder="you@example.com"
                  className="flex-1 min-w-0 px-3.5 py-2.5 text-base rounded-lg border outline-none transition-shadow"
                  style={{
                    borderColor: "var(--landing-border)",
                    backgroundColor: "#fff",
                    color: "var(--landing-text)",
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = "var(--landing-accent)";
                    e.currentTarget.style.boxShadow =
                      "0 0 0 2px rgba(184, 112, 24, 0.15)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "var(--landing-border)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                />
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={status === "loading"}
                  className="px-5 py-2.5 text-base font-semibold rounded-lg whitespace-nowrap transition-colors duration-150 shrink-0"
                  style={{
                    backgroundColor: "var(--landing-accent)",
                    color: "var(--landing-accent-text)",
                    opacity: status === "loading" ? 0.6 : 1,
                    cursor: status === "loading" ? "default" : "pointer",
                  }}
                  onMouseEnter={(e) => {
                    if (status !== "loading")
                      e.currentTarget.style.backgroundColor =
                        "var(--landing-accent-hover)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor =
                      "var(--landing-accent)";
                  }}
                >
                  {status === "loading" ? "..." : "Notify Me"}
                </button>
              </div>

              {errorMsg && (
                <p className="text-sm text-red-600 mt-1.5">{errorMsg}</p>
              )}
            </>
          )}
        </div>
      </main>

      <LandingFooter />
    </div>
  );
}
