import { useState, useEffect } from "react";
import { API_URL } from "../config";

const STORAGE_KEY = "lens-prospect-submitted";

interface ProspectEmailFormProps {
  /** "inline" for compact (landing card), "standalone" for full-width (enroll page) */
  variant: "inline" | "standalone";
  className?: string;
}

export default function ProspectEmailForm({
  variant,
  className = "",
}: ProspectEmailFormProps) {
  const [email, setEmail] = useState("");
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
      const res = await fetch(`${API_URL}/api/prospects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Something went wrong.");
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
          We'll email you when the next cohort opens for enrollment.
        </p>
      </div>
    );
  }

  if (variant === "inline") {
    return (
      <form
        onSubmit={handleSubmit}
        className={`flex gap-2 items-center ${className}`}
      >
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
    );
  }

  // standalone variant
  return (
    <div className={className}>
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
          className="flex-1 px-4 py-3 rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="px-6 py-3 font-semibold rounded-lg bg-blue-500 hover:bg-blue-600 text-white transition-colors disabled:opacity-70 shrink-0"
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
