# AI Safety Course Platform

## What This Is

Full mobile responsiveness for the AI Safety Course Platform web frontend. Students can complete lessons, interact with the chatbot, and watch embedded videos on their phones in a mobile browser.

## Core Value

Students can consume course content on mobile — lessons, chatbot, videos all work on phone screens.

## Current State (v1.0)

**Shipped:** 2026-01-22

Mobile responsiveness complete across all student-facing views:
- Foundation: 18px typography, dvh viewport units, safe area insets
- Navigation: Hamburger menu, hide-on-scroll header, bottom navigation
- Content: Responsive video embeds, touch-friendly article layout
- Chat: iOS keyboard handling, 44px touch targets, haptic feedback
- Polish: Spring animations, View Transitions, skeleton loading

**Tech Stack:**
- React 19 + Vike
- Tailwind CSS 4 with mobile-first responsive utilities
- 10,507 lines TypeScript/CSS in frontend

## Requirements

### Validated

- ✓ Discord OAuth authentication — existing
- ✓ Course and module browsing — existing
- ✓ Lesson content (article stages) — existing
- ✓ AI chatbot interaction (chat stages) — existing
- ✓ Embedded YouTube videos (video stages) — existing
- ✓ Session progress persistence — existing
- ✓ Multi-stage module navigation — existing
- ✓ Mobile-responsive lesson content layout — v1.0
- ✓ Mobile-responsive chatbot interface — v1.0
- ✓ Mobile-responsive video player embedding — v1.0
- ✓ Mobile-responsive navigation — v1.0
- ✓ Mobile-responsive module header and progress — v1.0
- ✓ Touch-friendly interaction targets (44px minimum) — v1.0

### Active

(None — milestone just shipped. Next milestone to define new requirements.)

### Out of Scope

- Native mobile app — web-first, mobile browser is sufficient
- Facilitator dashboard on mobile — admin tasks stay desktop
- Offline support — requires significant architecture changes
- Push notifications — would require native capabilities
- Tablet-specific layouts — works but not optimized; phones are priority

## Constraints

- **Stack**: Must use existing Tailwind CSS — no new CSS frameworks
- **Scope**: Students only — facilitator views can stay desktop-focused
- **Compatibility**: Modern mobile browsers (Safari iOS, Chrome Android)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Tailwind responsive utilities | Already in stack, well-documented patterns | ✓ Good |
| Mobile-first approach | Easier to scale up than down | ✓ Good |
| 18px body text | Exceeds iOS 16px zoom threshold | ✓ Good |
| dvh units for full-height | iOS Safari address bar compatibility | ✓ Good |
| 44px touch targets | iOS Human Interface Guidelines minimum | ✓ Good |
| CSS linear() for spring easing | Native, no JS library needed | ✓ Good |
| View Transitions API | Modern page transitions with fallback | ✓ Good |
| Skeleton loading states | Consistent loading UX across views | ✓ Good |

---
*Last updated: 2026-01-22 after v1.0 milestone*
