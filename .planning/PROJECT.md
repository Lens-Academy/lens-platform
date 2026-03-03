# AI Safety Course Platform

## What This Is

Web platform for an AI Safety education course. Students read articles, watch videos, discuss concepts with an AI tutor, and practice AI safety conversations with AI characters through roleplay exercises. The platform supports learning outcome measurement through answer boxes, test sections, and AI-powered assessment of both written responses and roleplay transcripts.

## Core Value

Students can engage with course content and demonstrate understanding — through reading, discussion, roleplay, and assessment — while the platform collects data to improve both teaching and measurement.

## Requirements

### Validated

- ✓ Discord OAuth authentication — existing
- ✓ Course and module browsing — existing
- ✓ Lesson content (article segments) — existing
- ✓ AI chatbot interaction (chat segments) — existing
- ✓ Embedded YouTube videos (video segments) — existing
- ✓ Session progress persistence — existing
- ✓ Multi-section module navigation — existing
- ✓ Mobile-responsive lesson content layout — v1.0
- ✓ Mobile-responsive chatbot interface — v1.0
- ✓ Mobile-responsive video player embedding — v1.0
- ✓ Mobile-responsive navigation — v1.0
- ✓ Mobile-responsive module header and progress — v1.0
- ✓ Touch-friendly interaction targets (44px minimum) — v1.0
- ✓ Prompt Lab chat evaluation workflow — v3.0
- ✓ Roleplay content parsing (id, content, ai-instructions fields) — v3.1
- ✓ Inworld TTS voice responses for AI characters — v3.1
- ✓ Multi-turn roleplay conversations with character identity — v3.1
- ✓ Text/voice input modes with toggleable TTS — v3.1
- ✓ Roleplay session persistence, completion, retry — v3.1
- ✓ AI assessment of roleplay transcripts — v3.1
- ✓ Roleplay segments in test sections — v3.1
- ✓ Post-roleplay feedback chat with transcript context — v3.1

### Active

(No active requirements — next milestone not yet defined)

### Out of Scope

- Native mobile app — web-first, mobile browser is sufficient
- Offline support — requires significant architecture changes
- Push notifications — would require native capabilities
- Automated conversation quality metrics — qualitative human review first
- Multiple AI characters in one conversation — order-of-magnitude complexity
- Branching narrative trees — LLM-driven conversation is superior
- Score card UI for roleplay assessment — feedback chat provides assessment context instead

## Context

Shipped v3.1 with ~57,800 LOC Python and ~45,200 LOC TypeScript.
Tech stack: React 19 + Vike + Tailwind CSS v4, FastAPI, PostgreSQL (Supabase), LiteLLM, Inworld TTS.

Content system: Course modules defined in markdown with section types (page, lens-article, lens-video) containing segment types (article, video, chat, question, roleplay). Roleplay segments define AI characters via `ai-instructions::` field.

Voice infrastructure: AnswerBox voice recording (getUserMedia, STT), roleplay voice input (push-to-talk), Inworld TTS for AI character voice responses via WebSocket streaming.

Assessment: `assessment_instructions` trigger AI scoring for both question and roleplay segments. Roleplay assessment uses background scoring with transcript formatting. Feedback chat gets full context server-side (scenario, rubric, transcript).

Database: `chat_sessions` with session isolation via `roleplay_id` partial unique indexes. `roleplay_assessments` for scoring results. Alembic migrations.

## Constraints

- **Stack**: React 19 + Vike + Tailwind CSS frontend, FastAPI backend
- **Content system**: All content types are segment types in markdown
- **LLM**: LiteLLM integration — no new providers
- **Voice**: Inworld TTS for AI responses, browser STT for student input
- **Assessment**: `assessment_instructions` pattern shared by questions and roleplays

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Tailwind responsive utilities | Already in stack, well-documented patterns | ✓ Good |
| Mobile-first approach | Easier to scale up than down | ✓ Good |
| Fixtures in repo, not DB | Version-controlled, stable, curated, accessible to Claude Code | ✓ Good |
| Roleplay as segment type | Follows question pattern — standalone or in tests | ✓ Good |
| Inworld TTS for AI voice | WebSocket streaming, sentence buffering, gapless playback | ✓ Good |
| Manual completion button only | No auto-triggers (message count, time, AI-monitored) — simpler, predictable | ✓ Good |
| Separate partial indexes for session isolation | Clean NULL/NOT NULL discrimination, no COALESCE hacks | ✓ Good |
| roleplay.py separate from chat.py | Fundamentally different prompt framing (character vs tutor) | ✓ Good |
| Feedback chat over score card | Server-side context injection gives AI tutor full transcript + rubric | ✓ Good |
| Buffered TTS (not streaming) | Full text after LLM done — simpler, acceptable latency | ✓ Good |

---
*Last updated: 2026-03-03 after v3.1 milestone*
