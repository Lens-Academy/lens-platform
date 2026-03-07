let activeAnimation: Animation | null = null;

export function animateInputFlight(direction: "to-inline" | "to-sidebar") {
  // Cancel any in-progress animation
  activeAnimation?.cancel();

  // Respect reduced motion
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const sidebarPill = document.querySelector(
    '[data-chat-input-pill="sidebar"]',
  ) as HTMLElement | null;
  const inlinePill = document.querySelector(
    '[data-chat-input-pill="inline"]',
  ) as HTMLElement | null;
  if (!sidebarPill || !inlinePill) return;

  let fromRect: DOMRect, toRect: DOMRect;

  if (direction === "to-inline") {
    // Sidebar → inline: sidebar pill is visible, inline pill is visible
    fromRect = sidebarPill.getBoundingClientRect();
    toRect = inlinePill.getBoundingClientRect();
  } else {
    // Inline → sidebar: inline pill is visible, sidebar pill is inside closed sidebar
    fromRect = inlinePill.getBoundingClientRect();
    // Sidebar pill is off-screen right; shift left by sidebar width for its open position
    const closedRect = sidebarPill.getBoundingClientRect();
    const sidebarWidth = window.innerWidth >= 1280 ? 384 : 320;
    toRect = new DOMRect(
      closedRect.left - sidebarWidth,
      closedRect.top,
      closedRect.width,
      closedRect.height,
    );
  }

  // Clone the source pill so buttons/icons are visible during flight
  const sourcePill = direction === "to-inline" ? sidebarPill : inlinePill;
  const el = sourcePill.cloneNode(true) as HTMLElement;
  el.className = sourcePill.className + " pointer-events-none";
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

  // Animate using Web Animations API
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
    inlinePill.style.opacity = "";
    activeAnimation = null;
  };

  activeAnimation.oncancel = () => {
    el.remove();
    sidebarPill.style.opacity = "";
    inlinePill.style.opacity = "";
    activeAnimation = null;
  };
}
