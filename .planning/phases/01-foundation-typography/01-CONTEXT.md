# Phase 1: Foundation & Typography - Context

**Gathered:** 2026-01-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Mobile viewport renders correctly without bugs — no iOS Safari quirks, readable text, safe areas respected. This phase establishes the foundational CSS and viewport configuration that all subsequent mobile work builds upon.

</domain>

<decisions>
## Implementation Decisions

### Typography scale
- Use distinct mobile scale (not proportional) — H1 shrinks more than H3, creating tighter hierarchy on mobile
- Minimum body text size: 14px
- Keep current font families — only adjust sizes and spacing for mobile
- Font weights and letter-spacing unchanged

### Safe area treatment
- Universal safe-area padding at top (notch/Dynamic Island area)
- Bottom safe area: only for fixed elements (buttons, inputs) — scrollable content can flow behind home indicator
- Lock orientation to portrait — no landscape support
- Use modern env(safe-area-inset-*) only — no constant() fallback for older iOS

### Viewport behavior
- Use dvh (dynamic viewport height) everywhere — content adapts as iOS Safari chrome shows/hides
- Disable double-tap zoom with touch-action: manipulation — faster tap response

### Mobile blocker removal
- Remove MobileWarning component completely — delete component and all references
- Keep mobile detection hooks for conditional UI rendering (not just blocking)
- Use Tailwind's default sm: breakpoint (640px) for mobile/desktop threshold

### Claude's Discretion
- Line height adjustments for mobile readability
- Viewport meta tag configuration (likely viewport-fit=cover for safe areas)
- Mobile detection approach (screen width vs. device type)
- Specific heading size values per level

</decisions>

<specifics>
## Specific Ideas

No specific product references — open to standard responsive approaches that follow the decisions above.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-foundation-typography*
*Context gathered: 2026-01-21*
