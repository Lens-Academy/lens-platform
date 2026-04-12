import { useState, useEffect } from "react";
import { API_URL } from "../config";

const STORAGE_KEY = "lens-prospect-submitted";

interface ProspectEmailFormProps {
  /** "inline" for compact (landing card), "standalone" for full-width (enroll page) */
  variant: "inline" | "standalone";
  className?: string;
  /** Show Substack blog subscription checkbox. Default false. */
  showSubstackOption?: boolean;
  /** Default state for course notifications checkbox. Default true. */
  defaultSubscribeCourses?: boolean;
  /** Default state for Substack subscription checkbox. Default false. */
  defaultSubscribeSubstack?: boolean;
}

export default function ProspectEmailForm({
  variant,
  className = "",
  showSubstackOption = false,
  defaultSubscribeCourses = true,
  defaultSubscribeSubstack = false,
}: ProspectEmailFormProps) {
  const [email, setEmail] = useState("");
  const [subscribeCourses, setSubscribeCourses] = useState(
    defaultSubscribeCourses,
  );
  const [subscribeSubstack, setSubscribeSubstack] = useState(
    defaultSubscribeSubstack,
  );
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState("");

  // Check if already submitted
  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY)) {
      setStatus("success");
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setStatus("loading");
    setErrorMsg("");

    try {
      const trimmedEmail = email.trim();

      // Subscribe to course notifications via our API first (await response)
      if (subscribeCourses) {
        const res = await fetch(`${API_URL}/api/subscribe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: trimmedEmail,
            subscribe_courses_learners: true,
            subscribe_substack: subscribeSubstack,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.detail || "Something went wrong.");
        }
      }

      // Subscribe to Substack directly from the client (fire-and-forget,
      // no-cors because Substack doesn't set CORS headers for us).
      // Done AFTER our API call to avoid the 302 redirect interfering.
      if (subscribeSubstack) {
        fetch("https://lensacademy.substack.com/api/v1/free?nojs=true", {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `email=${encodeURIComponent(trimmedEmail)}&source=subscribe_page`,
        });
      }

      localStorage.setItem(STORAGE_KEY, "1");
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
    }
  };

  if (status === "success") {
    if (variant === "inline") {
      return (
        <p
          className={`text-sm font-semibold ${className}`}
          style={{ color: "var(--landing-accent)" }}
        >
          We'll email you when this opens.
        </p>
      );
    }
    return (
      <div className={`text-center ${className}`}>
        <p className="text-lg font-semibold text-green-700 mb-2">
          You're on the list!
        </p>
        <p className="text-gray-600">
          We&rsquo;ll email you when the next course opens for enrollment.
        </p>
      </div>
    );
  }

  const checkboxes = showSubstackOption && (
    <div className="flex flex-col gap-2 mb-3">
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={subscribeCourses}
          onChange={(e) => setSubscribeCourses(e.target.checked)}
          className="rounded"
        />
        <span>Notify me when new courses open</span>
      </label>
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={subscribeSubstack}
          onChange={(e) => setSubscribeSubstack(e.target.checked)}
          className="rounded"
        />
        <span>Subscribe to our blog posts</span>
      </label>
    </div>
  );

  if (variant === "inline") {
    return (
      <div className={className}>
        {checkboxes}
        <form onSubmit={handleSubmit} className="flex gap-2 items-center">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            className="flex-1 min-w-0 px-3 py-2 text-sm rounded-lg border outline-none focus:ring-2"
            style={{
              borderColor: "var(--landing-border)",
              backgroundColor: "var(--landing-bg)",
              color: "var(--landing-text)",
            }}
          />
          <button
            type="submit"
            disabled={status === "loading"}
            className="px-4 py-2 text-sm font-semibold rounded-lg transition-colors duration-200 shrink-0"
            style={{
              backgroundColor: "var(--landing-accent)",
              color: "var(--landing-accent-text)",
              opacity: status === "loading" ? 0.7 : 1,
            }}
          >
            {status === "loading" ? "..." : "Notify Me"}
          </button>
          {status === "error" && (
            <span className="text-xs text-red-500">{errorMsg}</span>
          )}
        </form>
      </div>
    );
  }

  // standalone variant
  return (
    <div className={className}>
      {checkboxes}
      <form
        onSubmit={handleSubmit}
        className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto"
      >
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
          className="flex-1 px-4 py-3 rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-[var(--brand-accent)] focus:border-[var(--brand-accent)]"
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="px-6 py-3 font-semibold rounded-lg bg-[var(--brand-accent)] hover:bg-[var(--brand-accent-hover)] text-white transition-colors disabled:opacity-70 shrink-0"
        >
          {status === "loading" ? "..." : "Notify Me"}
        </button>
      </form>
      {status === "error" && (
        <p className="text-sm text-red-500 text-center mt-2">{errorMsg}</p>
      )}
    </div>
  );
}
