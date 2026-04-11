# Phase 3: Content Components - Context

**Gathered:** 2026-01-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Lesson content displays optimally on mobile — videos fill width, articles have comfortable reading margins, progress navigation is touch-friendly. This covers video embeds, article typography, progress navigation dots/arrows, and content card styling.

</domain>

<decisions>
## Implementation Decisions

### Video embed behavior
- Video width: Claude's discretion (edge-to-edge vs padded)
- Use native YouTube controls — no custom fullscreen-on-tap behavior
- Aspect ratio: Claude's discretion (likely 16:9 standard)
- No custom loading state — let YouTube handle its own loading

### Article typography & spacing
- Horizontal padding: Claude's discretion based on readability
- Code blocks: wrap lines to fit screen (no horizontal scroll)
- Images: full-width edge-to-edge on mobile (break out of text margins)
- Blockquotes and callouts: visually distinct with background color, left border, indentation

### Progress navigation
- Keep existing icon-based dots (article/video/chat icons)
- Larger prev/next arrows on mobile for better touch targets
- Add subtle haptic feedback when tapping progress dots (navigator.vibrate)
- Position: Claude's discretion based on layout flow

### Content card styling
- Cards have subtle rounded edges with slight margin (not full-bleed)
- Subtle shadows for depth and elevation
- Current/active card has background tint to distinguish from others
- Section dividers: Claude's discretion based on content density

### Claude's Discretion
- Video width approach (edge-to-edge vs within margins)
- Aspect ratio handling (fixed 16:9 vs responsive)
- Article horizontal padding amount
- Progress bar position (top vs bottom vs floating)
- Section divider style (line vs spacing vs cards)

</decisions>

<specifics>
## Specific Ideas

- Code blocks should wrap rather than scroll — mobile scrolling in both directions is frustrating
- Images breaking out of margins creates visual rhythm and impact
- Haptic feedback on progress dots provides tactile confirmation (subtle vibration)
- Active card background tint helps users track where they are in multi-section content

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-content-components*
*Context gathered: 2026-01-22*
