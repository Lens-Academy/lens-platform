# Requirements: Mobile Responsiveness

**Defined:** 2026-01-21
**Core Value:** Students can consume course content on mobile — lessons, chatbot, videos all work on phone screens.

## v1 Requirements

Requirements for mobile-responsive release. Each maps to roadmap phases.

### Foundation

- [ ] **FOUND-01**: Remove MobileWarning blocker component so mobile users can access the app
- [ ] **FOUND-02**: Configure dynamic viewport units (dvh) to handle iOS Safari address bar
- [ ] **FOUND-03**: Set 16px minimum font size for mobile readability
- [ ] **FOUND-04**: Add safe area insets for notched devices (iPhone, etc.)

### Navigation

- [x] **NAV-01**: Header collapses to hamburger menu on mobile screens
- [x] **NAV-02**: All navigation links have 44px minimum touch targets
- [x] **NAV-03**: Header hides on scroll down, reappears on scroll up
- [x] **NAV-04**: Bottom navigation bar for primary actions on mobile

### Layout Components

- [x] **LAYOUT-01**: ModuleDrawer displays as full-screen overlay on mobile
- [x] **LAYOUT-02**: ModuleHeader stacks vertically on mobile with responsive widths
- [x] **LAYOUT-03**: CourseSidebar becomes slide-out drawer on mobile

### Content Components

- [ ] **CONTENT-01**: ArticleEmbed uses responsive padding (less on mobile)
- [ ] **CONTENT-02**: VideoEmbed scales to full width on mobile
- [ ] **CONTENT-03**: VideoPlayer controls are touch-friendly (44px minimum)

### Chat Interface

- [ ] **CHAT-01**: NarrativeChatSection uses responsive height (dvh units)
- [ ] **CHAT-02**: Chat input stays visible when mobile keyboard opens
- [ ] **CHAT-03**: Send and microphone buttons are 44px minimum touch targets
- [ ] **CHAT-04**: Swipe gestures navigate through chat history

### Progress & Stage Navigation

- [ ] **PROG-01**: StageProgressBar dots and arrows are 44px touch targets
- [ ] **PROG-02**: Module stage navigation works correctly on touch devices

### Motion & Transitions

- [ ] **MOTION-01**: Drawers and overlays slide in/out with physical weight (300ms ease-out, slight overshoot)
- [ ] **MOTION-02**: Page transitions feel connected — content slides rather than cuts
- [ ] **MOTION-03**: Interactive elements respond to touch with immediate feedback (scale/opacity on press)
- [ ] **MOTION-04**: Staggered reveals when loading content lists (chat messages, module stages)

### Typography & Reading

- [ ] **TYPE-01**: Body text optimized for mobile reading — 18px base, 1.6 line height, comfortable measure
- [ ] **TYPE-02**: Heading hierarchy scales appropriately on mobile (not just smaller desktop)
- [ ] **TYPE-03**: Chat messages have distinct, readable typography with proper bubble spacing

### Visual Consistency

- [ ] **VISUAL-01**: Mobile layouts maintain desktop's visual language — same colors, spacing rhythm, component shapes
- [ ] **VISUAL-02**: Consistent touch feedback patterns across all interactive elements
- [ ] **VISUAL-03**: Loading states match desktop aesthetic (skeleton screens, spinners)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Native-Feel Enhancements

- **NATIVE-01**: Pull-to-refresh on content pages
- **NATIVE-02**: Haptic feedback on key interactions
- **NATIVE-03**: Offline content caching for lessons
- **NATIVE-04**: Add to home screen (PWA) support

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Native mobile app | Web-first approach; mobile browser is sufficient for v1 |
| Facilitator dashboard on mobile | Admin tasks stay desktop-focused per PROJECT.md |
| Offline support | Requires significant architecture changes |
| Push notifications | Would require native capabilities |
| Tablet-specific layouts | Will work but not optimized; phones are priority |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 1 | Complete |
| FOUND-02 | Phase 1 | Complete |
| FOUND-03 | Phase 1 | Complete |
| FOUND-04 | Phase 1 | Complete |
| TYPE-01 | Phase 1 | Complete |
| TYPE-02 | Phase 1 | Complete |
| NAV-01 | Phase 2 | Complete |
| NAV-02 | Phase 2 | Complete |
| NAV-03 | Phase 2 | Complete |
| NAV-04 | Phase 2 | Complete |
| LAYOUT-01 | Phase 2 | Complete |
| LAYOUT-02 | Phase 2 | Complete |
| LAYOUT-03 | Phase 2 | Complete |
| CONTENT-01 | Phase 3 | Pending |
| CONTENT-02 | Phase 3 | Pending |
| CONTENT-03 | Phase 3 | Pending |
| PROG-01 | Phase 3 | Pending |
| PROG-02 | Phase 3 | Pending |
| CHAT-01 | Phase 4 | Pending |
| CHAT-02 | Phase 4 | Pending |
| CHAT-03 | Phase 4 | Pending |
| CHAT-04 | Phase 4 | Pending |
| TYPE-03 | Phase 4 | Pending |
| MOTION-01 | Phase 5 | Pending |
| MOTION-02 | Phase 5 | Pending |
| MOTION-03 | Phase 5 | Pending |
| MOTION-04 | Phase 5 | Pending |
| VISUAL-01 | Phase 5 | Pending |
| VISUAL-02 | Phase 5 | Pending |
| VISUAL-03 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 30 total
- Mapped to phases: 30
- Unmapped: 0

**Phase Distribution:**
| Phase | Count | Requirements |
|-------|-------|--------------|
| Phase 1 | 6 | FOUND-01..04, TYPE-01..02 |
| Phase 2 | 7 | NAV-01..04, LAYOUT-01..03 |
| Phase 3 | 5 | CONTENT-01..03, PROG-01..02 |
| Phase 4 | 5 | CHAT-01..04, TYPE-03 |
| Phase 5 | 7 | MOTION-01..04, VISUAL-01..03 |

---
*Requirements defined: 2026-01-21*
*Last updated: 2026-01-21 after roadmap creation*
