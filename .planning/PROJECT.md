# AI Safety Course Platform

## What This Is

Web platform for an AI Safety education course. Students read articles, watch videos, and discuss concepts with an AI tutor through interactive modules. The platform supports learning outcome measurement through answer boxes and test sections with AI-powered assessment.

## Core Value

Students can engage with course content and demonstrate understanding — through reading, discussion, and assessment — while the platform collects data to improve both teaching and measurement.

## Current Milestone: v3.0 Prompt Lab

**Goal:** Build a facilitator-only evaluation workbench for iterating on AI tutor system prompts and assessment scoring prompts using real student data.

**Target features:**
- Curated conversation/answer fixtures extracted from production data (stored in repo)
- Chat tutor evaluation: replay real conversations with editable system prompts, regenerate AI responses at any point, interactively continue as the student
- Assessment evaluation: run AI scoring on student answers with editable scoring prompts, review chain-of-thought reasoning, compare against human ground-truth scores
- Web UI in the platform (facilitator auth) with SSE streaming for regenerated responses
- Architecture extensible for future evaluation types

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

(See REQUIREMENTS.md for v3.0 scoped requirements)

### Out of Scope

- Native mobile app — web-first, mobile browser is sufficient
- Facilitator dashboard on mobile — admin tasks stay desktop
- Offline support — requires significant architecture changes
- Push notifications — would require native capabilities
- Automated prompt optimization — humans review and decide, no auto-tuning
- Batch evaluation with metrics/dashboards — start with manual review, add metrics later
- Side-by-side comparison UI — useful but not needed for first iteration
- LLM-as-judge automated scoring — humans judge quality for now

## Context

The AI tutor uses a two-level prompt: a hardcoded base system prompt in `core/modules/chat.py` plus per-chat-stage `instructions::` from content markdown. The assessment system (being built in ws3/v2.0) adds scoring prompts with socratic vs assessment modes and structured output (score + chain-of-thought + dimensions). Both prompt types need iterative human evaluation to improve quality.

Current conversation data lives in the `chat_sessions` table (JSONB messages array). Assessment responses and scores live in `assessment_responses` and `assessment_scores` tables.

## Constraints

- **Stack**: Must use existing React 19 + Vike + Tailwind CSS frontend and FastAPI backend
- **Auth**: Facilitator role required — uses existing Discord OAuth + role system
- **LLM**: Use existing LiteLLM integration — no new providers
- **Data**: Fixtures stored as JSON in repo, not in database
- **Production safety**: Prompt Lab never modifies production prompts — it's a read-only playground

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Tailwind responsive utilities | Already in stack, well-documented patterns | ✓ Good |
| Mobile-first approach | Easier to scale up than down | ✓ Good |
| Fixtures in repo, not DB | Version-controlled, stable, curated, accessible to Claude Code | — Pending |
| Prompt Lab in platform (not standalone) | Reuses auth, components, styling; content lives there | — Pending |
| Manual extraction via Claude Code | Small dataset (5-15), curation needed, no UI overhead | — Pending |

---
*Last updated: 2026-02-20 after v3.0 milestone start*
