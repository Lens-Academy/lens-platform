# Research Summary: Prompt Lab Evaluation Workbench

**Domain:** Prompt engineering evaluation tool for AI Safety Course Platform
**Researched:** 2026-02-20
**Overall confidence:** HIGH

## Executive Summary

The Prompt Lab is a facilitator-only tool for iterating on two AI systems: (1) the chat tutor that guides students through course modules, and (2) the AI assessment scoring that evaluates student answers. Research focused on how these features integrate with the existing 3-layer architecture (core business logic, web API adapter, React frontend) without disrupting the student-facing learning flow.

The key architectural insight is that the Prompt Lab should NOT extend the existing `chat.py` or `scoring.py` modules. Those modules are tightly coupled to the student flow -- `chat.py` builds prompts from Stage objects with transition tools, `scoring.py` persists scores to the database via background tasks. The Prompt Lab needs a fundamentally different interaction: take a raw custom prompt, call the LLM directly via the existing `stream_chat()` / `complete()` primitives, and return results without persistence. This means a new `core/promptlab/` module that sits alongside the existing modules and shares only the `llm.py` abstraction layer.

The ws3 dependency is real but scoped: only assessment eval needs `complete()` and `SCORE_SCHEMA` from ws3. Chat eval uses only `stream_chat()` which already exists in ws2. This enables a natural two-phase build where chat eval ships independently.

Fixture storage is best handled as JSON files in the repository (not database tables), since fixtures are authored test data that should be version-controlled and reviewed in PRs. The frontend follows existing patterns exactly: Vike page-based routing, facilitator auth guard, SSE streaming for chat, fetchWithRefresh for API calls.

## Key Findings

**Stack:** No new dependencies needed. Reuse existing LiteLLM (`stream_chat`/`complete`), FastAPI SSE streaming, React 19 + Vike routing, Tailwind CSS. The only code that needs to move between workspaces is the `complete()` function from ws3's `llm.py`.

**Architecture:** New `core/promptlab/` module with 3 files (~180 lines total backend), new API route file (~120 lines), new frontend page/views/components (~850 lines total). Zero database migrations. Zero changes to existing modules.

**Critical pitfall:** The biggest risk is accidentally coupling Prompt Lab to the student learning flow. The system prompt builder, chat session persistence, and assessment scoring pipeline must NOT be extended -- they should be bypassed entirely by calling `llm.py` directly.

## Implications for Roadmap

Based on research, suggested phase structure:

1. **Phase 1: Chat Eval** - Build the complete chat evaluation workflow
   - Addresses: Fixture loading, system prompt editing, SSE streaming regeneration, interactive follow-up
   - Avoids: ws3 dependency entirely (uses only `stream_chat()` from ws2)
   - Estimated scope: ~600 lines of new code across backend and frontend

2. **Phase 2: Assessment Eval** - Build assessment scoring evaluation (after ws3 merges)
   - Addresses: Scoring prompt editing, structured output display, ground-truth comparison
   - Avoids: Premature dependency on ws3 by deferring until `complete()` and `SCORE_SCHEMA` are available
   - Estimated scope: ~400 lines of new code across backend and frontend

**Phase ordering rationale:**
- Chat eval has zero ws3 dependencies and is independently useful for tutor prompt iteration
- Assessment eval requires `complete()` (non-streaming LLM call) which only exists in ws3's `llm.py`
- Both phases share fixture infrastructure and the frontend shell, so Phase 1 establishes patterns Phase 2 follows
- No database migrations in either phase, reducing risk and review burden

**Research flags for phases:**
- Phase 1: Standard patterns, no additional research needed. All integration points verified against existing codebase.
- Phase 2: May need phase-specific research on structured output rendering (score dimensions, comparison UI) depending on how complex the ground-truth comparison needs to be. The `SCORE_SCHEMA` from ws3's `scoring.py` defines the data structure.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | No new dependencies; all patterns verified in existing codebase |
| Features | HIGH | Feature landscape verified against Anthropic Console, OpenAI Playground, Langfuse, BrainTrust, Promptfoo |
| Architecture | HIGH | Every integration point traced through actual source code in ws2 and ws3 |
| Pitfalls | HIGH | Pitfalls identified from direct code analysis, not hypothetical concerns |

## Gaps to Address

- **Fixture authoring workflow:** How facilitators create fixtures from real production conversations is not fully specified. Initially manual (copy from facilitator chat panel), but may want an "export as fixture" button later.
- **ws3 merge timing:** Assessment eval Phase 2 cannot start until ws3's `complete()` function and `SCORE_SCHEMA` are available in the working branch. The exact timing depends on ws3's merge schedule.
- **ChatMarkdown extraction:** The `ChatMarkdown` component is currently defined inline in `NarrativeChatSection.tsx`. Extracting it to a shared location is a minor refactor but should be done before Phase 1 frontend work begins.
