# Phase 2: Responsive Layout - Research

**Researched:** 2026-01-21
**Domain:** Mobile-responsive navigation, drawers, touch targets
**Confidence:** HIGH

## Summary

This research focuses on implementing responsive mobile navigation for an existing React + Tailwind CSS v4 + Vike application. The codebase already has foundational components (headers, drawers, sidebars) that need mobile adaptation rather than building from scratch.

Key findings:
1. The project already uses `react-use` which provides `useMedia` hook for responsive breakpoints
2. Hide-on-scroll headers are a well-established pattern with multiple implementation options (custom hook vs library)
3. The existing `ModuleDrawer` and `CourseSidebar` components have internal state management that can be extended for mobile overlay behavior
4. Safe area CSS variables are already defined in `globals.css` from Phase 1

**Primary recommendation:** Use custom `useScrollDirection` hook for header hide/show (no external dependency), extend existing drawer components with mobile-specific styling using Tailwind's `md:` breakpoint prefix, and leverage `react-use`'s `useMedia` hook for conditional rendering.

## Standard Stack

The established libraries/tools for this domain:

### Core (Already in Project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| tailwindcss | ^4 | Responsive styling via breakpoint prefixes | Already configured, mobile-first by default |
| react-use | ^17.6.0 | `useMedia`, `useMeasure` hooks | Already used for `useHeaderLayout`, provides `useMedia` for breakpoints |
| lucide-react | ^0.562.0 | Icons (Menu, X, ChevronLeft) | Already used throughout app |

### Supporting (No New Dependencies Needed)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @floating-ui/react | ^0.27.16 | Popover positioning | Already used for UserMenu, may help with mobile menu positioning |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom useScrollDirection | react-headroom | Library adds dependency; custom hook is ~30 lines, easier to tune threshold |
| CSS-only responsive | JS-based conditional render | CSS prefixes preferred for styling; JS needed for drawer state |
| Framer Motion for gestures | CSS transitions | Framer adds bundle size; CSS transitions sufficient for slide animations |

**Installation:**
```bash
# No new dependencies needed - all requirements already in project
```

## Architecture Patterns

### Recommended Component Structure
```
src/
├── components/
│   ├── nav/
│   │   ├── MobileMenu.tsx       # NEW: Hamburger menu overlay
│   │   ├── MobileHeader.tsx     # NEW: Mobile-specific header with hamburger
│   │   └── BottomNav.tsx        # NEW: Bottom navigation bar
│   ├── Layout.tsx               # MODIFY: Add responsive header switching
│   ├── ModuleHeader.tsx         # MODIFY: Add hide-on-scroll, mobile layout
│   └── module/
│       └── ModuleDrawer.tsx     # MODIFY: Full-screen on mobile
│   └── course/
│       └── CourseSidebar.tsx    # MODIFY: Slide-out drawer on mobile
├── hooks/
│   ├── useScrollDirection.ts    # NEW: Hide-on-scroll detection
│   ├── useMediaQuery.ts         # NEW: Breakpoint detection (or use react-use)
│   └── useLockBodyScroll.ts     # NEW: Prevent scroll when drawer open
```

### Pattern 1: useScrollDirection Hook
**What:** Custom hook that detects scroll direction with configurable threshold
**When to use:** Header hide/show behavior
**Example:**
```typescript
// Source: Common React pattern, adapted from multiple sources
import { useState, useEffect, useRef } from 'react';

type ScrollDirection = 'up' | 'down' | null;

export function useScrollDirection(threshold = 100): ScrollDirection {
  const [scrollDirection, setScrollDirection] = useState<ScrollDirection>(null);
  const lastScrollY = useRef(0);
  const ticking = useRef(false);

  useEffect(() => {
    const updateScrollDirection = () => {
      const scrollY = window.scrollY;
      const direction = scrollY > lastScrollY.current ? 'down' : 'up';

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

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);

  return scrollDirection;
}
```

### Pattern 2: Responsive Header with Hide-on-Scroll
**What:** Header that transforms for mobile and hides when scrolling down
**When to use:** Main app header, ModuleHeader
**Example:**
```typescript
// Source: Project pattern + hide-on-scroll research
function ResponsiveHeader() {
  const scrollDirection = useScrollDirection(100);
  const isMobile = useMedia('(max-width: 767px)');
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header
      className={`
        fixed top-0 left-0 right-0 z-50
        transition-transform duration-300
        ${scrollDirection === 'down' ? '-translate-y-full' : 'translate-y-0'}
      `}
      style={{ paddingTop: 'var(--safe-top)' }}
    >
      {isMobile ? (
        <MobileHeader onMenuToggle={() => setMenuOpen(!menuOpen)} />
      ) : (
        <DesktopHeader />
      )}
    </header>
  );
}
```

### Pattern 3: Mobile Drawer with Backdrop
**What:** Slide-out drawer with darkened backdrop, multiple dismiss methods
**When to use:** ModuleDrawer, CourseSidebar on mobile
**Example:**
```typescript
// Source: Existing ModuleDrawer pattern + mobile overlay research
function MobileDrawer({ isOpen, onClose, children }) {
  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [isOpen]);

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        className={`
          fixed top-0 left-0 h-full w-[80%] max-w-sm
          bg-white z-50
          transition-transform duration-300
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
        style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' }}
      >
        <button onClick={onClose} className="absolute top-4 right-4 p-2">
          <X className="w-6 h-6" />
        </button>
        {children}
      </div>
    </>
  );
}
```

### Pattern 4: Touch Target Sizing
**What:** Ensure all interactive elements meet 44px minimum
**When to use:** All buttons, links, interactive elements on mobile
**Example:**
```typescript
// Source: WCAG 2.5.5 guidelines
// Primary actions: explicit 44px sizing
<button className="min-h-[44px] min-w-[44px] p-3">
  <Icon className="w-5 h-5" />
</button>

// Links with padding to achieve 44px touch area
<a href="/course" className="py-3 px-4 -my-3 -mx-4">
  Course
</a>

// Dense lists: use scroll container, don't require 44px per item
<nav className="overflow-y-auto">
  {items.map(item => (
    <a key={item.id} className="block py-2 px-4"> {/* Smaller OK in scrolling list */}
      {item.title}
    </a>
  ))}
</nav>
```

### Anti-Patterns to Avoid
- **Duplicating components for mobile:** Don't create `MobileModuleDrawer.tsx` separate from `ModuleDrawer.tsx` - use responsive styling within the same component
- **Hard-coding breakpoints:** Use Tailwind's `md:` prefix or a shared constant, not magic numbers scattered in code
- **Disabling scroll on body without cleanup:** Always clean up `overflow: hidden` in useEffect return
- **Using `onTouchStart` instead of `onClick`:** React normalizes events; `onClick` works on touch devices

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Media query detection | Manual resize listeners | `useMedia` from react-use | Handles SSR, cleanup, matchMedia API properly |
| Element measurement | Manual getBoundingClientRect | `useMeasure` from react-use | Already used in `useHeaderLayout`, handles resize |
| Scroll locking | Manual overflow toggling | Body scroll lock pattern | Need to restore on unmount, handle multiple drawers |
| Focus trapping in modals | Manual focus management | Native `<dialog>` or existing patterns | Accessibility critical, easy to get wrong |

**Key insight:** The project already has `react-use` which provides robust hooks for responsive behavior. Don't reimplement what's already available.

## Common Pitfalls

### Pitfall 1: iOS Safari 100vh Issue
**What goes wrong:** `100vh` doesn't account for Safari's dynamic toolbar, causing content to be hidden
**Why it happens:** Safari's address bar changes viewport height dynamically
**How to avoid:** Already mitigated in Phase 1 - use `h-dvh` and `min-h-dvh` from Tailwind v4
**Warning signs:** Content cut off at bottom on iOS Safari

### Pitfall 2: Scroll Position Jump on Drawer Open
**What goes wrong:** Page jumps when drawer opens and body scroll is locked
**Why it happens:** Setting `overflow: hidden` on body can cause scroll position to reset
**How to avoid:** Save and restore scroll position, or use `position: fixed` with top offset
**Warning signs:** User loses place in content when opening/closing drawer

### Pitfall 3: Touch Events Not Firing on First Tap
**What goes wrong:** Links/buttons require double-tap on iOS
**Why it happens:** iOS has 300ms delay for double-tap-to-zoom detection
**How to avoid:** Already mitigated in Phase 1 - `touch-action: manipulation` is set in globals.css
**Warning signs:** Users reporting unresponsive buttons

### Pitfall 4: Header Flashing During Fast Scroll
**What goes wrong:** Header rapidly shows/hides during scroll momentum
**Why it happens:** Threshold too low, or not using `requestAnimationFrame`
**How to avoid:** Use ~100px threshold, throttle with rAF, add CSS transition
**Warning signs:** Header "flickering" during scroll

### Pitfall 5: Drawer Animation Janky on Mobile
**What goes wrong:** Drawer slide animation stutters or lags
**Why it happens:** Using properties that trigger layout (width, height) instead of transform
**How to avoid:** Use `transform: translateX()` for slide animations, ensure `will-change: transform`
**Warning signs:** Animation not smooth 60fps

### Pitfall 6: Z-Index Wars
**What goes wrong:** Modals, drawers, headers compete for visibility
**Why it happens:** Ad-hoc z-index values without a system
**How to avoid:** Use consistent z-index scale (header: 50, drawer: 50, backdrop: 40, modal: 60)
**Warning signs:** Elements unexpectedly appearing above/below each other

## Code Examples

Verified patterns from codebase and official sources:

### Existing ModuleDrawer (Current Implementation)
```typescript
// Source: /web_frontend/src/components/module/ModuleDrawer.tsx
// Current: slides from left at 40% width
// Modification needed: on mobile, use 80% width with backdrop

<div
  className={`fixed top-0 left-0 h-full w-[40%] max-w-md bg-white z-50
    transition-transform duration-200
    ${isOpen ? "translate-x-0 shadow-[8px_0_30px_-5px_rgba(0,0,0,0.2)]" : "-translate-x-full"}`}
>
```

### Existing Header Pattern (Layout.tsx)
```typescript
// Source: /web_frontend/src/components/Layout.tsx
// Current: Fixed header, no mobile menu
<nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-stone-50/70 border-b border-slate-200/50">
  <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
    <div className="flex items-center justify-between h-16">
      {/* Logo + nav items */}
    </div>
  </div>
</nav>
```

### useMedia from react-use (Available in Project)
```typescript
// Source: react-use documentation
import { useMedia } from 'react-use';

const Demo = () => {
  const isMobile = useMedia('(max-width: 767px)');
  const isTablet = useMedia('(min-width: 768px) and (max-width: 1023px)');
  const isDesktop = useMedia('(min-width: 1024px)');

  return <div>{isMobile ? 'Mobile' : 'Desktop'}</div>;
};
```

### Safe Area Variables (From Phase 1)
```css
/* Source: /web_frontend/src/styles/globals.css */
:root {
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left: env(safe-area-inset-left, 0px);
  --safe-right: env(safe-area-inset-right, 0px);
}
```

### Tailwind Responsive Prefixes
```html
<!-- Source: Tailwind CSS documentation -->
<!-- Mobile-first: base styles are mobile, prefixes add larger screen styles -->
<div class="flex flex-col md:flex-row">          <!-- Stack on mobile, row on tablet+ -->
<div class="hidden md:block">                    <!-- Hide on mobile, show on tablet+ -->
<div class="md:hidden">                          <!-- Show on mobile only -->
<div class="w-full md:w-[80%] lg:w-72">          <!-- Full width mobile, 80% tablet, fixed desktop -->
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Fixed `100vh` | Dynamic `dvh` units | 2023+ | Fixes iOS Safari viewport issues |
| 300ms tap delay | `touch-action: manipulation` | Modern browsers | Instant tap response |
| JS scroll detection | CSS `scroll-behavior` | Modern CSS | Smoother, but JS still needed for hide-on-scroll |
| Separate mobile components | Responsive within single component | Best practice | Reduces code duplication, easier maintenance |

**Deprecated/outdated:**
- `vh` units for full-height mobile layouts (use `dvh`)
- `-webkit-overflow-scrolling: touch` (now default in modern iOS)
- Viewport meta `user-scalable=no` (bad for accessibility, not needed with proper tap handling)

## Open Questions

Things that couldn't be fully resolved:

1. **Bottom Navigation Bar Content**
   - What we know: NAV-04 requires bottom nav bar for primary actions on mobile
   - What's unclear: Which specific actions should appear there (context-dependent)
   - Recommendation: Implement hook/component infrastructure, finalize content based on page context during planning

2. **Tablet Breakpoint Behavior**
   - What we know: User wants tablet hybrid (768-1024px), sidebars visible in landscape
   - What's unclear: Exact threshold for showing/hiding sidebar (768px? 1024px? orientation?)
   - Recommendation: Start with 1024px for sidebar visibility, iterate based on testing

3. **Swipe-to-Dismiss Gesture**
   - What we know: User wants swipe back to edge as dismissal method
   - What's unclear: Implementation complexity without gesture library
   - Recommendation: Implement backdrop tap and X button first; swipe can be added later with touch event handlers if time permits (nice-to-have)

## Sources

### Primary (HIGH confidence)
- `/web_frontend/src/` - Existing codebase components, hooks, and patterns
- react-use documentation - `useMedia`, `useMeasure` hooks
- Tailwind CSS v4 documentation - Responsive prefixes, dvh utilities
- WCAG 2.5.5 - 44px touch target requirement

### Secondary (MEDIUM confidence)
- Multiple GitHub repos demonstrating `useScrollDirection` hook pattern
- react-headroom library patterns (not using library, but pattern is validated)
- Smashing Magazine accessible tap targets guide

### Tertiary (LOW confidence)
- Various blog posts on mobile drawer patterns (patterns vary, cross-referenced with codebase needs)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Using only existing project dependencies
- Architecture: HIGH - Patterns match existing codebase structure
- Pitfalls: HIGH - Common issues well-documented, Phase 1 already addressed some
- Touch targets: HIGH - WCAG guidelines are authoritative
- Swipe gestures: MEDIUM - May require iteration to get feel right

**Research date:** 2026-01-21
**Valid until:** 2026-02-21 (30 days - stable domain, patterns well-established)
