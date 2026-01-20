"use client";

import { useEffect, useState, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { API_URL } from "../config";
import { DiscordIcon } from "../components/icons/DiscordIcon";

type AuthStatus = "loading" | "success" | "error";

export default function Auth() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const hasValidated = useRef(false);

  const code = searchParams?.get("code") ?? null;
  const next = searchParams?.get("next") ?? "/signup";

  // Derive initial state from whether code exists
  const [status, setStatus] = useState<AuthStatus>(() =>
    code ? "loading" : "error"
  );
  const [errorMessage, setErrorMessage] = useState(() =>
    code ? "" : "No authentication code provided."
  );

  useEffect(() => {
    // Skip validation if no code (initial state already set to error)
    if (!code) return;

    // Prevent double validation (React strict mode runs effects twice)
    if (hasValidated.current) return;
    hasValidated.current = true;

    // Validate code via API
    const origin = encodeURIComponent(window.location.origin);
    fetch(
      `${API_URL}/auth/code?code=${encodeURIComponent(code)}&next=${encodeURIComponent(next)}&origin=${origin}`,
      {
        method: "POST",
        credentials: "include",
      }
    )
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        if (data.status === "ok") {
          setStatus("success");
          // Small delay to show success message, then navigate
          setTimeout(() => {
            router.push(data.next || next);
          }, 500);
        } else {
          setStatus("error");
          switch (data.error) {
            case "expired_code":
              setErrorMessage(
                "This link has expired. Please request a new one or sign in with Discord."
              );
              break;
            case "invalid_code":
              setErrorMessage("This link is invalid or has already been used.");
              break;
            default:
              setErrorMessage("Authentication failed. Please try again.");
          }
        }
      })
      .catch((err) => {
        console.error("Auth error:", err);
        setStatus("error");
        setErrorMessage("Unable to connect to the server. Please try again.");
      });
  }, [code, next, router]);

  const handleDiscordLogin = () => {
    const origin = encodeURIComponent(window.location.origin);
    window.location.href = `${API_URL}/auth/discord?next=${encodeURIComponent(next)}&origin=${origin}`;
  };

  if (status === "loading") {
    return (
      <div className="py-16 text-center">
        <div className="max-w-md mx-auto">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-lg text-gray-600">Authenticating...</p>
        </div>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="py-16 text-center">
        <div className="max-w-md mx-auto">
          <div className="text-green-500 text-5xl mb-4">✓</div>
          <p className="text-lg text-gray-600">Success! Redirecting...</p>
        </div>
      </div>
    );
  }

  // Error state
  return (
    <div className="py-16 text-center">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-md p-8">
        <div className="text-red-500 text-5xl mb-4">!</div>
        <h1 className="text-xl font-semibold text-gray-800 mb-2">
          Authentication Failed
        </h1>
        <p className="text-gray-600 mb-6">{errorMessage}</p>
        <button
          onClick={handleDiscordLogin}
          className="inline-flex items-center gap-2 px-6 py-3 bg-[#5865F2] text-white rounded-lg hover:bg-[#4752C4] transition-colors font-medium"
        >
          <DiscordIcon className="w-5 h-5" />
          Sign in with Discord
        </button>
      </div>
    </div>
  );
}
