"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { initPostHog, capturePageView, hasConsent } from "@/analytics";
import { initSentry } from "@/errorTracking";

export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Add environment label prefix to document title (e.g., "dev2 - Lens Academy")
  // Re-runs on pathname change and uses MutationObserver for async title updates
  useEffect(() => {
    const envLabel = process.env.NEXT_PUBLIC_ENV_LABEL;
    if (!envLabel || typeof document === "undefined") return;

    const prefixTitle = () => {
      const currentTitle = document.title;
      if (currentTitle && !currentTitle.startsWith(`${envLabel} - `)) {
        document.title = `${envLabel} - ${currentTitle}`;
      }
    };

    // Prefix immediately and after a short delay (for async title updates)
    prefixTitle();
    const timeoutId = setTimeout(prefixTitle, 100);

    // Watch for title changes (Next.js metadata updates title after render)
    const titleElement = document.querySelector("title");
    let observer: MutationObserver | null = null;
    if (titleElement) {
      observer = new MutationObserver(prefixTitle);
      observer.observe(titleElement, { childList: true, characterData: true, subtree: true });
    }

    return () => {
      clearTimeout(timeoutId);
      observer?.disconnect();
    };
  }, [pathname]);

  // Initialize analytics if user previously consented
  useEffect(() => {
    if (hasConsent()) {
      initPostHog();
      initSentry();
    }
  }, []);

  // Track page views on route change
  useEffect(() => {
    if (pathname) {
      capturePageView(pathname);
    }
  }, [pathname]);

  return <>{children}</>;
}
