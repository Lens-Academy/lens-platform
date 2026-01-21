import { useEffect } from "react";
import { usePageContext } from "vike-react/usePageContext";
import { initPostHog, capturePageView, hasConsent } from "@/analytics";
import { initSentry } from "@/errorTracking";

export function Providers({ children }: { children: React.ReactNode }) {
  const pageContext = usePageContext();
  const pathname = pageContext?.urlPathname ?? "";

  // Add environment label prefix to document title
  useEffect(() => {
    const envLabel = import.meta.env.VITE_ENV_LABEL;
    if (!envLabel || typeof document === "undefined") return;

    const prefixTitle = () => {
      const currentTitle = document.title;
      if (currentTitle && !currentTitle.startsWith(`${envLabel} - `)) {
        document.title = `${envLabel} - ${currentTitle}`;
      }
    };

    prefixTitle();
    const timeoutId = setTimeout(prefixTitle, 100);

    const titleElement = document.querySelector("title");
    let observer: MutationObserver | null = null;
    if (titleElement) {
      observer = new MutationObserver(prefixTitle);
      observer.observe(titleElement, {
        childList: true,
        characterData: true,
        subtree: true,
      });
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
