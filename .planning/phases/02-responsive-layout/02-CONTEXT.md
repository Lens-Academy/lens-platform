# Phase 2: Responsive Layout - Context

**Gathered:** 2026-01-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Navigation and layout structure adaptation for mobile — header collapses to hamburger, drawers work as overlays, all touch targets are accessible. This phase does NOT include content component styling (Phase 3) or chat interface work (Phase 4).

</domain>

<decisions>
## Implementation Decisions

### Header behavior
- Hide-on-scroll with ~100px threshold (not immediate)
- Header slides smoothly back into view when scrolling up
- Hide-on-scroll applies to all scrollable pages, not just lessons

### Drawer mechanics
- Both ModuleDrawer and CourseSidebar open as side-slide covering ~80% of screen width
- Three dismissal methods: tap backdrop, swipe back to edge, and explicit X button
- Backdrop darkens behind drawer when open

### Touch targets
- 44px minimum for primary actions (buttons, main nav links)
- Dense navigation lists (lesson sidebar items) can be smaller but must scroll smoothly
- All tappable elements show visible touch feedback on press

### Breakpoint strategy
- Three breakpoints: mobile (<768px), tablet (768-1024px), desktop (>1024px)
- Tablet gets hybrid layout: some desktop elements adapted for touch
- Sidebars visible by default on tablet landscape, collapsible

### Claude's Discretion
- Hamburger icon placement (left vs right based on existing header layout)
- Which edge each drawer slides from (based on drawer purpose)
- Touch feedback style per element type (opacity, scale, or background)
- Whether tablet shows hamburger or full nav (based on available space)

</decisions>

<specifics>
## Specific Ideas

No specific product references — open to standard patterns for mobile navigation.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-responsive-layout*
*Context gathered: 2026-01-21*
