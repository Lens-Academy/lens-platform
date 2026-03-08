let activeAnimation: Animation | null = null;
let cleanupFn: (() => void) | null = null;

function cleanup() {
  cleanupFn?.();
  cleanupFn = null;
  activeAnimation = null;
}

export function animateInputFlight(direction: "to-inline" | "to-sidebar") {
  // Cancel any in-progress animation
  activeAnimation?.cancel();
  cleanup();

  // Respect reduced motion
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

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

/**
 * Sidebar → inline: true FLIP on the inline pill itself.
 * The inline pill is in the DOM flow, so it naturally scrolls with the page —
 * the animation endpoint tracks scroll automatically.
 */
function animateToInline(sidebarPill: HTMLElement, inlinePill: HTMLElement) {
  const fromRect = sidebarPill.getBoundingClientRect();
  const toRect = inlinePill.getBoundingClientRect();

  // Calculate inverse transform: move inline pill to where sidebar pill is
  const deltaX = fromRect.left - toRect.left;
  const deltaY = fromRect.top - toRect.top;
  const scaleX = fromRect.width / toRect.width;
  const scaleY = fromRect.height / toRect.height;

  // Hide sidebar pill during animation
  sidebarPill.style.opacity = "0";

  const onDone = () => {
    sidebarPill.style.opacity = "";
    activeAnimation = null;
    cleanupFn = null;
  };

  cleanupFn = () => {
    sidebarPill.style.opacity = "";
  };

  // Animate inline pill from sidebar position back to its natural position
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
    { duration: 900, easing: "ease-in-out", fill: "both" },
  );

  activeAnimation.onfinish = onDone;
  activeAnimation.oncancel = onDone;
}

/**
 * Inline → sidebar: clone-based animation to a fixed target.
 * The sidebar is fixed-positioned, so a floating clone works fine.
 */
function animateToSidebar(sidebarPill: HTMLElement, inlinePill: HTMLElement) {
  const fromRect = inlinePill.getBoundingClientRect();
  // Sidebar pill is off-screen right (sidebar closed); shift left by sidebar width
  const closedRect = sidebarPill.getBoundingClientRect();
  const sidebarWidth = window.innerWidth >= 1280 ? 384 : 320;
  const toRect = new DOMRect(
    closedRect.left - sidebarWidth,
    closedRect.top,
    closedRect.width,
    closedRect.height,
  );

  // Clone the inline pill so buttons/icons are visible during flight
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

  // Hide real inputs during animation
  sidebarPill.style.opacity = "0";
  inlinePill.style.opacity = "0";

  const onDone = () => {
    el.remove();
    sidebarPill.style.opacity = "";
    inlinePill.style.opacity = "";
    activeAnimation = null;
    cleanupFn = null;
  };

  cleanupFn = () => {
    el.remove();
    sidebarPill.style.opacity = "";
    inlinePill.style.opacity = "";
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

  activeAnimation.onfinish = onDone;
  activeAnimation.oncancel = onDone;
}
