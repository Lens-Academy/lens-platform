let activeAnimation: Animation | null = null;
let cleanupFn: (() => void) | null = null;

function cleanup() {
  const fn = cleanupFn;
  cleanupFn = null;
  activeAnimation = null;
  fn?.();
}

/** Cancel any in-flight animation. */
export function cancelInputFlight() {
  activeAnimation?.cancel();
  cleanup();
}

/**
 * Animate the chat input pill between sidebar and inline positions.
 *
 * Fire-and-forget: no callback. React controls inline pill opacity
 * entirely via the `opacity-0` class — this module never touches it.
 */
export function animateInputFlight(direction: "to-inline" | "to-sidebar") {
  activeAnimation?.cancel();
  cleanup();

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  const sidebarPill = document.querySelector(
    '[data-chat-input-pill="sidebar"]',
  ) as HTMLElement | null;
  const inlinePill = document.querySelector(
    '[data-chat-input-pill="inline"]',
  ) as HTMLElement | null;
  if (!sidebarPill || !inlinePill) return;

  if (direction === "to-inline") {
    animateToInline(sidebarPill, inlinePill);
  } else {
    animateToSidebar(sidebarPill, inlinePill);
  }
}

function findScrollContainer(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node && node !== document.body) {
    if (getComputedStyle(node).overflowY === "auto" || getComputedStyle(node).overflowY === "scroll") {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function animateToInline(sidebarPill: HTMLElement, inlinePill: HTMLElement) {
  const fromRect = sidebarPill.getBoundingClientRect();
  const toRect = inlinePill.getBoundingClientRect();

  // Clone the sidebar pill and fly it in the root stacking context (above
  // the sidebar's z-30). Can't use the actual inline pill because it's
  // trapped inside the scroll container's stacking context.
  const el = sidebarPill.cloneNode(true) as HTMLElement;
  el.className = sidebarPill.className + " pointer-events-none";
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
  inlinePill.style.opacity = "0";

  // Track scroll so the clone follows page content during the flight.
  const scrollContainer = findScrollContainer(inlinePill);
  const scrollAtStart = scrollContainer?.scrollTop ?? 0;

  const onScroll = () => {
    const delta = (scrollContainer?.scrollTop ?? 0) - scrollAtStart;
    el.style.transform = `translateY(${-delta}px)`;
  };
  scrollContainer?.addEventListener("scroll", onScroll, { passive: true });

  cleanupFn = () => {
    el.remove();
    sidebarPill.style.opacity = "";
    inlinePill.style.opacity = "";
    scrollContainer?.removeEventListener("scroll", onScroll);
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
    { duration: 900, easing: "ease-in-out", fill: "forwards" },
  );

  activeAnimation.onfinish = () => {
    cleanup();
  };

  activeAnimation.oncancel = () => {};
}

function animateToSidebar(sidebarPill: HTMLElement, inlinePill: HTMLElement) {
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
    opacity: "1", // override inherited opacity-0 class
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
    { duration: 900, easing: "ease-in-out", fill: "forwards" },
  );

  activeAnimation.onfinish = () => {
    cleanup();
  };

  activeAnimation.oncancel = () => {};
}
