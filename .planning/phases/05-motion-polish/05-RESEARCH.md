# Phase 5: Motion & Polish - Research

**Researched:** 2026-01-22
**Domain:** CSS animations, View Transitions API, touch feedback, loading states
**Confidence:** HIGH

## Summary

This phase adds motion and polish to the mobile-responsive foundation built in Phases 1-4. The research covers four main areas: drawer/overlay animations with spring physics, page transitions using the View Transitions API, touch feedback patterns, and skeleton loading states.

The View Transitions API became Baseline Newly Available in October 2025 (Chrome 111+, Safari 18+, Firefox 144+), making it safe for production use with graceful fallbacks. For spring/bounce animations, CSS now supports the `linear()` timing function which can produce authentic spring physics without JavaScript. Touch feedback can be implemented purely with CSS `:active` states combined with `transform: scale()`. Skeleton loaders can be built with simple CSS animations without requiring external dependencies.

**Primary recommendation:** Use native browser APIs (View Transitions, CSS `linear()` easing, `:active` pseudo-class) over JavaScript animation libraries. The existing Tailwind/CSS-based animation patterns in the codebase provide a solid foundation to extend.

## Standard Stack

The established approach for this domain uses native browser features:

### Core (No Additional Dependencies)
| Feature | Implementation | Purpose | Why Standard |
|---------|---------------|---------|--------------|
| View Transitions API | `document.startViewTransition()` | Page transitions | Baseline Newly Available Oct 2025, browser-native |
| CSS `linear()` | Custom easing values | Spring/bounce animations | Supported in all modern browsers, GPU-accelerated |
| CSS `:active` | Pseudo-class styling | Touch feedback | Zero JS overhead, immediate response |
| CSS `@keyframes` | Pulse animation | Skeleton loaders | Already used in codebase, performant |

### Supporting (Already in Project)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Tailwind CSS | v4 | Utility classes for transitions | All animation styling |
| react-use | ^17.6.0 | `useMedia` hook | Already used for responsive detection |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native View Transitions | Framer Motion | Larger bundle, more control but overkill for page transitions |
| CSS `linear()` | react-spring | JS-based, larger bundle, but more programmatic control |
| Manual skeletons | react-loading-skeleton | Extra dependency for simple use case |
| Native View Transitions | React `<ViewTransition>` | React 19 Canary only, not stable yet |

**No new dependencies required.** The existing stack (Tailwind CSS v4, React 19, Vike 0.4) supports all needed features.

## Architecture Patterns

### Recommended CSS Organization
```
src/styles/
├── globals.css            # Existing - extend with new keyframes
└── (inline Tailwind)      # Component-level via className
```

### Pattern 1: Spring Easing with CSS `linear()`
**What:** Define spring/bounce curves using the `linear()` timing function with 40+ control points
**When to use:** Drawer open/close, element entrances with overshoot
**Example:**
```css
/* Source: Josh Comeau - Springs and Bounces in Native CSS */
:root {
  /* Spring with slight overshoot - generated from spring physics */
  --ease-spring: linear(
    0, 0.006, 0.025 2.8%, 0.101 6.1%, 0.539 18.9%, 0.721 25.3%, 0.849 31.5%,
    0.937 38.1%, 0.968 41.8%, 0.991 45.7%, 1.006 50%, 1.015 55%, 1.017 63.9%,
    1.014 73.1%, 1.007 85.5%, 1
  );

  /* Fallback for older browsers */
  --ease-out-back: cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* Usage with fallback */
.drawer {
  transition: transform 300ms var(--ease-out-back);
  transition: transform 300ms var(--ease-spring);
}
```

### Pattern 2: View Transitions for Page Navigation
**What:** Use `document.startViewTransition()` for smooth page changes
**When to use:** SPA navigation in Vike
**Example:**
```typescript
// Source: MDN - Document.startViewTransition()
// +onPageTransitionStart.ts (Vike hook)
export async function onPageTransitionStart(pageContext) {
  document.body.classList.add('page-transition');

  // Check for browser support
  if (!document.startViewTransition) return;

  // Mark direction for CSS
  if (pageContext.isBackwardNavigation) {
    document.documentElement.dataset.direction = 'back';
  } else {
    document.documentElement.dataset.direction = 'forward';
  }
}

// +onPageTransitionEnd.ts
export async function onPageTransitionEnd() {
  document.body.classList.remove('page-transition');
  delete document.documentElement.dataset.direction;
}
```

```css
/* Source: Chrome Developers - View Transitions */
/* Directional slide based on navigation direction */
@keyframes slide-from-right {
  from { transform: translateX(100%); }
}
@keyframes slide-to-left {
  to { transform: translateX(-100%); }
}
@keyframes slide-from-left {
  from { transform: translateX(-100%); }
}
@keyframes slide-to-right {
  to { transform: translateX(100%); }
}

/* Forward navigation: content slides left */
[data-direction="forward"]::view-transition-old(root) {
  animation: slide-to-left 300ms ease-out;
}
[data-direction="forward"]::view-transition-new(root) {
  animation: slide-from-right 300ms ease-out;
}

/* Back navigation: content slides right */
[data-direction="back"]::view-transition-old(root) {
  animation: slide-to-right 300ms ease-out;
}
[data-direction="back"]::view-transition-new(root) {
  animation: slide-from-left 300ms ease-out;
}
```

### Pattern 3: Touch Feedback with CSS `:active`
**What:** Scale down + color shift on press using CSS only
**When to use:** All interactive elements (buttons, cards, nav items)
**Example:**
```css
/* Source: LogRocket - Designing Button States */
/* Touch feedback - combine scale + color for maximum tactile feel */
.touch-feedback {
  transition: transform 50ms ease-out, background-color 50ms ease-out;
}

.touch-feedback:active {
  transform: scale(0.97);
  /* Color shift handled per-component */
}

/* For cards that scale as a whole */
.touch-card:active {
  transform: scale(0.98);
}
```

### Pattern 4: Skeleton Loading with CSS Animation
**What:** Pulsing placeholder matching content structure
**When to use:** Content areas while data loads
**Example:**
```css
/* Skeleton pulse animation */
@keyframes skeleton-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.skeleton {
  background: linear-gradient(90deg, #e5e7eb 0%, #f3f4f6 50%, #e5e7eb 100%);
  background-size: 200% 100%;
  animation: skeleton-pulse 1.5s ease-in-out infinite;
  border-radius: 4px;
}
```

```tsx
// Skeleton component pattern
function TextSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="skeleton h-4"
          style={{ width: i === lines - 1 ? '60%' : '100%' }}
        />
      ))}
    </div>
  );
}
```

### Pattern 5: Staggered Reveal Animation
**What:** List items animate in sequence with incremental delays
**When to use:** Chat messages loading, module stage lists
**Example:**
```css
/* Staggered reveal using CSS custom properties */
@keyframes fade-slide-up {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.stagger-item {
  animation: fade-slide-up 300ms ease-out both;
  animation-delay: calc(var(--stagger-index, 0) * 50ms);
}
```

```tsx
// React usage
{items.map((item, i) => (
  <div
    key={item.id}
    className="stagger-item"
    style={{ '--stagger-index': i } as React.CSSProperties}
  />
))}
```

### Anti-Patterns to Avoid
- **JavaScript-driven animations for simple state changes:** Use CSS transitions/animations instead
- **Animating layout properties (width, height, top, left):** Causes reflow; use `transform` and `opacity` only
- **Long animation durations on mobile:** Keep under 400ms for responsiveness
- **Forgetting `prefers-reduced-motion`:** Always provide reduced/no-motion alternative
- **Using `transition: all`:** Explicitly list properties to avoid unexpected performance issues

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Spring physics curves | Manual cubic-bezier tweaking | `linear()` generator tools | Spring physics is mathematically complex |
| Page transition state management | Custom transition tracking | Vike hooks + View Transitions API | Browser handles snapshot/animation |
| Skeleton shimmer gradient | Complex gradient animation | Simple pulse opacity | Shimmer is heavy on GPU, pulse is lighter |
| Cross-browser animation detection | Feature detection code | `@supports` CSS rule | Cleaner, declarative |

**Key insight:** The View Transitions API handles the complexity of snapshotting old/new states and coordinating animations - don't recreate this logic manually.

## Common Pitfalls

### Pitfall 1: Ignoring `prefers-reduced-motion`
**What goes wrong:** Users with vestibular disorders experience discomfort or nausea
**Why it happens:** Developers forget accessibility settings exist
**How to avoid:** Always include reduced-motion media query
**Warning signs:** No `@media (prefers-reduced-motion)` in CSS
```css
/* Source: MDN - prefers-reduced-motion */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

### Pitfall 2: View Transitions Without Fallback
**What goes wrong:** Blank or broken transitions in unsupported browsers
**Why it happens:** Assuming universal browser support
**How to avoid:** Always check `document.startViewTransition` exists before using
**Warning signs:** Page flickers or freezes during navigation on older browsers
```javascript
// Always guard View Transitions calls
if (document.startViewTransition) {
  document.startViewTransition(() => updateDOM());
} else {
  updateDOM(); // Fallback: instant update
}
```

### Pitfall 3: Animating Non-Composited Properties
**What goes wrong:** Janky, stuttering animations on mobile
**Why it happens:** Animating `width`, `height`, `margin`, `padding` triggers layout recalculation
**How to avoid:** Only animate `transform` and `opacity`
**Warning signs:** 60fps drops during animation, visible stuttering on scroll
```css
/* Bad - triggers layout */
.drawer { transition: width 300ms; }

/* Good - GPU composited */
.drawer { transition: transform 300ms; }
```

### Pitfall 4: Touch Feedback Delay
**What goes wrong:** 300ms delay on mobile tap due to double-tap-to-zoom
**Why it happens:** Browser waits to see if user will double-tap
**How to avoid:** Use `touch-action: manipulation` (already in project's globals.css)
**Warning signs:** Noticeable lag between tap and visual feedback

### Pitfall 5: Skeleton Layout Shift
**What goes wrong:** Content jumps when real data replaces skeleton
**Why it happens:** Skeleton dimensions don't match actual content
**How to avoid:** Match skeleton dimensions exactly to expected content height
**Warning signs:** CLS (Cumulative Layout Shift) issues, content jumping on load

## Code Examples

### Drawer Animation with Spring and Backdrop
```tsx
// Source: Verified pattern from existing ModuleDrawer.tsx
// Enhanced with spring easing and choreographed backdrop

// globals.css additions
const cssAdditions = `
@keyframes drawer-slide-in {
  from { transform: translateX(-100%); }
  to { transform: translateX(0); }
}

@keyframes backdrop-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

:root {
  --ease-spring: linear(
    0, 0.006, 0.025 2.8%, 0.101 6.1%, 0.539 18.9%, 0.721 25.3%, 0.849 31.5%,
    0.937 38.1%, 0.968 41.8%, 0.991 45.7%, 1.006 50%, 1.015 55%, 1.017 63.9%,
    1.014 73.1%, 1.007 85.5%, 1
  );
}

/* Drawer choreography: backdrop fades first (100ms), then drawer slides */
.drawer-backdrop {
  animation: backdrop-fade-in 100ms ease-out forwards;
}

.drawer-panel {
  animation: drawer-slide-in 300ms var(--ease-spring) 100ms forwards;
  transform: translateX(-100%); /* Start off-screen */
}

/* Close: reverse choreography */
.drawer-closing .drawer-panel {
  animation: drawer-slide-in 250ms var(--ease-spring) reverse forwards;
}

.drawer-closing .drawer-backdrop {
  animation: backdrop-fade-in 150ms ease-out 150ms reverse forwards;
}
`;
```

### Chat Message Dots Loading Animation
```css
/* Source: Pattern from research - dots animation for chat */
@keyframes bounce-dot {
  0%, 80%, 100% { transform: translateY(0); }
  40% { transform: translateY(-6px); }
}

.chat-loading-dots {
  display: flex;
  gap: 4px;
  padding: 12px 16px;
}

.chat-loading-dots span {
  width: 8px;
  height: 8px;
  background: #94a3b8;
  border-radius: 50%;
  animation: bounce-dot 1.4s ease-in-out infinite;
}

.chat-loading-dots span:nth-child(1) { animation-delay: 0ms; }
.chat-loading-dots span:nth-child(2) { animation-delay: 160ms; }
.chat-loading-dots span:nth-child(3) { animation-delay: 320ms; }
```

```tsx
function ChatLoadingDots() {
  return (
    <div className="chat-loading-dots">
      <span /><span /><span />
    </div>
  );
}
```

### View Transition Integration with Vike
```typescript
// Source: Vike documentation - +onPageTransitionStart/End hooks
// pages/+onPageTransitionStart.ts
import type { PageContextClient } from 'vike/types';

export async function onPageTransitionStart(pageContext: Partial<PageContextClient>) {
  // Skip if browser doesn't support View Transitions
  if (!document.startViewTransition) return;

  // Set direction attribute for CSS
  const direction = pageContext.isBackwardNavigation ? 'back' : 'forward';
  document.documentElement.setAttribute('data-transition', direction);
}

// pages/+onPageTransitionEnd.ts
export async function onPageTransitionEnd() {
  document.documentElement.removeAttribute('data-transition');
}
```

### Touch Feedback Tailwind Classes
```tsx
// Reusable touch feedback pattern
const touchFeedbackClasses = "active:scale-[0.97] active:brightness-95 transition-transform duration-50";

// Usage on buttons
<button className={`px-4 py-2 bg-blue-600 text-white rounded-lg ${touchFeedbackClasses}`}>
  Send
</button>

// Usage on cards
<div className="bg-white rounded-lg p-4 active:scale-[0.98] transition-transform duration-50">
  Card content
</div>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| JS animation libraries (GSAP, anime.js) | CSS `linear()` + View Transitions | 2025 | Smaller bundles, better performance |
| Manual spring physics in JS | CSS `linear()` easing function | 2023 (Baseline 2024) | No JS needed for spring animations |
| Custom page transition frameworks | Native View Transitions API | Oct 2025 (Baseline) | Browser handles complexity |
| `cubic-bezier()` only | `linear()` timing function | 2023 | Enables spring/bounce without JS |
| Spinner loading indicators | Skeleton screens | 2020+ trend | Better perceived performance |

**Deprecated/outdated:**
- **react-spring for simple animations:** CSS `linear()` covers most cases now
- **Page transition JS libraries:** View Transitions API is native
- **`transform: translate3d(0,0,0)` hack:** Modern browsers auto-promote animated elements

## Open Questions

Things that couldn't be fully resolved:

1. **React `<ViewTransition>` component timing**
   - What we know: Available in React Canary (not stable React 19)
   - What's unclear: When it will be in stable release
   - Recommendation: Use `document.startViewTransition()` directly for now; React wrapper is optional enhancement

2. **Vike + View Transitions deep integration**
   - What we know: Vike has `onPageTransitionStart/End` hooks
   - What's unclear: Whether Vike automatically wraps navigation in `startViewTransition()`
   - Recommendation: Test hooks first; may need manual integration in Layout

3. **Shared element morphing between pages**
   - What we know: Requires matching `view-transition-name` on elements across pages
   - What's unclear: Which elements in this project would benefit most
   - Recommendation: Start with page headings; expand based on testing

## Sources

### Primary (HIGH confidence)
- MDN Web Docs - `document.startViewTransition()` - API reference, code examples
- MDN Web Docs - `prefers-reduced-motion` - Accessibility implementation
- Chrome Developers - View Transitions 2025 Update - Browser support, Baseline status
- Vike Documentation - `+onPageTransitionStart()` hook - Integration patterns
- Josh W. Comeau - Springs and Bounces in Native CSS - `linear()` timing function patterns

### Secondary (MEDIUM confidence)
- web.dev - View Transitions for SPAs - Implementation patterns
- LogRocket - Designing Button States - Touch feedback best practices
- LogRocket - React Loading Skeleton - Skeleton screen patterns
- easings.net - Easing function reference (cubic-bezier values)

### Tertiary (LOW confidence)
- Community blog posts on staggered animations (patterns verified against MDN)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Using native browser APIs, no new dependencies
- Architecture patterns: HIGH - Verified against MDN documentation
- Pitfalls: HIGH - Well-documented accessibility and performance concerns
- View Transitions integration: MEDIUM - Vike-specific integration needs testing

**Research date:** 2026-01-22
**Valid until:** 2026-03-22 (60 days - View Transitions API is now stable)
