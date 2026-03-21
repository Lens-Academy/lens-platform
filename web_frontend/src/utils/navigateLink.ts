/**
 * Makes a click handler that behaves like a link:
 * - Left click: calls `onClick` (for SPA navigation / custom behavior)
 * - Ctrl+click / Cmd+click / middle-click: opens `href` in a new tab
 *
 * Usage:
 *   <button {...linkProps("/some/path", () => handleClick())}>
 */
export function linkProps(
  href: string,
  onClick: (e: React.MouseEvent) => void,
): React.ButtonHTMLAttributes<HTMLButtonElement> & {
  onAuxClick?: (e: React.MouseEvent) => void;
} {
  return {
    onClick: (e: React.MouseEvent) => {
      if (e.ctrlKey || e.metaKey) {
        window.open(href, "_blank");
        return;
      }
      onClick(e);
    },
    onMouseDown: (e: React.MouseEvent) => {
      // Prevent middle-click auto-scroll mode
      if (e.button === 1) e.preventDefault();
    },
    onAuxClick: (e: React.MouseEvent) => {
      // Middle mouse button → open in new tab
      if (e.button === 1) {
        e.preventDefault();
        window.open(href, "_blank");
      }
    },
  };
}
