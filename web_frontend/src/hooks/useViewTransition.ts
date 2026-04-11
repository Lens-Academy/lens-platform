import { useCallback } from "react";
import { navigate } from "vike/client/router";

/**
 * Hook for navigating with View Transitions API.
 * Falls back to regular navigation if API not supported.
 *
 * View Transitions provide smooth crossfade animations between pages
 * without requiring a full page reload or complex animation libraries.
 */
export function useViewTransition() {
  const navigateWithTransition = useCallback(async (href: string) => {
    // Check if View Transitions API is supported
    // TypeScript doesn't know about startViewTransition yet
    const doc = document as Document & {
      startViewTransition?: (callback: () => Promise<void>) => void;
    };

    if (!doc.startViewTransition) {
      // Fallback: use regular Vike navigation
      await navigate(href);
      return;
    }

    // Use View Transitions API
    doc.startViewTransition(async () => {
      await navigate(href);
    });
  }, []);

  return { navigateWithTransition };
}
