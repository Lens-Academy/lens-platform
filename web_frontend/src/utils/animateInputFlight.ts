let activeAnimation: Animation | null = null;
let cleanupFn: (() => void) | null = null;

function cleanup() {
  const fn = cleanupFn;
  cleanupFn = null;
  activeAnimation = null;
  fn?.();
}

/**
 * Animate the chat input pill between sidebar and inline positions.
 *
 * Handles transform/position only — never reads or writes opacity on the
 * inline pill. Calls `onDone` on natural completion (onfinish). Does NOT
 * call `onDone` on cancel — the caller uses a generation counter to
 * discard stale callbacks regardless.
 */
export function animateInputFlight(
  direction: "to-inline" | "to-sidebar",
  onDone: () => void = () => {},
) {
  activeAnimation?.cancel();
  cleanup();

  // Respect reduced motion — call onDone synchronously so state machine
  // transitions to terminal state immediately
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    onDone();
    return;
  }

  const sidebarPill = document.querySelector(
    '[data-chat-input-pill="sidebar"]',
  ) as HTMLElement | null;
  const inlinePill = document.querySelector(
    '[data-chat-input-pill="inline"]',
  ) as HTMLElement | null;
  if (!sidebarPill || !inlinePill) {
    onDone();
    return;
  }

  if (direction === "to-inline") {
    animateToInline(sidebarPill, inlinePill, onDone);
  } else {
    animateToSidebar(sidebarPill, inlinePill, onDone);
  }
}

function animateToInline(
  sidebarPill: HTMLElement,
  inlinePill: HTMLElement,
  onDone: () => void,
) {
  const fromRect = sidebarPill.getBoundingClientRect();
  const toRect = inlinePill.getBoundingClientRect();

  const deltaX = fromRect.left - toRect.left;
  const deltaY = fromRect.top - toRect.top;
  const scaleX = fromRect.width / toRect.width;
  const scaleY = fromRect.height / toRect.height;

  sidebarPill.style.opacity = "0";

  inlinePill.style.transformOrigin = "top left";
  inlinePill.style.transform =
    `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`;

  cleanupFn = () => {
    sidebarPill.style.opacity = "";
    inlinePill.style.transform = "";
    inlinePill.style.transformOrigin = "";
  };

  activeAnimation = inlinePill.animate(
    [
      {
        transformOrigin: "top left",
        transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`,
      },
      {
        transformOrigin: "top left",
        transform: "none",
      },
    ],
    { duration: 900, easing: "ease-in-out" },
  );

  activeAnimation.onfinish = () => {
    sidebarPill.style.opacity = "";
    inlinePill.style.transform = "";
    inlinePill.style.transformOrigin = "";
    activeAnimation = null;
    cleanupFn = null;
    onDone();
  };

  activeAnimation.oncancel = () => {};
}

function animateToSidebar(
  sidebarPill: HTMLElement,
  inlinePill: HTMLElement,
  onDone: () => void,
) {
  const fromRect = inlinePill.getBoundingClientRect();
  const closedRect = sidebarPill.getBoundingClientRect();
  const sidebarWidth = window.innerWidth >= 1280 ? 384 : 320;
  const toRect = new DOMRect(
    closedRect.left - sidebarWidth,
    closedRect.top,
    closedRect.width,
    closedRect.height,
  );

  const el = inlinePill.cloneNode(true) as HTMLElement;
  el.className = inlinePill.className + " pointer-events-none";
  Object.assign(el.style, {
    position: "fixed",
    zIndex: "100",
    top: `${fromRect.top}px`,
    left: `${fromRect.left}px`,
    width: `${fromRect.width}px`,
    height: `${fromRect.height}px`,
    margin: "0",
  });
  document.body.appendChild(el);

  sidebarPill.style.opacity = "0";

  cleanupFn = () => {
    el.remove();
    sidebarPill.style.opacity = "";
  };

  activeAnimation = el.animate(
    [
      {
        top: `${fromRect.top}px`,
        left: `${fromRect.left}px`,
        width: `${fromRect.width}px`,
        height: `${fromRect.height}px`,
      },
      {
        top: `${toRect.top}px`,
        left: `${toRect.left}px`,
        width: `${toRect.width}px`,
        height: `${toRect.height}px`,
      },
    ],
    // fill: "forwards" keeps clone at final position until onfinish removes it
    { duration: 900, easing: "ease-in-out", fill: "forwards" },
  );

  activeAnimation.onfinish = () => {
    el.remove();
    sidebarPill.style.opacity = "";
    activeAnimation = null;
    cleanupFn = null;
    onDone();
  };

  activeAnimation.oncancel = () => {};
}
