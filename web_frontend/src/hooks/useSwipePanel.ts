import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

interface UseSwipePanelOptions {
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  enabled: boolean;
  panelRef: RefObject<HTMLDivElement | null>;
  backdropRef: RefObject<HTMLDivElement | null>;
  /** Which edge the panel slides from. Default: "right". */
  side?: "left" | "right";
}

const DISTANCE_THRESHOLD = 80;
const VELOCITY_THRESHOLD = 0.4; // px/ms
const DIRECTION_LOCK_DISTANCE = 10; // px before locking direction

export function useSwipePanel({
  isOpen,
  onOpen,
  onClose,
  enabled,
  panelRef,
  backdropRef,
  side = "right",
}: UseSwipePanelOptions) {
  const [isDragging, setIsDragging] = useState(false);

  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;

  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const directionLocked = useRef<"horizontal" | "vertical" | null>(null);
  const gestureActive = useRef(false);
  const panelWidth = useRef(0);
  const velocityTracker = useRef<{ x: number; t: number }[]>([]);

  const cleanupInlineStyles = useCallback(() => {
    const panel = panelRef.current;
    const backdrop = backdropRef.current;
    if (panel) {
      panel.style.removeProperty("translate");
      panel.style.removeProperty("transition");
    }
    if (backdrop) {
      backdrop.style.removeProperty("opacity");
      backdrop.style.removeProperty("transition");
      backdrop.style.removeProperty("pointer-events");
    }
  }, [panelRef, backdropRef]);

  useEffect(() => {
    if (!enabled) return;

    const isLeft = side === "left";

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      touchStartX.current = touch.clientX;
      touchStartY.current = touch.clientY;
      directionLocked.current = null;
      gestureActive.current = false;
      panelWidth.current = window.innerWidth;
      velocityTracker.current = [{ x: touch.clientX, t: Date.now() }];
    };

    const onTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      const deltaX = touch.clientX - touchStartX.current;
      const deltaY = touch.clientY - touchStartY.current;

      // Lock direction after enough movement
      if (directionLocked.current === null) {
        const totalDelta = Math.abs(deltaX) + Math.abs(deltaY);
        if (totalDelta < DIRECTION_LOCK_DISTANCE) return;
        directionLocked.current =
          Math.abs(deltaY) > Math.abs(deltaX) ? "vertical" : "horizontal";
        if (directionLocked.current === "vertical") return;

        // Direction-based disambiguation: only activate if swipe direction
        // matches this panel's side. This prevents two hooks (left + right
        // panels) from fighting over the same gesture.
        if (isLeft) {
          // Left panel: open on swipe-right (deltaX > 0), close on swipe-left
          if (isOpenRef.current && deltaX > 0) return; // wrong direction
          if (!isOpenRef.current && deltaX < 0) return; // wrong direction
        } else {
          // Right panel: open on swipe-left (deltaX < 0), close on swipe-right
          if (isOpenRef.current && deltaX < 0) return; // wrong direction
          if (!isOpenRef.current && deltaX > 0) return; // wrong direction
        }

        // Horizontal lock — activate gesture
        gestureActive.current = true;
        setIsDragging(true);
        const panel = panelRef.current;
        const backdrop = backdropRef.current;
        if (panel) panel.style.transition = "none";
        if (backdrop) backdrop.style.transition = "none";
      }

      if (directionLocked.current === "vertical") return;
      if (!gestureActive.current) return;
      e.preventDefault();

      const panel = panelRef.current;
      const backdrop = backdropRef.current;
      if (!panel || !backdrop) return;

      const w = panelWidth.current;
      let translateX: number;

      if (isLeft) {
        if (isOpenRef.current) {
          // Closing: panel at 0, dragging left → translateX [-w, 0]
          translateX = Math.max(-w, Math.min(deltaX, 0));
        } else {
          // Opening: panel at -w, dragging right → translateX [-w, 0]
          translateX = Math.max(-w, Math.min(-w + deltaX, 0));
        }
        panel.style.translate = `${translateX}px 0`;
        const progress = 1 - Math.abs(translateX) / w;
        backdrop.style.opacity = String(progress * 0.5);
        if (progress > 0) {
          backdrop.style.pointerEvents = "auto";
        }
      } else {
        if (isOpenRef.current) {
          // Closing: panel at 0, dragging right → translateX [0, w]
          translateX = Math.max(0, Math.min(deltaX, w));
        } else {
          // Opening: panel at w, dragging left → translateX [0, w]
          translateX = Math.max(0, Math.min(w + deltaX, w));
        }
        panel.style.translate = `${translateX}px 0`;
        const progress = 1 - translateX / w;
        backdrop.style.opacity = String(progress * 0.5);
        if (progress > 0) {
          backdrop.style.pointerEvents = "auto";
        }
      }

      // Track velocity (keep last 3)
      velocityTracker.current.push({ x: touch.clientX, t: Date.now() });
      if (velocityTracker.current.length > 3) {
        velocityTracker.current.shift();
      }
    };

    const onTouchEnd = () => {
      if (!gestureActive.current) return;
      gestureActive.current = false;
      setIsDragging(false);

      const panel = panelRef.current;
      const backdrop = backdropRef.current;
      if (!panel || !backdrop) return;

      // Compute velocity
      const tracker = velocityTracker.current;
      let velocity = 0;
      if (tracker.length >= 2) {
        const last = tracker[tracker.length - 1];
        const prev = tracker[tracker.length - 2];
        const dt = last.t - prev.t;
        if (dt > 0) velocity = Math.abs(last.x - prev.x) / dt;
      }

      const deltaX =
        (tracker[tracker.length - 1]?.x ?? touchStartX.current) -
        touchStartX.current;
      const absDelta = Math.abs(deltaX);
      const shouldComplete =
        absDelta > DISTANCE_THRESHOLD || velocity > VELOCITY_THRESHOLD;

      let willOpen: boolean;
      if (isLeft) {
        if (isOpenRef.current) {
          // Was open — complete close if swiped left enough
          willOpen = !(shouldComplete && deltaX < 0);
        } else {
          // Was closed — complete open if swiped right enough
          willOpen = shouldComplete && deltaX > 0;
        }
      } else {
        if (isOpenRef.current) {
          // Was open — complete close if swiped right enough
          willOpen = !(shouldComplete && deltaX > 0);
        } else {
          // Was closed — complete open if swiped left enough
          willOpen = shouldComplete && deltaX < 0;
        }
      }

      // Animate to final position
      panel.style.transition = "translate 300ms ease-in-out";
      backdrop.style.transition = "opacity 300ms ease-in-out";

      const closedTranslate = isLeft
        ? `${-panelWidth.current}px 0`
        : `${panelWidth.current}px 0`;

      if (willOpen) {
        panel.style.translate = "0 0";
        backdrop.style.opacity = "0.5";
        backdrop.style.pointerEvents = "auto";
      } else {
        panel.style.translate = closedTranslate;
        backdrop.style.opacity = "0";
        backdrop.style.pointerEvents = "none";
      }

      // Clean up inline styles after animation
      const onTransitionEnd = () => {
        panel.removeEventListener("transitionend", onTransitionEnd);
        cleanupInlineStyles();
      };
      panel.addEventListener("transitionend", onTransitionEnd);

      // Update React state
      if (willOpen && !isOpenRef.current) {
        onOpen();
      } else if (!willOpen && isOpenRef.current) {
        onClose();
      }
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, [enabled, side, onOpen, onClose, panelRef, backdropRef, cleanupInlineStyles]);

  return { isDragging };
}
