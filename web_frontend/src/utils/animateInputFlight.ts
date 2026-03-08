let activeAnimation: Animation | null = null;
let cleanupFn: (() => void) | null = null;

function cleanup() {
  const fn = cleanupFn;
  cleanupFn = null;
  activeAnimation = null;
  fn?.();
}

export function animateInputFlight(direction: "to-inline" | "to-sidebar") {
  // Cancel any in-progress animation — oncancel is a no-op,
  // cleanup() handles resetting styles and removing clones.
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
 *
 * No `fill` — we set the initial transform as an inline style so the element
 * appears at the sidebar position immediately (no flash). During playback the
 * WAAPI overrides the inline transform. After playback we clear it. This avoids
 * fill effects that persist and prevent later opacity changes.
 */
function animateToInline(sidebarPill: HTMLElement, inlinePill: HTMLElement) {
  const fromRect = sidebarPill.getBoundingClientRect();
  const toRect = inlinePill.getBoundingClientRect();

  const deltaX = fromRect.left - toRect.left;
  const deltaY = fromRect.top - toRect.top;
  const scaleX = fromRect.width / toRect.width;
  const scaleY = fromRect.height / toRect.height;

  // Hide sidebar pill
  sidebarPill.style.opacity = "0";

  // Position inline pill at sidebar location via inline transform (no flash).
  inlinePill.style.transformOrigin = "top left";
  inlinePill.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`;

  cleanupFn = () => {
    sidebarPill.style.opacity = "";
    inlinePill.style.transform = "";
    inlinePill.style.transformOrigin = "";
  };

  // Animate from sidebar position to natural position (no fill).
  // opacity: 1 in keyframes overrides the CSS opacity-0 class during playback;
  // React state removes the class before animation finishes.
  activeAnimation = inlinePill.animate(
    [
      {
        transformOrigin: "top left",
        transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`,
        opacity: 1,
      },
      {
        transformOrigin: "top left",
        transform: "none",
        opacity: 1,
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
  };

  activeAnimation.oncancel = () => {};
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

  // Hide sidebar pill during animation; inline pill hidden by React state
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
    el.remove();
    sidebarPill.style.opacity = "";
    activeAnimation = null;
    cleanupFn = null;
  };

  activeAnimation.oncancel = () => {};
}
