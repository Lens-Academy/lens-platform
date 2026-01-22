# Roadmap: Mobile Responsiveness

## Overview

This roadmap transforms the AI Safety Course Platform from desktop-only to fully mobile-responsive, enabling students to consume lessons, interact with the chatbot, and watch embedded videos on their phones. The 5-phase approach starts with foundational viewport and typography fixes, progresses through layout and content component adaptations, tackles the complex chat interface, and concludes with motion polish and visual consistency.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation & Typography** - Viewport units, safe areas, and mobile typography baseline
- [x] **Phase 2: Responsive Layout** - Navigation collapse, drawer overlays, and layout structure
- [x] **Phase 3: Content Components** - Video embeds, article padding, and progress navigation
- [x] **Phase 4: Chat Interface** - Mobile chat with keyboard handling and touch gestures
- [x] **Phase 5: Motion & Polish** - Animations, visual consistency, and final testing

## Phase Details

### Phase 1: Foundation & Typography
**Goal**: Mobile viewport renders correctly without bugs — no iOS Safari quirks, readable text, safe areas respected
**Depends on**: Nothing (first phase)
**Requirements**: FOUND-01, FOUND-02, FOUND-03, FOUND-04, TYPE-01, TYPE-02
**Success Criteria** (what must be TRUE):
  1. Student can open any page on iPhone without seeing the MobileWarning blocker
  2. Full-height elements (like chat container) fill the visible viewport without content hiding behind iOS Safari address bar
  3. Student can read lesson body text on iPhone SE (320px) without zooming or horizontal scrolling
  4. Content does not overlap with iPhone notch or Dynamic Island on any page
  5. Heading sizes are proportionally smaller on mobile while maintaining clear hierarchy
**Plans**: 2 plans (Wave 1 parallel)

Plans:
- [x] 01-01-PLAN.md — Remove mobile blocker and configure viewport foundations
- [x] 01-02-PLAN.md — Migrate viewport height units to dvh

### Phase 2: Responsive Layout
**Goal**: Students can navigate the app on mobile — header collapses to hamburger, drawers work as overlays, all touch targets are accessible
**Depends on**: Phase 1
**Requirements**: NAV-01, NAV-02, NAV-03, NAV-04, LAYOUT-01, LAYOUT-02, LAYOUT-03
**Success Criteria** (what must be TRUE):
  1. Student sees hamburger menu icon on mobile header and can tap to open navigation
  2. Tapping any navigation link or button registers on first tap (44px touch targets)
  3. Header hides when student scrolls down through lesson content, reappears when scrolling up
  4. ModuleDrawer opens as full-screen overlay on mobile (not partial slide-out)
  5. CourseSidebar slides in from edge as drawer on mobile, dismissible by tap outside
**Plans**: 3 plans (Wave 1: 01, 02 parallel; Wave 2: 03)

Plans:
- [x] 02-01-PLAN.md — Navigation foundation: useScrollDirection hook, MobileMenu, Layout/LandingNav mobile headers
- [x] 02-02-PLAN.md — Drawer components: ModuleDrawer 80% mobile width, CourseSidebar as mobile drawer
- [x] 02-03-PLAN.md — ModuleHeader mobile, BottomNav, touch target enforcement

### Phase 3: Content Components
**Goal**: Lesson content displays optimally on mobile — videos fill width, articles have comfortable reading margins, progress navigation is touch-friendly
**Depends on**: Phase 1
**Requirements**: CONTENT-01, CONTENT-02, CONTENT-03, PROG-01, PROG-02
**Success Criteria** (what must be TRUE):
  1. Embedded YouTube videos scale to full screen width on mobile with correct aspect ratio
  2. Video player controls (play, pause, fullscreen) are easily tappable on mobile
  3. Article content has appropriate padding on mobile (not cramped to edges, not excessive margins)
  4. Stage progress bar dots and arrows are easily tappable (44px touch targets)
  5. Tapping stage progress dots advances to the correct stage without mis-taps
**Plans**: 2 plans (Wave 1 parallel)

Plans:
- [x] 03-01-PLAN.md — Content display: VideoEmbed responsive container, ArticleEmbed mobile padding and typography
- [x] 03-02-PLAN.md — Progress navigation: haptics utility, StageProgressBar 44px touch targets

### Phase 4: Chat Interface
**Goal**: Students can use the AI chatbot on mobile — input visible above keyboard, messages readable, touch interactions smooth
**Depends on**: Phase 1, Phase 2
**Requirements**: CHAT-01, CHAT-02, CHAT-03, TYPE-03 (CHAT-04 removed per CONTEXT.md)
**Success Criteria** (what must be TRUE):
  1. Chat container uses full available height on mobile without content hiding behind browser chrome
  2. Chat input field remains visible above keyboard when typing on iOS Safari
  3. Send and microphone buttons are easily tappable (44px minimum)
  4. Chat message bubbles have readable typography with proper spacing between messages
**Plans**: 2 plans (Wave 1: 01; Wave 2: 02)

Plans:
- [x] 04-01-PLAN.md — Chat container dvh, scrollIntoView keyboard handling, message spacing
- [x] 04-02-PLAN.md — 44px touch targets for send/mic buttons, haptic feedback on send

### Phase 5: Motion & Polish
**Goal**: Mobile experience feels polished — smooth animations, consistent visual language, verified on real devices
**Depends on**: Phase 2, Phase 3, Phase 4
**Requirements**: MOTION-01, MOTION-02, MOTION-03, MOTION-04, VISUAL-01, VISUAL-02, VISUAL-03
**Success Criteria** (what must be TRUE):
  1. Drawers and overlays animate smoothly when opening/closing (no jarring cuts or lag)
  2. Page transitions feel connected — content slides rather than instant cuts
  3. Buttons and interactive elements respond immediately to touch (visual feedback on press)
  4. Mobile layouts maintain the same visual language as desktop (colors, spacing rhythm, component shapes)
  5. Loading states (skeleton screens, spinners) display correctly on mobile
**Plans**: 4 plans (Wave 1: 01, 02; Wave 2: 03, 04 gap closure)

Plans:
- [x] 05-01-PLAN.md — Animation system: spring easing, drawer animations, touch feedback
- [x] 05-02-PLAN.md — Page transitions (View Transitions API) and skeleton loading states
- [x] 05-03-PLAN.md — Gap closure: touch feedback completion for chat, progress, completion buttons
- [x] 05-04-PLAN.md — Gap closure: skeleton loading states and stagger animation usage

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5
Note: Phases 2 and 3 can run in parallel after Phase 1 completes.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Typography | 2/2 | Complete | 2026-01-21 |
| 2. Responsive Layout | 3/3 | Complete | 2026-01-22 |
| 3. Content Components | 2/2 | Complete | 2026-01-22 |
| 4. Chat Interface | 2/2 | Complete | 2026-01-22 |
| 5. Motion & Polish | 4/4 | Complete | 2026-01-22 |
