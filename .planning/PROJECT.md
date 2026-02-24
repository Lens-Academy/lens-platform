# AI Safety Course Platform

## What This Is

Web platform for an AI Safety education course. Students read articles, watch videos, and discuss concepts with an AI tutor through interactive modules. The platform supports learning outcome measurement through answer boxes and test sections with AI-powered assessment.

## Core Value

Students can engage with course content and demonstrate understanding — through reading, discussion, and assessment — while the platform collects data to improve both teaching and measurement.

## Current Milestone: v3.1 AI Roleplay

**Goal:** Add roleplay content type where students practice AI safety conversations with AI characters, supporting text and voice input, with optional AI assessment.

**Target features:**
- Roleplay segment type: multi-turn conversation with AI-played characters (e.g., skeptical tech CEO)
- Characters defined in content markdown via `instructions::` (same pattern as chat stages)
- Works as standalone segment in any section AND inside test sections (same as question segments)
- Voice input support (reusing existing mic/speech-to-text infrastructure)
- Optional AI assessment when course creators include `assessment_instructions`
- Configurable end-of-conversation trigger (message count, time, or AI-monitored)

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
- ✓ Prompt Lab chat evaluation workflow — v3.0

### Active

(See REQUIREMENTS.md for v3.1 scoped requirements)

### Out of Scope

- Native mobile app — web-first, mobile browser is sufficient
- Offline support — requires significant architecture changes
- Push notifications — would require native capabilities
- TTS for AI roleplay responses — text output for now, add voice later if needed
- Automated conversation quality metrics — qualitative human review first

## Context

The platform has an existing content system where course modules are defined in markdown with different section types (page, lens-article, lens-video) and segment types within them (article, video, chat, question). The roleplay feature adds a new segment type that follows the same patterns.

Existing voice infrastructure: AnswerBox already supports voice recording via `getUserMedia` with secure context guard, speech-to-text transcription, and 2.5s auto-save debounce. The chat system uses `stream_chat()` with SSE streaming for AI responses.

Assessment scoring exists: `assessment_instructions` trigger AI scoring with structured output (score + chain-of-thought + dimensions) via `core/scoring.py`. Question segments can appear standalone or in test sections.

Conversation data lives in `chat_sessions` table (JSONB messages array). Assessment responses and scores live in `assessment_responses` and `assessment_scores` tables.

## Constraints

- **Stack**: Must use existing React 19 + Vike + Tailwind CSS frontend and FastAPI backend
- **Content system**: Roleplay must integrate as a segment type in existing markdown content system
- **LLM**: Use existing LiteLLM integration — no new providers
- **Voice**: Reuse existing mic/speech-to-text infrastructure from AnswerBox
- **Assessment**: Follow existing `assessment_instructions` pattern from question segments

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Tailwind responsive utilities | Already in stack, well-documented patterns | ✓ Good |
| Mobile-first approach | Easier to scale up than down | ✓ Good |
| Fixtures in repo, not DB | Version-controlled, stable, curated, accessible to Claude Code | ✓ Good |
| Roleplay as segment type (not stage) | Follows question pattern — can be standalone or in tests | — Pending |
| Voice-in/text-out for AI responses | TTS is expensive, text output sufficient for v1 | — Pending |

---
*Last updated: 2026-02-24 after v3.1 milestone start*
