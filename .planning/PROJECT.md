# AI Safety Course Platform

## What This Is

Web platform for an AI Safety education course. Students read articles, watch videos, and discuss concepts with an AI tutor through interactive modules. The platform supports learning outcome measurement through answer boxes and test sections with AI-powered assessment.

## Core Value

Students can engage with course content and demonstrate understanding — through reading, discussion, and assessment — while the platform collects data to improve both teaching and measurement.

## Current Milestone: v2.0 Tests & Answer Boxes

**Goal:** Add answer boxes and test sections to the module viewer so the platform can measure learning outcomes and start collecting assessment data.

**Target features:**
- Free-text answer box as a general-purpose input type (usable in lessons and tests)
- Test sections that group assessment questions at the end of modules
- AI-powered assessment scoring (stored internally, not shown to users initially)
- Voice-only input enforcement per question (with skip/override option)
- Content hiding during assessment (block access to previous pages)
- Data storage for responses, scores, and learning outcome measurements

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

(See REQUIREMENTS.md for v2.0 scoped requirements)

### Out of Scope

- Native mobile app — web-first, mobile browser is sufficient
- Facilitator dashboard on mobile — admin tasks stay desktop
- Offline support — requires significant architecture changes
- Push notifications — would require native capabilities
- Tablet-specific layouts — works but not optimized; phones are priority
- Showing scores to users — grades will be inaccurate until AI assessor prompting is iterated
- Multiple choice / structured question types — free-text only for now
- Certificate generation — depends on reliable scoring, future milestone

## Context

**Content structure (Obsidian vault via Lens Relay):**
- Course → Modules → Learning Outcomes → Lenses (teaching content)
- Each Learning Outcome has a `## Test:` section in the template (currently always empty)
- A Lens contains: article/video + intro text + AI chat discussion
- Tests are designed to sit at the end of modules, with time gap between study and assessment

**Two content models in codebase:**
- Flat stages: `ArticleStage | VideoStage | ChatStage` (legacy)
- Narrative sections: `NarrativeSection` → `NarrativeSegment` (text, article-excerpt, video-excerpt, chat)

**Assessment design principles:**
- Socratic feedback (helping learn) vs assessment (measuring learning) are distinct modes
- Both should be supported as options per question
- AI scoring is for internal data collection — improving course material and eventually grading certificates

## Constraints

- **Stack**: React 19 + Vike + Tailwind CSS 4, Python FastAPI backend
- **Content format**: Must work with existing Obsidian/Lens Relay content authoring
- **LLM**: Use existing LiteLLM integration for AI assessment
- **Data privacy**: Assessment scores stored but not exposed to students initially
- **Accessibility**: Voice input enforcement must have escape hatch (skip/text fallback)

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
| Free-text answer box only (no MC) | Simpler to build, richer signal for AI assessment | — Pending |
| Scores hidden from users | Scoring accuracy needs iteration before exposure | — Pending |
| Tests at end of module | Time gap between study and test improves measurement | — Pending |

---
*Last updated: 2026-02-14 after v2.0 milestone start*
