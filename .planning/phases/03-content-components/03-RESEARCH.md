# Phase 3: Content Components - Research

**Researched:** 2026-01-22
**Domain:** Mobile-responsive content display (video embeds, article typography, progress navigation)
**Confidence:** HIGH

## Summary

This phase focuses on optimizing lesson content for mobile devices. The codebase already has a solid foundation with existing components (`VideoEmbed.tsx`, `ArticleEmbed.tsx`, `StageProgressBar.tsx`) that need mobile-specific enhancements rather than rebuilds.

The project uses Tailwind CSS v4 with the typography plugin, React Markdown for article rendering, and a `youtube-video-element` web component for video playback. Key mobile patterns to implement include: responsive video aspect ratios, mobile-friendly article padding with code block wrapping, full-width image breakouts, and touch-friendly 44px+ tap targets for progress navigation.

The CONTEXT.md decisions lock in: native YouTube controls (no custom fullscreen behavior), code blocks that wrap rather than scroll horizontally, images that break out of margins for visual impact, and haptic feedback via `navigator.vibrate()` for progress dots.

**Primary recommendation:** Enhance existing components with responsive Tailwind classes and add haptic feedback utility, focusing on mobile-first padding/spacing adjustments rather than structural changes.

## Standard Stack

The project already uses the established libraries. No new dependencies needed.

### Core (Already Installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| tailwindcss | ^4 | CSS framework | Project standard, v4 CSS-first config |
| @tailwindcss/typography | ^0.5.19 | Prose styling | Article content rendering |
| react-markdown | ^10.1.0 | Markdown to React | Article content parsing |
| youtube-video-element | ^1.8.1 | YouTube embed | Lightweight web component |

### Supporting (Already Installed)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| remark-gfm | ^4.0.1 | GitHub Flavored Markdown | Tables, strikethrough, autolinks |
| rehype-raw | ^7.0.0 | Raw HTML in markdown | Embedded HTML support |

### No New Dependencies Needed
The Vibration API (`navigator.vibrate()`) is a native browser API - no library required. All other functionality can be achieved with existing dependencies plus Tailwind classes.

**Installation:** None required.

## Architecture Patterns

### Current Component Structure
```
web_frontend/src/components/
├── module/
│   ├── VideoEmbed.tsx        # Lazy-loading video with thumbnail
│   ├── VideoPlayer.tsx       # youtube-video-element wrapper
│   ├── ArticleEmbed.tsx      # Markdown article with ReactMarkdown
│   ├── AuthoredText.tsx      # Simple markdown (our voice)
│   └── StageProgressBar.tsx  # Progress dots and arrows
```

### Pattern 1: Responsive Container Width
**What:** Use different max-widths on mobile vs desktop
**When to use:** Article and video containers
**Example:**
```tsx
// Current (desktop-focused)
<div className="max-w-content mx-auto">

// Recommended (mobile-first)
<div className="w-full px-4 sm:px-0 sm:max-w-content mx-auto">
```

### Pattern 2: Full-Width Image Breakout
**What:** Images break out of text margins on mobile
**When to use:** Images within ArticleEmbed
**Example:**
```tsx
// In ReactMarkdown components prop
img: ({ src, alt }) => (
  <img
    src={src}
    alt={alt}
    className="w-[calc(100%+2rem)] -mx-4 sm:w-full sm:mx-0 sm:rounded-lg"
  />
)
```

### Pattern 3: Touch Target Minimum Size
**What:** All interactive elements minimum 44x44px
**When to use:** Buttons, dots, arrows in StageProgressBar
**Example:**
```tsx
// Current (28px dots)
<button className="w-7 h-7 rounded-full">

// Recommended (44px touch target)
<button className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-full">
```

### Pattern 4: Haptic Feedback Utility
**What:** Centralized vibration helper with feature detection
**When to use:** Progress dot taps, navigation actions
**Example:**
```tsx
// utils/haptics.ts
export function triggerHaptic(pattern: number | number[] = 10) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(pattern);
  }
}
```

### Anti-Patterns to Avoid
- **Horizontal scroll on mobile:** Never use `overflow-x: auto` for code blocks on small screens - wrap text instead
- **Pixel-based breakpoints:** Use Tailwind's `sm:` prefix (640px) consistent with globals.css
- **Custom video controls:** CONTEXT.md specifies native YouTube controls only
- **Fixed aspect ratios without fallback:** Always provide `aspect-video` class, not custom padding-bottom hacks

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Video aspect ratio | Padding-bottom hack | Tailwind `aspect-video` | Native CSS aspect-ratio now well-supported |
| Touch target sizing | Custom JS hit area expansion | CSS `min-w-[44px] min-h-[44px]` | Pure CSS solution, no runtime overhead |
| Haptic feedback | Complex vibration patterns | Simple `navigator.vibrate(10)` | Subtle feedback is better UX |
| Code block wrapping | Custom overflow handling | CSS `white-space: pre-wrap; word-break: break-word` | Standard solution |
| Image breakout | JavaScript width calculation | CSS negative margins with calc | Pure CSS, responsive |

**Key insight:** All mobile content optimizations can be achieved with CSS/Tailwind alone. The haptic feedback is the only JavaScript addition needed, and it's a one-liner.

## Common Pitfalls

### Pitfall 1: Video Aspect Ratio on iOS Safari
**What goes wrong:** Videos don't maintain aspect ratio in some iOS scenarios
**Why it happens:** Older iOS versions have aspect-ratio quirks
**How to avoid:** Use `aspect-video` class which compiles to `aspect-ratio: 16 / 9` with proper fallbacks in Tailwind v4
**Warning signs:** Videos appear squished or stretched on iPhone testing

### Pitfall 2: Touch Targets Too Small
**What goes wrong:** Users tap wrong progress dots, frustration increases
**Why it happens:** Visual design looks clean with small dots, but finger pads are ~10mm wide
**How to avoid:** Minimum 44x44px for all interactive elements (Apple HIG, WCAG)
**Warning signs:** Analytics show high mis-tap rates, users complain about navigation

### Pitfall 3: Haptic Feedback on Unsupported Devices
**What goes wrong:** JavaScript errors or no feedback at all
**Why it happens:** `navigator.vibrate` not available on iOS Safari or desktop
**How to avoid:** Always feature-detect: `if ('vibrate' in navigator)`
**Warning signs:** Errors in console on iOS devices

### Pitfall 4: Code Blocks Cause Horizontal Scroll
**What goes wrong:** Page becomes horizontally scrollable on mobile
**Why it happens:** Default `<pre>` behavior preserves whitespace including line length
**How to avoid:** Add `white-space: pre-wrap; word-break: break-word;` to code/pre elements
**Warning signs:** Horizontal scrollbar appears on mobile, content shifts on scroll

### Pitfall 5: Images Break Layout on Mobile
**What goes wrong:** Large images overflow container or cause horizontal scroll
**Why it happens:** Missing `max-width: 100%` or conflicting width constraints
**How to avoid:** Use `w-full` or the breakout pattern with negative margins
**Warning signs:** Horizontal scrollbar, images cut off

## Code Examples

### Responsive Video Container
```tsx
// VideoEmbed.tsx - Mobile-first container
const containerClasses = isActivated
  ? "w-full sm:w-[90%] sm:max-w-[1100px] mx-auto py-4 scroll-mt-20 transition-all duration-300"
  : "w-full px-4 sm:px-0 sm:max-w-content mx-auto py-4 scroll-mt-20 transition-all duration-300";
```

### Article Padding - Mobile-First
```tsx
// ArticleEmbed.tsx - Responsive padding
<div className="bg-amber-50/50 px-4 py-4 sm:px-10 sm:py-6 rounded-lg">
```

### Code Block Wrapping
```tsx
// In ReactMarkdown components
code: ({ children, className }) => {
  const isInline = !className;
  if (isInline) {
    return <code className="bg-gray-100 px-1 py-0.5 rounded text-sm">{children}</code>;
  }
  return (
    <code className="block bg-gray-900 text-gray-100 p-4 rounded-lg text-sm whitespace-pre-wrap break-words overflow-x-hidden">
      {children}
    </code>
  );
},
pre: ({ children }) => (
  <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-sm overflow-hidden my-4">
    {children}
  </pre>
),
```

### Full-Width Image Breakout
```tsx
// In ReactMarkdown components - images break out of margins on mobile
img: ({ src, alt }) => (
  <img
    src={src}
    alt={alt || ''}
    className="w-[calc(100%+2rem)] max-w-none -mx-4 my-4 sm:w-full sm:mx-0 sm:rounded-lg"
  />
),
```

### Blockquote/Callout Styling
```tsx
// In ReactMarkdown components - visually distinct callouts
blockquote: ({ children }) => (
  <blockquote className="bg-blue-50 border-l-4 border-blue-400 pl-4 pr-4 py-3 my-4 rounded-r-lg">
    {children}
  </blockquote>
),
```

### Touch-Friendly Progress Dots
```tsx
// StageProgressBar.tsx - 44px minimum touch targets
<button
  onClick={() => {
    triggerHaptic(10);
    handleDotClick(index, stage);
  }}
  className={`
    relative min-w-[44px] min-h-[44px] w-11 h-11 rounded-full
    flex items-center justify-center
    transition-all duration-150 disabled:cursor-default
    ${/* existing color classes */}
  `}
>
```

### Haptic Feedback Utility
```tsx
// utils/haptics.ts
/**
 * Trigger haptic feedback on supported devices.
 * Falls back silently on unsupported browsers (iOS Safari, desktop).
 * @param pattern - Vibration duration in ms or pattern array
 */
export function triggerHaptic(pattern: number | number[] = 10): void {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Silently fail - haptic is enhancement only
    }
  }
}
```

### Larger Navigation Arrows
```tsx
// StageProgressBar.tsx - Larger arrows for mobile
<button
  onClick={onPrevious}
  disabled={!canGoPrevious}
  className="min-w-[44px] min-h-[44px] p-2 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-default"
>
  <svg className="w-5 h-5 sm:w-4 sm:h-4" /* ... */ />
</button>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| padding-bottom aspect ratio hack | CSS `aspect-ratio` property | 2021+ (Safari 15) | Cleaner code, better browser support |
| Touch target expansion with JS | CSS min-width/min-height | Always available | No runtime overhead |
| Scroll-based code blocks | `white-space: pre-wrap` | CSS standard | Better mobile UX |
| Complex haptic libraries | Native `navigator.vibrate()` | Browser API | Zero dependencies |

**Deprecated/outdated:**
- `@tailwindcss/aspect-ratio` plugin: No longer needed in Tailwind v4, native `aspect-video` available
- Padding-bottom aspect ratio: Only needed for very old browser support

## Open Questions

1. **Vibration API on iOS**
   - What we know: `navigator.vibrate()` is NOT supported on iOS Safari
   - What's unclear: Whether there's a workaround or if we should skip iOS entirely
   - Recommendation: Implement with feature detection, accept iOS won't have haptic feedback (this is expected behavior)

2. **Video width: edge-to-edge vs padded**
   - What we know: CONTEXT.md leaves this to Claude's discretion
   - Recommendation: Use edge-to-edge on mobile (w-full) for maximum video real estate, padded on desktop

3. **Progress bar position**
   - What we know: Current position is inline within ModuleHeader
   - Recommendation: Keep current position, just enhance touch targets - moving it would be scope creep

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `VideoEmbed.tsx`, `ArticleEmbed.tsx`, `StageProgressBar.tsx`, `globals.css`
- package.json: Confirmed Tailwind v4, @tailwindcss/typography ^0.5.19
- Tailwind CSS v4 documentation: `aspect-video` utility

### Secondary (MEDIUM confidence)
- MDN Web Docs: `navigator.vibrate()` API reference
- Apple Human Interface Guidelines: 44pt minimum touch target
- WCAG 2.1: Target Size (Level AAA) 44x44 CSS pixels

### Tertiary (LOW confidence)
- Web search results: Code block wrapping patterns, image breakout techniques
- Community patterns: Haptic feedback implementations

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All dependencies already in package.json
- Architecture: HIGH - Patterns verified against existing codebase
- Pitfalls: MEDIUM - Based on research and common mobile issues

**Research date:** 2026-01-22
**Valid until:** 2026-02-22 (30 days - stable patterns)
