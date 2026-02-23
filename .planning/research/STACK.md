# Technology Stack: Prompt Lab Evaluation Workbench

**Project:** Prompt Lab
**Researched:** 2026-02-20

## Recommended Stack

No new backend dependencies required. Two small frontend additions recommended.

### Core Framework (Existing - No Changes)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| FastAPI | current | API server | Already running, SSE streaming pattern exists in `module.py` |
| LiteLLM | current | LLM abstraction | `stream_chat()` and `complete()` already wrap Claude/Gemini calls |
| SQLAlchemy | current | DB access | Only for auth queries (facilitator check); Prompt Lab has no tables |
| React 19 | current | Frontend UI | Existing component patterns, hooks for SSE consumption |
| Vike v0.4 | current | Page routing | File-based routing for new `/promptlab` page |
| Tailwind CSS v4 | current | Styling | CSS-first config already in place |

### Frontend Additions

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `@uiw/react-codemirror` | ^4.25 | Prompt text editing | Line numbers, undo history, search. System prompts are 20-100+ lines; plain `<textarea>` lacks these features. Peer dep `react >= 17.0.0` covers React 19. |
| `@codemirror/lang-markdown` | ^6.5 | Markdown-aware editing | System prompts contain markdown. Provides heading/list/emphasis highlighting. |
| `diff` (jsdiff) | ^8.0 | Text diffing for response comparison | Compare original vs regenerated responses. Ships with TypeScript types since v8. |

**Bundle size impact:** ~50KB gzipped total (CodeMirror ~40KB, jsdiff ~8KB). Only loads on facilitator-only `/promptlab` page -- never affects student experience.

### Backend Libraries (Existing - No Changes)

| Library | Purpose | Prompt Lab Usage |
|---------|---------|-----------------|
| `litellm.acompletion` | LLM API calls | Chat eval (streaming) and assessment eval (non-streaming) |
| `pydantic` | Request/response validation | API request models for regeneration and scoring |
| `json` (stdlib) | Fixture loading | Read JSON fixture files from `fixtures/` directory |
| `pathlib` (stdlib) | File paths | Locate fixture directory relative to project root |

### Frontend Libraries (Existing - No Changes)

| Library | Purpose | Prompt Lab Usage |
|---------|---------|-----------------|
| `react-markdown` + `remark-gfm` | Markdown rendering | Display AI responses (same as existing chat) |
| `lucide-react` | Icons | UI chrome (tabs, buttons) |
| `fetchWithRefresh` (custom) | Authenticated fetch | API calls with JWT refresh |

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Prompt editor | `@uiw/react-codemirror` | Plain `<textarea>` | No line numbers, weak undo, poor UX for 50+ line prompts |
| Prompt editor | `@uiw/react-codemirror` | Monaco Editor | ~2MB bundle. IDE features not needed for prose. |
| Text diffing | `diff` (jsdiff) | `diff-match-patch` | Simpler API, better TS types, operational transform not needed |
| Diff display | Custom with jsdiff + Tailwind | `react-diff-viewer-continued` | Does NOT support React 19 (peer deps stop at ^18) |
| Fixture format | JSON files in repo | YAML files | Codebase is all-JSON; no YAML parser currently |
| Fixture storage | Repo filesystem | Database table | Fixtures are authored test data, version-controlled, not user data |
| State management | React `useState` | Zustand/Redux | Single-page tool, no shared global state needed |
| Streaming | SSE (existing) | WebSocket | Unidirectional streaming; SSE already works |
| LLM calls | LiteLLM (existing) | Direct Anthropic SDK | LiteLLM already abstracts providers |

## Code to Port from ws3

The only code that needs to move between workspaces:

| File | What | When Needed |
|------|------|-------------|
| `core/modules/llm.py:complete()` | Non-streaming LLM completion function (~15 lines) | Phase 2 (assessment eval) |
| `core/scoring.py:SCORE_SCHEMA` | JSON schema for structured scoring output (~30 lines) | Phase 2 (assessment eval) |

Both are self-contained with no additional dependencies beyond `litellm.acompletion`.

## Installation

```bash
# Frontend (from web_frontend/)
npm install @uiw/react-codemirror @codemirror/lang-markdown @codemirror/state @codemirror/view diff

# Backend: no changes to requirements.txt
```

## Sources

- `@uiw/react-codemirror` GitHub: peer dep `react >= 17.0.0` (React 19 compatible)
- `react-diff-viewer-continued` package.json: peer dep `react ^15 || ^16 || ^17 || ^18` (NO React 19)
- `diff` (jsdiff) npm: v8.0.3, built-in TypeScript types since v8
- Existing codebase: `web_api/routes/module.py`, `core/modules/llm.py`, `core/modules/chat.py`
