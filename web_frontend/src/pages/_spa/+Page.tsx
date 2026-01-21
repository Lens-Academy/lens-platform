import { useEffect } from "react";
import { navigate } from "vike/client/router";

// This page pre-renders to /200 - served as SPA fallback for non-SSG routes.
// On hydration, it checks if the URL matches /200. If not, it navigates
// client-side to the actual URL, letting Vike render the correct page.
export default function SpaFallbackPage() {
  useEffect(() => {
    // If we're not actually on /200, navigate to the real URL
    const currentPath = window.location.pathname;
    if (currentPath !== "/200") {
      navigate(currentPath + window.location.search + window.location.hash);
    }
  }, []);

  return (
    <div
      id="spa-loading"
      className="flex items-center justify-center min-h-screen"
    >
      <div className="animate-pulse text-gray-500">Loading...</div>
    </div>
  );
}
