# Phase 1: Foundation & Typography - Research

**Researched:** 2026-01-21
**Domain:** Mobile CSS foundations - viewport, safe areas, typography
**Confidence:** HIGH

## Summary

This phase establishes the CSS and viewport foundations for mobile support. The primary technical challenges are:
1. Removing the MobileWarning blocker component
2. Configuring dynamic viewport units (dvh) for iOS Safari address bar behavior
3. Setting up safe area insets for notched devices
4. Establishing a mobile-appropriate typography scale

The good news: Tailwind CSS v4 (which this project uses) has built-in support for all viewport unit variants (`h-dvh`, `min-h-dvh`, etc.) out of the box. Safe areas require viewport meta configuration and CSS custom properties, but no additional libraries are needed.

**Primary recommendation:** Use Tailwind's built-in `dvh` utilities for viewport height, configure `viewport-fit=cover` in the meta tag, and use CSS `env(safe-area-inset-*)` with Tailwind arbitrary values for safe area padding.

## Standard Stack

The project already has the necessary dependencies. No new packages required.

### Core (Already Installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| tailwindcss | ^4 | CSS framework | Built-in dvh/svh/lvh utilities since v3.4, v4 has full support |
| @tailwindcss/typography | ^0.5.19 | Prose styling | Already used, supports responsive configuration |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| tailwindcss-safe-area | N/A | Safe area utilities | NOT NEEDED - use CSS env() directly in Tailwind v4 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| CSS env() + arbitrary values | tailwindcss-safe-area plugin | Plugin adds abstraction but env() is well-supported and more flexible |
| dvh units | JavaScript resize listeners | JS solution is heavier and laggy; CSS is native and performant |

**Installation:**
```bash
# No installation needed - all required packages already present
```

## Architecture Patterns

### Viewport Meta Configuration

The current viewport meta (in `+Head.tsx`) needs updating:

```tsx
// CURRENT (insufficient for safe areas)
<meta name="viewport" content="width=device-width, initial-scale=1.0" />

// REQUIRED (enables safe areas + disables zoom)
<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0, viewport-fit=cover"
/>
```

**Key insight:** `viewport-fit=cover` is REQUIRED for `env(safe-area-inset-*)` to return non-zero values. Without it, safe area CSS does nothing.

### Dynamic Viewport Height Pattern

For full-height containers that need to respect iOS Safari's dynamic address bar:

```tsx
// Pattern: Replace 100vh with dvh
// OLD
<div className="h-screen">  // 100vh - broken on iOS Safari

// NEW
<div className="h-dvh">     // 100dvh - adapts to browser chrome
<div className="min-h-dvh"> // for min-height scenarios
```

Tailwind v4 arbitrary values for partial viewport heights:
```tsx
<div className="h-[85dvh]">   // 85% of dynamic viewport
<div className="max-h-[calc(100dvh-4rem)]"> // With calculations
```

### Safe Area Inset Pattern

Using CSS env() with Tailwind arbitrary values:

```tsx
// Top padding for notch/Dynamic Island
<nav className="pt-[env(safe-area-inset-top)]">

// With minimum padding (use max() function)
<nav className="pt-[max(1rem,env(safe-area-inset-top))]">

// Bottom safe area for fixed elements only
<button className="fixed bottom-0 pb-[env(safe-area-inset-bottom)]">
```

### Global CSS Variables Pattern

Define in globals.css for reusability:

```css
:root {
  /* Safe area with fallbacks */
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left: env(safe-area-inset-left, 0px);
  --safe-right: env(safe-area-inset-right, 0px);
}
```

Then use in Tailwind:
```tsx
<div className="pt-[var(--safe-top)]">
```

### Mobile Detection Pattern (Width-Based)

Per CONTEXT.md decision to use Tailwind's sm: breakpoint (640px):

```tsx
// CSS-only approach (preferred)
<div className="block sm:hidden">Mobile content</div>
<div className="hidden sm:block">Desktop content</div>

// If JavaScript detection needed for conditional rendering
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  return isMobile;
}
```

### Anti-Patterns to Avoid
- **Using 100vh on iOS:** Always use dvh for full-viewport elements
- **constant() fallback:** Per CONTEXT.md, only use modern env() - no iOS 11.0 fallbacks
- **User-agent sniffing for mobile:** Use screen width, not navigator.userAgent (except for existing MobileWarning removal)

## Don't Hand-Roll

Problems that have existing solutions in Tailwind v4:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Dynamic viewport height | JS resize listeners | `h-dvh`, `min-h-dvh` | Native CSS, no JS overhead |
| Safe area insets | Device detection library | CSS `env()` | Browser handles device detection |
| Typography scaling | Complex media queries | Tailwind responsive prefixes | Cleaner, consistent with codebase |
| Mobile breakpoints | Custom breakpoint logic | Tailwind `sm:` prefix (640px) | Already configured, team familiar |

**Key insight:** CSS viewport units and env() variables are natively supported in all modern browsers. The only configuration needed is the viewport meta tag.

## Common Pitfalls

### Pitfall 1: viewport-fit=cover Missing
**What goes wrong:** Safe area insets return 0px on all devices
**Why it happens:** Browser default is `viewport-fit=auto` which doesn't expose safe areas
**How to avoid:** Add `viewport-fit=cover` to viewport meta tag FIRST
**Warning signs:** Safe area padding not visible on notched devices in Safari dev tools

### Pitfall 2: vh vs dvh Confusion
**What goes wrong:** Content hidden behind iOS Safari address bar
**Why it happens:** `100vh` equals "large viewport" (address bar hidden), not current viewport
**How to avoid:** Replace ALL `h-screen` / `100vh` with `h-dvh` / `100dvh`
**Warning signs:** Content cut off at bottom when Safari address bar is visible

### Pitfall 3: Safe Areas on Non-Fixed Elements
**What goes wrong:** Excessive padding on scrollable content
**Why it happens:** Applying bottom safe area to elements that scroll behind home indicator
**How to avoid:** Per CONTEXT.md - bottom safe area ONLY for fixed elements
**Warning signs:** Large gap at bottom of scrollable pages

### Pitfall 4: Portrait Lock Not Applied
**What goes wrong:** Broken layouts in landscape mode
**Why it happens:** Forgot to lock orientation per CONTEXT.md decision
**How to avoid:** Add orientation lock via CSS or PWA manifest
**Warning signs:** Layout breaks when device rotated

### Pitfall 5: Font Size Below 16px Causing Zoom
**What goes wrong:** iOS Safari auto-zooms on form input focus
**Why it happens:** Input fields with font-size < 16px trigger zoom on focus
**How to avoid:** Ensure all input elements have font-size >= 16px
**Warning signs:** Unexpected zoom when tapping input fields

## Code Examples

### Viewport Meta Update (HIGH confidence)
Source: MDN, Webkit documentation

```tsx
// web_frontend/src/pages/+Head.tsx
export default function Head() {
  return (
    <>
      <meta charSet="UTF-8" />
      <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0, viewport-fit=cover"
      />
      {/* ... rest of head */}
    </>
  );
}
```

### Layout with Safe Areas (HIGH confidence)
Source: Tailwind CSS v4 documentation, Apple HIG

```tsx
// Pattern for main layout wrapper
<div className="min-h-dvh flex flex-col pt-[env(safe-area-inset-top)]">
  <nav className="fixed top-0 left-0 right-0 z-50 pt-[env(safe-area-inset-top)]">
    {/* Navigation */}
  </nav>
  <main className="flex-1 pt-16"> {/* Account for nav height */}
    {children}
  </main>
  <footer>
    {/* No bottom safe area - content scrolls behind home indicator */}
  </footer>
</div>
```

### Fixed Bottom Element with Safe Area (HIGH confidence)
Source: Webkit blog, Apple HIG

```tsx
// Pattern for fixed buttons/inputs at bottom
<button
  className="fixed bottom-0 left-0 right-0 pb-[env(safe-area-inset-bottom)]
             px-[max(1rem,env(safe-area-inset-left))]"
>
  Fixed Action Button
</button>
```

### Chat Container with dvh (HIGH confidence)
Source: Tailwind CSS v4 documentation

```tsx
// NarrativeChatSection pattern
<div
  className="h-[85dvh] max-h-[85dvh] overflow-hidden"
  style={{ overflowAnchor: "none" }}
>
  {/* Chat content */}
</div>
```

### Mobile Typography Scale (MEDIUM confidence)
Source: Research synthesis, typography best practices

```css
/* globals.css - Add mobile typography scale */
@layer base {
  /* Mobile-first body text */
  body {
    font-size: 16px; /* Prevents iOS zoom on inputs */
    line-height: 1.6;
    -webkit-text-size-adjust: 100%; /* Prevent font scaling in landscape */
  }

  /* Mobile heading scale - distinct, not proportional */
  h1 { font-size: 1.75rem; line-height: 1.2; } /* 28px */
  h2 { font-size: 1.5rem; line-height: 1.25; }  /* 24px */
  h3 { font-size: 1.25rem; line-height: 1.3; }  /* 20px */
  h4 { font-size: 1.125rem; line-height: 1.4; } /* 18px */

  /* Tablet+ heading scale */
  @media (min-width: 640px) {
    h1 { font-size: 2.5rem; }   /* 40px - bigger jump from mobile */
    h2 { font-size: 2rem; }     /* 32px */
    h3 { font-size: 1.5rem; }   /* 24px */
    h4 { font-size: 1.25rem; }  /* 20px */
  }
}
```

### Touch Action for Faster Taps (HIGH confidence)
Source: MDN, Google Web Fundamentals

```css
/* globals.css - Disable double-tap zoom */
html {
  touch-action: manipulation;
}
```

### Orientation Lock via CSS (MEDIUM confidence)
Source: MDN

```css
/* Note: CSS orientation lock is limited; PWA manifest is more reliable */
@media (orientation: landscape) {
  /* Could show rotation prompt, but per CONTEXT.md we lock to portrait */
  /* This is a fallback hint - proper lock requires PWA manifest */
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `100vh` + JS workaround | `100dvh` CSS native | Safari 15.4 (2022), broad support 2023 | No JS needed for viewport height |
| `constant(safe-area-*)` | `env(safe-area-*)` | iOS 11.2 (2017) | `constant()` deprecated, env() is standard |
| Meta viewport without viewport-fit | `viewport-fit=cover` | iPhone X (2017) | Required for safe area support |
| rem-based responsive fonts | clamp() for fluid | 2020+ | Smooth scaling, but CONTEXT.md prefers distinct breakpoints |

**Deprecated/outdated:**
- `constant(safe-area-inset-*)`: Replaced by `env()` in iOS 11.2 - DO NOT USE per CONTEXT.md
- `-webkit-fill-available`: Inconsistent behavior, use `dvh` instead
- JS-based viewport height fixes: No longer needed with dvh support

## Open Questions

1. **Orientation lock implementation**
   - What we know: CSS has limited orientation lock support
   - What's unclear: Whether to add PWA manifest for proper lock, or just CSS fallback
   - Recommendation: Start with CSS media query warning, add PWA manifest if needed

2. **Existing `min-h-screen` usage**
   - What we know: 6 files use `min-h-screen` or `h-screen`
   - What's unclear: Whether all need migration to dvh or only some
   - Recommendation: Audit each usage during implementation; full-page containers need dvh, decorative uses may not

## Sources

### Primary (HIGH confidence)
- Tailwind CSS v4 Height Documentation - built-in dvh/svh/lvh utilities confirmed
- Tailwind CSS v3.4 Release Blog - dynamic viewport units introduction
- MDN Web Docs - env() function, viewport-fit, safe-area-inset-*

### Secondary (MEDIUM confidence)
- Webkit Blog: "Designing Websites for iPhone X" - canonical safe area documentation
- Apple Human Interface Guidelines - safe area best practices

### Tertiary (LOW confidence)
- Community examples for typography scales - synthesized recommendations

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Tailwind v4 built-in support verified via official docs
- Architecture patterns: HIGH - Well-documented CSS features with broad support
- Safe area implementation: HIGH - Official Apple/Webkit documentation
- Typography scale: MEDIUM - Based on best practices, specific values are discretionary

**Research date:** 2026-01-21
**Valid until:** 2026-04-21 (90 days - stable CSS features, unlikely to change)
