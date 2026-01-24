# Architecture Research: Mobile Responsive Retrofits

**Domain:** Retrofitting mobile responsiveness into existing React/Tailwind application
**Researched:** 2026-01-21
**Overall confidence:** HIGH (patterns verified via Tailwind CSS docs and codebase analysis)

## Executive Summary

The existing codebase uses React 19 with Tailwind CSS v4, already applying some mobile-first responsive patterns (px-4 sm:px-6 lg:px-8). However, core learning components were designed desktop-first with fixed widths and viewport-relative heights that break on mobile.

The retrofit strategy should:
1. Convert fixed positioning patterns to mobile-appropriate alternatives
2. Replace percentage-width drawers with full-screen mobile overlays
3. Make video embeds responsive (YouTube iframes already responsive)
4. Restructure the chat interface for touch-first mobile input
5. Simplify navigation for mobile contexts

## Current Architecture Analysis

### Component Patterns Found

**Layout.tsx**: Already uses responsive padding (`px-4 sm:px-6 lg:px-8`). Good foundation.

**ModuleHeader.tsx**: Complex desktop layout with:
- useHeaderLayout hook for measuring and triggering two-row mode
- Soft centering pattern with flex spacers
- Fixed-width container for action buttons (120px)
- **Mobile issue:** Too many elements for narrow screens

**ModuleDrawer.tsx**: Desktop slide-out drawer pattern:
- Fixed positioning (`fixed top-0 left-0`)
- Percentage width (`w-[40%] max-w-md`)
- External click-to-close overlay
- **Mobile issue:** 40% width is too narrow on phones; needs full-width takeover

**NarrativeChatSection.tsx**: Complex chat with:
- Fixed height container (`height: 85vh`)
- Voice recording with volume visualization
- Auto-resizing textarea
- **Mobile issue:** 85vh leaves no room for mobile keyboard; touch targets may be small

**VideoEmbed.tsx**: Lazy-loading video with responsive aspects:
- Uses `aspect-video` for 16:9 ratio (good)
- Width classes: `w-[90%] max-w-[1100px]` when expanded
- **Mobile issue:** Compact vs expanded states may not make sense on mobile

**LandingNav.tsx / Layout.tsx**: Navigation bars:
- Fixed top positioning (good)
- Horizontal nav items
- **Mobile issue:** No hamburger menu; items may wrap or overflow

### CSS Architecture

Tailwind CSS v4 with custom theme:
```css
@theme {
  --container-content: 640px;
  --container-content-padded: calc(var(--container-content) + 128px);
}
```

The `max-w-content` class creates a 640px content column. This is appropriate for mobile readability but sidebar/drawer patterns need adjustment.

## Component Modification Patterns

### Pattern 1: Responsive Drawer (ModuleDrawer)

**Desktop:** Slide-out drawer at 40% width
**Mobile:** Full-screen overlay with close button

```tsx
// Before
<div className="fixed top-0 left-0 h-full w-[40%] max-w-md">

// After - mobile-first with desktop override
<div className={`
  fixed inset-0              /* Mobile: full screen */
  md:inset-auto md:top-0 md:left-0 md:h-full md:w-[40%] md:max-w-md
`}>
```

**State management:** No changes needed. Same `isOpen` state controls both layouts.

### Pattern 2: Responsive Navigation (ModuleHeader)

**Desktop:** Full header with logo, title, progress bar, actions
**Mobile:** Simplified header with hamburger menu

```tsx
// Mobile-first approach
<header className="relative bg-white border-b px-4 py-3">
  {/* Mobile: Minimal header */}
  <div className="flex items-center justify-between md:hidden">
    <button onClick={openDrawer}>Menu</button>
    <span className="truncate">{moduleTitle}</span>
    <UserMenu />
  </div>

  {/* Desktop: Full header */}
  <div className="hidden md:flex items-center">
    {/* Existing desktop layout */}
  </div>
</header>
```

**State management:** May need shared state for mobile drawer if combining with ModuleDrawer.

### Pattern 3: Responsive Chat (NarrativeChatSection)

**Desktop:** Fixed 85vh height container
**Mobile:** Flexible height that respects keyboard

```tsx
// Before
style={{ height: "85vh" }}

// After - CSS approach
className="h-screen md:h-[85vh]"
// Plus: Add padding-bottom for mobile keyboard via env(safe-area-inset-bottom)
```

**Key changes:**
1. Use `min-h-0` to allow flex children to shrink
2. Add `pb-safe` or `padding-bottom: env(safe-area-inset-bottom)` for notch devices
3. Increase touch target sizes on buttons (min 44px)
4. Consider bottom-sheet input pattern for mobile

### Pattern 4: Responsive Video (VideoEmbed)

Already uses `aspect-video` which is responsive. Changes needed:

```tsx
// Before
const containerClasses = isActivated
  ? "w-[90%] max-w-[1100px] mx-auto"
  : "max-w-content mx-auto";

// After - full width on mobile
const containerClasses = isActivated
  ? "w-full md:w-[90%] max-w-[1100px] mx-auto px-4 md:px-0"
  : "max-w-content mx-auto px-4 md:px-0";
```

### Pattern 5: Container Queries for Component-Level Responsiveness

Tailwind CSS v4 supports container queries natively. For components that need to adapt based on their container rather than viewport:

```tsx
<div className="@container">
  <div className="flex flex-col @md:flex-row">
    {/* Responds to container width, not viewport */}
  </div>
</div>
```

**Use case:** CourseSidebar content when sidebar is visible vs hidden.

## State Management for Responsive Behavior

### Option A: CSS-Only (Recommended for most cases)

Use Tailwind breakpoint classes. No JavaScript state needed.

```tsx
// Hide on mobile, show on desktop
<div className="hidden md:block">Desktop content</div>
<div className="md:hidden">Mobile content</div>
```

**Pros:** No hydration issues, no JS execution, instant
**Cons:** Both DOM trees render (mitigated by CSS containment)

### Option B: useMediaQuery Hook

For behavior that must differ (not just appearance):

```tsx
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

// Usage
const isMobile = useMediaQuery('(max-width: 767px)');
```

**Use when:** Navigation drawer open/close behavior, keyboard handling

### Option C: Shared Responsive Context

For coordinating responsive state across components:

```tsx
const ResponsiveContext = createContext({ isMobile: false });

function ResponsiveProvider({ children }) {
  const isMobile = useMediaQuery('(max-width: 767px)');
  return (
    <ResponsiveContext.Provider value={{ isMobile }}>
      {children}
    </ResponsiveContext.Provider>
  );
}
```

**Use when:** Multiple components need to coordinate responsive behavior

## CSS Architecture Patterns

### Breakpoint Strategy

Tailwind v4 default breakpoints (mobile-first):
- `sm`: 640px
- `md`: 768px (tablet portrait, key breakpoint)
- `lg`: 1024px (tablet landscape, small desktop)
- `xl`: 1280px
- `2xl`: 1536px

**Recommendation:** Use `md` (768px) as the primary mobile/desktop split.

### Touch Target Sizes

iOS and Android guidelines: minimum 44x44px touch targets.

```tsx
// Before
<button className="p-2">

// After
<button className="p-2 md:p-2 min-h-11 min-w-11">
```

### Safe Areas for Notched Devices

```css
/* In globals.css */
@supports (padding-bottom: env(safe-area-inset-bottom)) {
  .pb-safe {
    padding-bottom: env(safe-area-inset-bottom);
  }
}
```

### Preventing Horizontal Scroll

```tsx
// Wrap root layout
<div className="overflow-x-hidden min-h-screen">
```

### Font Sizing for Mobile Readability

The `max-w-content: 640px` already provides good line lengths. Ensure:
- Body text: 16px minimum (already default)
- Use `text-base` not smaller on mobile

## Modification Order

Based on dependencies and user impact:

### Phase 1: Foundation (No dependencies)
1. **MobileWarning removal** - Currently blocks mobile entirely
2. **Layout.tsx** - Add safe area support, verify padding
3. **globals.css** - Add touch utilities, safe area classes

### Phase 2: Navigation (Foundation required)
4. **LandingNav.tsx** - Add hamburger menu for mobile
5. **ModuleHeader.tsx** - Create mobile-simplified version
6. **ModuleDrawer.tsx** - Convert to full-screen mobile overlay

### Phase 3: Content Components (Navigation provides context)
7. **VideoEmbed.tsx** - Full-width mobile, remove compact/expanded distinction
8. **ArticleEmbed.tsx** - Verify responsive text (likely already good)
9. **NarrativeChatSection.tsx** - Most complex; keyboard handling, touch targets

### Phase 4: Course Navigation (Content components inform patterns)
10. **CourseSidebar.tsx** - Mobile overlay or bottom sheet
11. **CourseOverview.tsx** - Responsive grid/list toggle

### Phase 5: Forms and Modals
12. **EnrollWizard.tsx** - Full-screen mobile steps
13. **AuthPromptModal.tsx** - Bottom sheet on mobile
14. **CookieSettings.tsx** - Already modal, verify sizing

## Risks and Mitigations

### Risk 1: Breaking Desktop Layout

**Impact:** HIGH - Existing users disrupted
**Mitigation:**
- Mobile-first classes with `md:` overrides preserve desktop
- Use feature flags to test mobile changes before desktop impact
- Extensive visual regression testing at key breakpoints

### Risk 2: Fixed Heights Breaking with Mobile Keyboard

**Impact:** HIGH - Chat becomes unusable when keyboard opens
**Mitigation:**
- Use `dvh` (dynamic viewport height) instead of `vh` where supported
- Listen for `visualViewport` resize events
- Test on actual iOS/Android devices (simulators don't match keyboard behavior)

### Risk 3: Touch Target Accessibility

**Impact:** MEDIUM - Poor mobile UX
**Mitigation:**
- Add `min-h-11 min-w-11` (44px) to all interactive elements
- Ensure adequate spacing between touch targets (8px minimum)
- Test with touch, not just mouse

### Risk 4: Performance on Mobile Devices

**Impact:** MEDIUM - Sluggish experience
**Mitigation:**
- Reduce DOM complexity on mobile (simpler layouts)
- Lazy load heavy components (video is already lazy)
- Test on low-end Android devices

### Risk 5: Video Player on Mobile

**Impact:** MEDIUM - YouTube iframe behavior varies
**Mitigation:**
- Test YouTube iframe on iOS Safari (has quirks with fullscreen)
- Consider native fullscreen on mobile
- Ensure play/pause touch targets are large enough

## Testing Strategy

### Breakpoint Matrix

| Viewport | Device Class | Key Test |
|----------|--------------|----------|
| 320px | iPhone SE | Minimum supported |
| 375px | iPhone 14 | Common phone |
| 414px | iPhone 14 Pro Max | Large phone |
| 768px | iPad portrait | Tablet breakpoint |
| 1024px | iPad landscape | Desktop threshold |
| 1280px+ | Desktop | Existing behavior preserved |

### Device Testing Priority

1. **iOS Safari** (most restrictive, different keyboard behavior)
2. **Chrome Android** (most common mobile browser)
3. **Chrome Desktop** (regression testing)

### Automated Testing

- Playwright visual regression at each breakpoint
- Accessibility testing for touch targets (axe-core)
- Performance testing on mobile throttling

## Sources

- Tailwind CSS v4 documentation (via Context7)
- Existing codebase analysis:
  - `web_frontend/src/components/module/ModuleDrawer.tsx`
  - `web_frontend/src/components/ModuleHeader.tsx`
  - `web_frontend/src/components/module/NarrativeChatSection.tsx`
  - `web_frontend/src/components/module/VideoEmbed.tsx`
  - `web_frontend/src/components/Layout.tsx`
  - `web_frontend/src/styles/globals.css`
- react-responsive library patterns
- MDN Container Queries documentation
