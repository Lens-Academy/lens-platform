"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { initPostHog, capturePageView, hasConsent } from "@/analytics";
import { initSentry } from "@/errorTracking";

export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const originalTitleRef = useRef<string | null>(null);

  // Add environment label prefix to document title (e.g., "ONE - Lens Academy")
  useEffect(() => {
    const envLabel = process.env.NEXT_PUBLIC_ENV_LABEL;
    if (envLabel && typeof document !== "undefined") {
      // Store original title on first run
      if (originalTitleRef.current === null) {
        originalTitleRef.current = document.title;
      }
      // Only prefix if not already prefixed
      if (!document.title.startsWith(`${envLabel} - `)) {
        document.title = `${envLabel} - ${originalTitleRef.current || document.title}`;
      }
    }
  }, []);

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
