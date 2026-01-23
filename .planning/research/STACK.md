# Stack Research: Mobile Responsiveness

**Project:** AI Safety Course Platform - Mobile Responsiveness
**Researched:** 2026-01-21
**Overall Confidence:** HIGH

This research covers the standard 2025/2026 approach for making React/Tailwind web apps mobile-responsive, specific to your existing Tailwind CSS 4 setup.

---

## Tailwind CSS 4 Mobile Patterns

**Confidence: HIGH** (verified via official Tailwind CSS 4 documentation)

### Mobile-First Strategy (Required)

Tailwind CSS uses a **mobile-first** breakpoint system. Base styles apply to mobile, and breakpoint prefixes (`sm:`, `md:`, `lg:`, `xl:`, `2xl:`) apply at **minimum widths**.

```tsx
// CORRECT: Mobile-first approach
<div className="flex flex-col gap-2 md:flex-row md:gap-4">
  {children}
</div>

// WRONG: Desktop-first approach (avoid max-width prefixes)
<div className="flex-row gap-4 max-md:flex-col max-md:gap-2">
  {children}
</div>
```

**Rationale:** Mobile-first ensures the smallest screens get base styles without any media query overhead. Larger screens progressively enhance. This matches how Tailwind's breakpoints work internally.

### Default Breakpoints

Tailwind CSS 4 default breakpoints (use these, don't customize unless necessary):

| Prefix | Minimum Width | Target Devices |
|--------|---------------|----------------|
| (none) | 0px | Mobile phones (default) |
| `sm:` | 640px | Large phones, small tablets |
| `md:` | 768px | Tablets |
| `lg:` | 1024px | Laptops |
| `xl:` | 1280px | Desktops |
| `2xl:` | 1536px | Large desktops |

**Recommendation:** For student-focused mobile views, target the base (no prefix) for phones. Use `md:` as the primary breakpoint for "desktop" layouts since students on tablets should get the mobile experience.

### Tailwind CSS 4 Syntax (Your Current Setup)

Your `globals.css` already uses Tailwind CSS 4's CSS-first configuration correctly:

```css
@import "tailwindcss";
@plugin "@tailwindcss/typography";

@theme {
  --container-content: 640px;
  --container-content-padded: calc(var(--container-content) + 128px);
}
```

**No changes needed** to the Tailwind setup. Add any custom breakpoints via the `@theme` directive if needed:

```css
@theme {
  --breakpoint-xs: 360px; /* Only if you need extra-small breakpoint */
}
```

### Container Queries (Advanced)

For component-level responsiveness (chatbot, video embeds), consider container queries:

```tsx
<div className="@container">
  <div className="@md:flex-row flex flex-col">
    {/* Responds to container width, not viewport */}
  </div>
</div>
```

**When to use:** Components that appear in different contexts (sidebar vs full-width). For this project, likely useful for the chatbot component.

---

## Viewport & Meta Tags

**Confidence: HIGH** (verified via multiple authoritative sources)

### Required Meta Tags

Add to your HTML `<head>` (in Vike's `+Head.tsx` or equivalent):

```html
<!-- Essential viewport configuration -->
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />

<!-- Prevent phone number auto-detection (interferes with content) -->
<meta name="format-detection" content="telephone=no" />

<!-- Theme color for mobile browser chrome -->
<meta name="theme-color" content="#fafaf9" />
```

**Rationale:**
- `width=device-width` ensures proper scaling on mobile
- `initial-scale=1.0` prevents unexpected zoom
- `viewport-fit=cover` enables safe-area-inset support for notched devices (iPhone)
- Do NOT add `user-scalable=no` or `maximum-scale=1` - accessibility violation (users need to zoom)

### Safe Area Insets (Notched Devices)

For fixed-position elements (headers, footers), account for device notches:

```css
.fixed-header {
  padding-top: env(safe-area-inset-top);
}

.fixed-footer {
  padding-bottom: env(safe-area-inset-bottom);
}
```

Tailwind CSS 4 doesn't have built-in safe-area utilities, so use raw CSS in your `globals.css` or add inline styles.

### Dynamic Viewport Height (Critical)

**Problem:** `100vh` on mobile includes the browser address bar, causing content to be cut off.

**Solution:** Use dynamic viewport units (widely supported since 2023):

| Unit | Behavior |
|------|----------|
| `svh` | Small viewport height (address bar visible) |
| `lvh` | Large viewport height (address bar hidden) |
| `dvh` | Dynamic - smoothly transitions between svh and lvh |

```css
/* For full-height mobile layouts */
.full-height-section {
  min-height: 100dvh; /* Dynamically adjusts with address bar */
}

/* Fallback for older browsers */
.full-height-section {
  min-height: 100vh;
  min-height: 100dvh;
}
```

**Recommendation:** Use `min-height: 100dvh` for any full-screen mobile sections. Tailwind CSS 4 has `min-h-dvh` utility class.

---

## Touch Interaction

**Confidence: HIGH** (WCAG 2.2 Level AA requirements)

### Minimum Touch Target Size

**WCAG 2.5.8 (Level AA):** Interactive targets must be at least **24x24 CSS pixels**.

**Best Practice (Google/Apple):** **44x44 CSS pixels** minimum for comfortable touch.

```tsx
// CORRECT: Adequate touch target
<button className="min-h-11 min-w-11 p-3">
  <Icon className="h-5 w-5" />
</button>

// WRONG: Touch target too small
<button className="p-1">
  <Icon className="h-4 w-4" />
</button>
```

**Tailwind utilities:**
- `min-h-11` = 44px (recommended minimum)
- `min-h-6` = 24px (absolute minimum per WCAG)
- Use `p-3` or `p-4` padding on icon-only buttons

### Touch Target Spacing

Adjacent touch targets need sufficient spacing to prevent mis-taps:

```tsx
// CORRECT: Adequate spacing between touch targets
<div className="flex gap-3">
  <button className="min-h-11 min-w-11">A</button>
  <button className="min-h-11 min-w-11">B</button>
</div>

// WRONG: Targets too close together
<div className="flex gap-1">
  <button className="p-1">A</button>
  <button className="p-1">B</button>
</div>
```

### Remove Touch Delay

Modern browsers have eliminated the 300ms touch delay, but ensure fast tap responses:

```css
/* In globals.css - already good practice */
button, a, [role="button"] {
  touch-action: manipulation; /* Removes double-tap-to-zoom delay */
}
```

### Disable Unwanted Mobile Behaviors

```css
/* Prevent text selection on interactive elements */
button, [role="button"] {
  -webkit-user-select: none;
  user-select: none;
}

/* Remove tap highlight on iOS/Android */
* {
  -webkit-tap-highlight-color: transparent;
}

/* Prevent pull-to-refresh on scrollable areas */
.no-overscroll {
  overscroll-behavior: contain;
}
```

---

## Responsive Layout Patterns

**Confidence: HIGH**

### Stack to Row Pattern

Most common mobile-responsive pattern:

```tsx
// Stacks on mobile, side-by-side on tablet+
<div className="flex flex-col gap-4 md:flex-row">
  <div className="md:w-1/2">{/* Content A */}</div>
  <div className="md:w-1/2">{/* Content B */}</div>
</div>
```

### Responsive Grid

```tsx
// 1 column on mobile, 2 on tablet, 3 on desktop
<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
  {items.map(item => <Card key={item.id} />)}
</div>
```

### Hide/Show Elements

```tsx
// Show hamburger menu on mobile only
<button className="md:hidden">Menu</button>

// Show full nav on tablet+
<nav className="hidden md:flex">...</nav>
```

### Responsive Typography

```tsx
<h1 className="text-2xl font-bold md:text-3xl lg:text-4xl">
  Heading
</h1>
<p className="text-base md:text-lg">
  Body text
</p>
```

### Responsive Spacing

```tsx
<div className="px-4 py-6 md:px-8 md:py-12 lg:px-12 lg:py-16">
  {/* Progressive padding increase */}
</div>
```

---

## Testing Tools

**Confidence: HIGH**

### Browser DevTools (Primary)

**Chrome DevTools Device Mode:**
1. Open DevTools (Cmd+Option+I on Mac)
2. Toggle device toolbar (Cmd+Shift+M)
3. Select device presets or set custom dimensions

**Key devices to test:**
- iPhone SE (375x667) - smallest common phone
- iPhone 14/15 Pro (393x852) - popular size
- iPad (768x1024) - tablet breakpoint
- Desktop (1280+)

### Playwright for Automated Testing

Your project can add mobile viewport tests:

```typescript
// playwright.config.ts
import { devices } from '@playwright/test';

export default {
  projects: [
    { name: 'Mobile Chrome', use: { ...devices['Pixel 5'] } },
    { name: 'Mobile Safari', use: { ...devices['iPhone 13'] } },
    { name: 'Desktop Chrome', use: { ...devices['Desktop Chrome'] } },
  ],
};
```

### Real Device Testing

**Required before launch:**
- Test on actual iOS Safari (iOS has unique quirks)
- Test on Android Chrome
- Verify touch interactions feel natural

**Tools:**
- BrowserStack / LambdaTest for remote device access
- Personal devices for final validation

---

## Anti-Patterns to Avoid

**Confidence: HIGH**

### 1. Desktop-First Approach

**WRONG:**
```tsx
<div className="flex-row gap-4 max-md:flex-col max-md:gap-2">
```

**WHY:** Creates more CSS, fights Tailwind's mobile-first system, harder to maintain.

**RIGHT:** Start with mobile styles, add breakpoint prefixes for larger screens.

### 2. Using `100vh` for Full-Height Elements

**WRONG:**
```tsx
<div className="h-screen">Full height</div>
```

**WHY:** On mobile, `100vh` includes the browser chrome, cutting off content.

**RIGHT:** Use `min-h-dvh` or `min-h-screen` with the dvh CSS fallback.

### 3. Fixed Pixel Widths

**WRONG:**
```tsx
<div className="w-[400px]">Content</div>
```

**WHY:** Overflows on small screens.

**RIGHT:** Use percentages, `max-w-*`, or responsive widths:
```tsx
<div className="w-full max-w-md">Content</div>
```

### 4. Tiny Touch Targets

**WRONG:**
```tsx
<button className="p-1 text-sm">X</button>
```

**WHY:** Fails WCAG, frustrates users, causes mis-taps.

**RIGHT:** Minimum 44x44px touch area.

### 5. Disabling Zoom

**WRONG:**
```html
<meta name="viewport" content="..., user-scalable=no, maximum-scale=1">
```

**WHY:** Accessibility violation - users with low vision need to zoom.

**RIGHT:** Allow zoom, design for readability at default scale.

### 6. Horizontal Overflow

**WRONG:**
```tsx
<table className="w-[800px]">...</table>
```

**WHY:** Creates horizontal scroll on mobile, breaks layout.

**RIGHT:** Use responsive tables (stack on mobile) or horizontal scroll containers:
```tsx
<div className="overflow-x-auto">
  <table className="min-w-full">...</table>
</div>
```

### 7. Hover-Only Interactions

**WRONG:**
```tsx
<div className="opacity-0 hover:opacity-100">Hidden content</div>
```

**WHY:** Touch devices have no hover state.

**RIGHT:** Use tap/click interactions, or ensure content is accessible without hover:
```tsx
<div className="opacity-100 md:opacity-0 md:hover:opacity-100">
  {/* Visible on mobile, hover-reveals on desktop */}
</div>
```

### 8. Text Too Small

**WRONG:**
```tsx
<p className="text-xs">Body text</p>
```

**WHY:** Below 16px causes iOS Safari to zoom on input focus.

**RIGHT:** Minimum 16px for body text, 14px for secondary text.

---

## Summary of Recommendations

| Area | Recommendation | Priority |
|------|----------------|----------|
| **Approach** | Mobile-first (base styles = mobile) | Critical |
| **Breakpoints** | Use default Tailwind breakpoints, `md:` as primary desktop | High |
| **Viewport** | Add proper meta tags, use `dvh` for full-height | Critical |
| **Touch targets** | Minimum 44x44px for buttons/links | Critical |
| **Typography** | Minimum 16px body text | High |
| **Testing** | Chrome DevTools + real device testing | High |

---

## Confidence Assessment

| Topic | Confidence | Reason |
|-------|------------|--------|
| Tailwind CSS 4 patterns | HIGH | Verified via official Tailwind docs |
| Viewport meta tags | HIGH | Well-established web standards |
| Touch target sizes | HIGH | WCAG 2.2 specification |
| Dynamic viewport units | HIGH | Widely supported since 2023 |
| Testing tools | HIGH | Standard industry practice |
| Anti-patterns | HIGH | Common documented issues |

---

## Sources

- Tailwind CSS 4 Documentation (responsive design, breakpoints)
- WCAG 2.2 Specification - 2.5.8 Target Size (Minimum)
- MDN Web Docs - Viewport meta tag, CSS viewport units
- CSS-Tricks - Mobile viewport units (dvh, svh, lvh)
- Chrome DevTools Documentation - Device Mode
