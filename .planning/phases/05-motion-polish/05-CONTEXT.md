# Phase 5: Motion & Polish - Context

**Gathered:** 2026-01-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Mobile experience feels polished — smooth animations, consistent visual language, verified on real devices. This phase adds motion and polish to the mobile-responsive foundation built in Phases 1-4.

</domain>

<decisions>
## Implementation Decisions

### Drawer Animations
- Spring/bounce easing on open — slight overshoot and settle for iOS-like playful feel
- Medium duration (300-350ms) — balanced, noticeable but not slow
- Backdrop fades in first, then drawer slides — layered, cinematic choreography
- Close animation mirrors open (bounce out) — consistent, symmetrical feel

### Touch Feedback
- Press state: scale down (95-98%) + color shift — both effects together for maximum tactile feedback
- Interactive cards scale down on press — entire card shrinks to feel tappable
- Response time: near-instant (50ms) — tiny delay smooths accidental touches while feeling immediate
- Navigation items (bottom nav, menu) get same feedback as buttons — consistent across all tappables

### Loading States
- Skeleton screens for content areas (lesson content, module lists) — shows structure, feels faster
- Subtle pulse animation on skeletons — gentle opacity fade, alive but not distracting
- Dots animation for inline loading (chat messages) — familiar, chat-native feel
- Content reveal: fade + slide up — content rises into place for dynamic entrance

### Page Transitions
- View Transitions API with shared element morphing — browser-native, smooth navigation
- All matchable elements morph between pages — any element with same ID animates to new position
- Directional transitions: forward slides left, back slides right — spatial metaphor for navigation
- Smart preloading with wait fallback — preload pages, wait for content before transitioning (no skeleton mid-transition)

### Claude's Discretion
- Exact spring tension/damping values for drawer bounce
- Which specific elements get view-transition-name attributes
- Preloading strategy implementation details
- Skeleton screen exact dimensions and shapes

</decisions>

<specifics>
## Specific Ideas

- "Should feel really smooth" — View Transitions with preloading prioritized over raw speed
- Headings should morph smoothly to new page when elements match
- Cinematic feel: backdrop leads drawer, content rises into place

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-motion-polish*
*Context gathered: 2026-01-22*
