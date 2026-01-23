import { useState, useEffect, useRef } from "react";

type ScrollDirection = "up" | "down" | null;

/**
 * Detects scroll direction with configurable threshold.
 * Uses requestAnimationFrame for throttling to avoid flickering.
 *
 * @param threshold - Minimum scroll distance (in px) before direction changes. Default 100.
 * @returns Current scroll direction: 'up', 'down', or null (initial/at top)
 */
export function useScrollDirection(threshold = 100): ScrollDirection {
  const [scrollDirection, setScrollDirection] = useState<ScrollDirection>(null);
  const lastScrollY = useRef(0);
  const ticking = useRef(false);

  useEffect(() => {
    // Handle SSR
    if (typeof window === "undefined") return;

    const updateScrollDirection = () => {
      const scrollY = window.scrollY;
      const direction = scrollY > lastScrollY.current ? "down" : "up";

      if (Math.abs(scrollY - lastScrollY.current) > threshold) {
        setScrollDirection(direction);
        lastScrollY.current = scrollY;
      }
      ticking.current = false;
    };

    const onScroll = () => {
      if (!ticking.current) {
        window.requestAnimationFrame(updateScrollDirection);
        ticking.current = true;
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);

  return scrollDirection;
}
