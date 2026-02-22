# Phase 6 Research: Chat Evaluation (Prompt Lab)

**Researched:** 2026-02-20
**Overall confidence:** HIGH
**Mode:** Implementation research for a well-scoped internal tool

---

## Executive Summary

Phase 6 builds a facilitator-only "Prompt Lab" -- a two-panel workbench for loading chat conversation fixtures, editing system prompts, regenerating AI tutor responses, and continuing conversations interactively. The codebase already contains every building block needed: SSE streaming via `stream_chat()` in `core/modules/llm.py`, chat bubble rendering via `NarrativeChatSection.tsx`, facilitator auth guards via `get_db_user_or_403()`, and the Vike file-based routing system. The primary work is composing these existing pieces into a new backend module (`core/promptlab/`) and a new frontend page (`/promptlab`).

The chain-of-thought requirement maps to LiteLLM's `thinking` parameter, which is well-supported in the installed version (1.81.11, well above the 1.63.0 minimum). Streaming with thinking enabled requires extending `stream_chat()` or creating a parallel function in `core/promptlab/` that yields thinking blocks alongside text content. The decision to keep Prompt Lab in `core/promptlab/` (not modifying `chat.py` or `llm.py`) is sound -- this module wraps `llm.py`'s `stream_chat()` with Prompt Lab-specific concerns (no DB writes, thinking support, custom system prompts).

No new Python packages are needed. On the frontend, the only potential addition is a monospace text editor component -- a plain `<textarea>` with monospace font is the simplest approach that matches the decision for "no syntax highlighting."

## Stack Analysis

### Backend (Python / FastAPI)

**What exists and can be reused directly:**

| Component | Location | How Prompt Lab Uses It |
|-----------|----------|----------------------|
| `stream_chat()` | `core/modules/llm.py` | Core LLM call -- Prompt Lab calls this with custom system prompt and `thinking` param |
| SSE streaming pattern | `web_api/routes/module.py` lines 48-129 | Copy this `event_generator` + `StreamingResponse` pattern for Prompt Lab endpoint |
| Facilitator auth | `web_api/routes/facilitator.py` `get_db_user_or_403()` | Reuse for Prompt Lab route auth |
| `get_current_user` | `web_api/auth.py` | FastAPI dependency for JWT validation |
| `ChatStage` type | `core/modules/types.py` | Not needed -- Prompt Lab builds its own system prompt directly |
| LiteLLM | `requirements.txt` (v1.81.11) | Already installed, supports `thinking` parameter |

**What needs to be created:**

| Component | Location | Purpose |
|-----------|----------|---------|
| `core/promptlab/__init__.py` | New module | Exports |
| `core/promptlab/fixtures.py` | New | Load/list JSON fixture files from `core/promptlab/fixtures/` |
| `core/promptlab/regenerate.py` | New | Call `stream_chat()` with custom system prompt, thinking enabled, yield events |
| `web_api/routes/promptlab.py` | New | API routes: list fixtures, get fixture, regenerate, continue |
| Fixture JSON files | `core/promptlab/fixtures/*.json` | Curated conversation snapshots |

**No database writes** -- INFRA-04 is inherently satisfied by the architecture: Prompt Lab never touches `chat_sessions` or any other table. All state lives in the browser.

### Frontend (React / Vike / Tailwind)

**What exists and can be reused:**

| Component | Location | How Prompt Lab Uses It |
|-----------|----------|----------------------|
| `ChatMarkdown` | `NarrativeChatSection.tsx` lines 19-90 | Extract to shared component, use for message rendering |
| Chat bubble styling | `NarrativeChatSection.tsx` | Same `bg-blue-50` (tutor) / `bg-gray-100` (user) pattern |
| SSE consumption | `api/modules.ts` `sendMessage()` | Same `ReadableStream` + `getReader()` pattern |
| `fetchWithRefresh` | `api/fetchWithRefresh.ts` | Token refresh for authenticated requests |
| `useAuth` hook | `hooks/useAuth.ts` | Auth state and login redirect |
| Vike page routing | `pages/facilitator/+Page.tsx` | Same pattern: `pages/promptlab/+Page.tsx` |
| `Layout` component | `components/Layout.tsx` | Wrap page |
| `Skeleton` components | `components/Skeleton.tsx` | Loading states |
| lucide-react icons | Already installed | UI icons |

**What needs to be created:**

| Component | Location | Purpose |
|-----------|----------|---------|
| `pages/promptlab/+Page.tsx` | New | Route entry point |
| `pages/promptlab/+title.ts` | New | Page title |
| `views/PromptLab.tsx` | New | Main view: two-panel layout, state management |
| `components/promptlab/ConversationPanel.tsx` | New | Right panel: message list with selection, comparison, CoT |
| `components/promptlab/PromptEditor.tsx` | New | Left panel: monospace textarea for system prompt |
| `components/promptlab/FixtureBrowser.tsx` | New | Fixture list/search initial screen |
| `components/ChatMarkdown.tsx` | Extracted | Shared markdown renderer (from NarrativeChatSection) |
| `api/promptlab.ts` | New | API client for Prompt Lab endpoints |

### Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Editor component | Plain `<textarea>` with `font-family: monospace` | Decision: "no syntax highlighting, it's natural language." CodeMirror adds ~150KB for no benefit here. |
| SSE transport | `fetch` + `ReadableStream.getReader()` | Already used in `api/modules.ts`. Works with POST requests (unlike `EventSource` which is GET-only). POST needed because we send conversation + prompt in body. |
| State management | React `useState` + `useCallback` | Already the pattern everywhere in this codebase. No state library needed for a single-page tool. |
| Thinking blocks | LiteLLM `thinking` parameter | Already supported by installed version. Pass `thinking={"type": "enabled", "budget_tokens": 4096}` to `stream_chat()`. |
| Fixture storage | JSON files in `core/promptlab/fixtures/` | Decision: version-controlled, curated. No DB needed. |

### No New Dependencies Needed

Neither frontend nor backend require new packages:
- **Backend:** `litellm`, `fastapi`, existing `StreamingResponse` -- all already installed
- **Frontend:** `react-markdown`, `remark-gfm`, `lucide-react` -- all already installed
- **Editor:** Plain `<textarea>` -- no package needed

---

## Feature Implementation Details

### Fixture Schema

Based on the existing chat system, a fixture JSON must capture everything needed to reconstruct a conversation and its original system prompt context. Here is the recommended schema:

```json
{
  "name": "Cognitive Superpowers - Chat 3",
  "module": "cognitive-superpowers",
  "description": "Student discusses deceptive alignment after reading the article",
  "systemPrompt": {
    "base": "You are a tutor helping someone learn about AI safety...",
    "instructions": "Discuss the concept of deceptive alignment..."
  },
  "previousContent": "The user just engaged with this content:\n---\n...",
  "messages": [
    { "role": "user", "content": "I found the deceptive alignment argument compelling..." },
    { "role": "assistant", "content": "That's a great observation! The key insight..." },
    { "role": "user", "content": "But couldn't we just test for it?" },
    { "role": "assistant", "content": "Testing for deceptive alignment is actually one of the hardest..." }
  ]
}
```

Key design points:
- `systemPrompt.base` + `systemPrompt.instructions` are stored separately so the editor can show the full assembled prompt while making clear which part is the "base" and which is per-chat
- `previousContent` captures the article/video content that was in context (the `previous_content` parameter to `_build_system_prompt`)
- `messages` is a flat array of user/assistant turns -- same format as what `stream_chat()` expects

### How `_build_system_prompt` Maps to Fixtures

Looking at the existing prompt construction in `core/modules/chat.py`:

```python
base = "You are a tutor helping someone learn about AI safety..."
prompt = base + f"\n\nInstructions:\n{current_stage.instructions}"
if not current_stage.hide_previous_content_from_tutor and previous_content:
    prompt += f"\n\nThe user just engaged with this content:\n---\n{previous_content}\n---"
```

The fixture captures these three parts as separate fields so the Prompt Lab editor can show the assembled prompt. The `core/promptlab/regenerate.py` module assembles them the same way, but allows the facilitator to edit any part.

### SSE Streaming with Thinking Blocks

The existing `stream_chat()` in `llm.py` yields three event types: `text`, `tool_use`, `done`. For Prompt Lab, we need to add `thinking` events. Rather than modifying `llm.py` (which would violate INFRA-03's spirit), create a wrapper in `core/promptlab/regenerate.py`:

```python
async def regenerate_response(
    messages: list[dict],
    system: str,
    provider: str | None = None,
    enable_thinking: bool = True,
) -> AsyncIterator[dict]:
    """Stream a regenerated response with optional thinking blocks."""
    model = provider or DEFAULT_PROVIDER

    llm_messages = [{"role": "system", "content": system}] + messages

    kwargs = {
        "model": model,
        "messages": llm_messages,
        "max_tokens": 4096,  # Higher for evaluation
        "stream": True,
    }

    if enable_thinking:
        kwargs["thinking"] = {"type": "enabled", "budget_tokens": 4096}

    response = await acompletion(**kwargs)

    async for chunk in response:
        delta = chunk.choices[0].delta if chunk.choices else None
        if not delta:
            continue

        # Handle thinking content
        if hasattr(delta, 'reasoning_content') and delta.reasoning_content:
            yield {"type": "thinking", "content": delta.reasoning_content}

        # Handle text content
        if delta.content:
            yield {"type": "text", "content": delta.content}

    yield {"type": "done"}
```

This calls `litellm.acompletion` directly (same as `stream_chat()` does) but with the `thinking` parameter. The SSE event stream adds a new `thinking` type that the frontend collects separately from the response text.

**Confidence:** MEDIUM on the exact streaming API for thinking blocks. LiteLLM's streaming with thinking is documented but the exact delta field names may vary. The `reasoning_content` field is documented in LiteLLM 1.63.0+. May need to check `provider_specific_fields` as a fallback.

### API Endpoints

```
GET  /api/promptlab/fixtures          -- List available fixtures
GET  /api/promptlab/fixtures/{name}   -- Load a specific fixture
POST /api/promptlab/regenerate        -- Regenerate AI response (SSE stream)
POST /api/promptlab/continue          -- Continue conversation as student + get AI response (SSE stream)
```

Auth: All endpoints use `get_current_user` + `get_db_user_or_403` (facilitator/admin check).

The `regenerate` and `continue` endpoints are both SSE streams (POST returning `StreamingResponse` with `text/event-stream`). The request body contains:
- The full system prompt (edited by facilitator)
- Messages up to the regeneration point
- For `continue`: the new student message appended

No data is persisted. All conversation state lives in the browser.

### Frontend Architecture

```
PromptLab (views/PromptLab.tsx)
  -- State: fixture, messages, editedPrompt, selectedMessageIndex,
     regeneratedMessages, thinkingContent, isStreaming
  |
  +-- FixtureBrowser (initial screen / shown when no fixture loaded)
  |     -- Lists fixtures, filter by module, click to load
  |
  +-- Two-panel layout (shown when fixture loaded)
       |
       +-- Left: PromptEditor
       |     -- Monospace textarea with system prompt
       |     -- "Reset" button restores original from fixture
       |
       +-- Right: ConversationPanel
             -- Renders messages with ChatMarkdown
             -- Click assistant message to select for regeneration
             -- Messages after selected point are dimmed/collapsed
             -- "Regenerate" button triggers API call
             -- After regeneration:
             |   -- Original message shown collapsed/dimmed above new
             |   -- "Show reasoning" toggle for CoT
             -- Text input at bottom for follow-up messages (as student)
```

State management approach:
- `messages`: the full conversation array (original fixture + any regenerated/continued messages)
- `selectedIndex`: which assistant message is selected for regeneration (null = none)
- `regenerationMap`: Map<number, { original: string, regenerated: string, thinking: string }> -- tracks which messages have been regenerated and their original/new content
- `editedPrompt`: current text in the prompt editor
- `isStreaming`: whether a regeneration is in progress

When the facilitator selects an AI message at index N and clicks Regenerate:
1. Messages 0..N-1 are sent to the API (user/assistant turns only)
2. The streaming response replaces message at index N
3. Messages after N are removed (they're invalid now -- the conversation diverged)
4. Facilitator can type follow-up messages to continue from the new response

---

## Architecture

### Component Boundaries

```
Frontend                           Backend
--------                           -------
pages/promptlab/+Page.tsx     -->  web_api/routes/promptlab.py
  |                                   |
views/PromptLab.tsx                   |  (auth: get_current_user + get_db_user_or_403)
  |                                   |
api/promptlab.ts              -->  core/promptlab/
  |  (fetch + ReadableStream)         |-- fixtures.py    (list/load JSON files)
  |                                   |-- regenerate.py  (call litellm.acompletion with thinking)
  |                                   |-- fixtures/      (JSON fixture files)
  |                                   |
  |                               core/modules/llm.py  (NOT modified -- promptlab calls acompletion directly)
```

**Layer separation is maintained:**
- `core/promptlab/` does NOT import from `chat.py` or `scoring.py` (INFRA-03)
- `core/promptlab/` imports `litellm.acompletion` directly (same as `llm.py` does)
- `web_api/routes/promptlab.py` imports from `core/promptlab/` and `web_api/auth`
- Frontend is fully client-side (SPA, no SSR needed)

### Data Flow: Regeneration

```
1. Facilitator clicks AI message at index 3
2. Facilitator edits system prompt
3. Facilitator clicks "Regenerate"
4. Frontend: POST /api/promptlab/regenerate
   Body: { systemPrompt, messages: [msg0, msg1, msg2] }  // messages 0..2 (before target)
5. Backend: assembles system prompt, calls acompletion with thinking
6. Backend: yields SSE events: thinking chunks, text chunks, done
7. Frontend: collects thinking text and response text separately
8. Frontend: replaces message at index 3, removes messages 4+
9. Frontend: shows original message collapsed above new one
10. Frontend: stores thinking text for "Show reasoning" toggle
```

### Data Flow: Continue Conversation

```
1. Facilitator types student message in input
2. Frontend: appends user message to local messages array
3. Frontend: POST /api/promptlab/continue
   Body: { systemPrompt, messages: [...allMessages, newUserMessage] }
4. Backend: same streaming as regenerate
5. Frontend: appends streamed AI response to messages array
```

---

## Pitfalls

### Critical: SSE Stream Buffering

**What goes wrong:** FastAPI's `StreamingResponse` with `text/event-stream` can be buffered by reverse proxies (nginx, Railway's proxy) or the ASGI server, causing chunks to arrive in large batches instead of streaming smoothly.

**Prevention:** The existing chat endpoint (`web_api/routes/module.py`) already handles this correctly with `Cache-Control: no-cache` and `Connection: keep-alive` headers. Copy those exact headers. Railway's proxy supports SSE streaming natively (the existing chat already works in production).

**Detection:** Test streaming locally with `--dev` mode. If chunks arrive all at once instead of incrementally, check proxy configuration.

### Critical: Thinking Blocks in Streaming Mode

**What goes wrong:** LiteLLM's streaming API for thinking blocks may not expose `reasoning_content` on every delta chunk the same way as `content`. The field name or structure might differ between providers.

**Prevention:**
1. Start with a simple test: call `acompletion` with `thinking={"type": "enabled", "budget_tokens": 1024}` and `stream=True`, then inspect the raw chunks
2. Check both `delta.reasoning_content` and `delta.provider_specific_fields` for thinking content
3. Fall back gracefully: if thinking blocks aren't available in streaming, collect them from the final response or omit CoT display with a note

**Confidence:** MEDIUM. LiteLLM 1.81.11 should support this, but the exact streaming delta structure for thinking blocks needs validation during implementation.

### Moderate: System Prompt Assembly

**What goes wrong:** The facilitator edits a monolithic text block, but the original prompt was assembled from base + instructions + previous_content. If the fixture doesn't clearly separate these, the facilitator can't tell what's editable vs. structural.

**Prevention:** The fixture schema stores `base`, `instructions`, and `previousContent` separately. The Prompt Lab assembles them into the full prompt for display, with clear visual separators (e.g., comments like `# --- Base prompt ---` and `# --- Per-chat instructions ---`). The facilitator edits the assembled text, and the backend sends the full edited string as the system prompt.

### Moderate: Conversation State After Regeneration

**What goes wrong:** If the facilitator regenerates a message in the middle of a conversation, all subsequent messages become invalid (they were responses to different content). If the UI doesn't clearly communicate this, the facilitator might be confused about which messages are "real."

**Prevention:** The decision already addresses this: "Messages after the selected point are dimmed/collapsed (they'll be replaced by the regeneration)." After regeneration completes, messages after the regeneration point are removed entirely. The UI should make this destructive action clear before the facilitator clicks Regenerate.

### Moderate: Large System Prompts

**What goes wrong:** System prompts with previous article/video content can be very long (thousands of tokens). The textarea might be unwieldy.

**Prevention:** Use a tall textarea with generous height (e.g., `min-h-[400px]`) and allow resize. Consider showing a token count estimate below the editor (rough: chars / 4).

### Minor: Fixture File Discovery

**What goes wrong:** The backend needs to discover JSON files in `core/promptlab/fixtures/`. File system operations in Python are synchronous and should not be called in async handlers without care.

**Prevention:** Use `pathlib.Path.glob("*.json")` and `json.loads()` -- both are fast for a small number of files. The fixtures directory will have at most a few dozen files. Cache the fixture list on first load (these are static files in the repo).

### Minor: CORS / Cookie Issues with SSE POST

**What goes wrong:** The existing SSE streaming (chat) works because it sends credentials and uses the same cookie-based auth. The Prompt Lab endpoints must do the same.

**Prevention:** Use `fetchWithRefresh` from `api/fetchWithRefresh.ts` (which handles 401 -> refresh -> retry) and include `credentials: "include"`. The backend auth uses the same `get_current_user` dependency that all other authenticated routes use.

---

## Implications for Roadmap

### Suggested Task Structure

Based on the analysis, the work divides into these logical blocks:

1. **Extract ChatMarkdown to shared component** (prerequisite)
   - Move `ChatMarkdown` from `NarrativeChatSection.tsx` to `components/ChatMarkdown.tsx`
   - Update `NarrativeChatSection.tsx` to import from new location
   - Low risk, small change, unblocks frontend work

2. **Backend: core/promptlab module** (independent of frontend)
   - `fixtures.py`: Load/list fixture JSON files
   - `regenerate.py`: Wrapper around `acompletion` with thinking support
   - Fixture JSON schema and initial fixture files
   - Tests for fixture loading and prompt assembly

3. **Backend: API routes** (depends on #2)
   - `web_api/routes/promptlab.py`: REST + SSE endpoints
   - Auth guard using existing facilitator check
   - Register router in `main.py`

4. **Frontend: Prompt Lab page and routing** (depends on #1)
   - `pages/promptlab/+Page.tsx` and `+title.ts`
   - `views/PromptLab.tsx`: main view with state management
   - `api/promptlab.ts`: API client with SSE streaming

5. **Frontend: UI components** (depends on #4)
   - `FixtureBrowser`: list, filter, load
   - `PromptEditor`: monospace textarea with reset
   - `ConversationPanel`: message display, selection, regeneration, comparison, CoT toggle, follow-up input

6. **Integration and Polish**
   - Wire streaming end-to-end
   - Validate thinking blocks work in streaming mode
   - Error handling for failed regenerations
   - Loading states and transitions

### Phase Ordering Rationale

- Block 1 (ChatMarkdown extraction) is a small, safe refactor that should happen first since it touches existing code
- Blocks 2-3 (backend) and blocks 4-5 (frontend) can proceed in parallel
- Block 6 (integration) naturally comes last
- The thinking block streaming (CHAT-07) is the riskiest part -- if LiteLLM's streaming doesn't expose thinking cleanly, a fallback is needed. Research this during Block 2 implementation.

### Research Flags

- **Thinking blocks in streaming mode:** MEDIUM confidence. Needs hands-on validation during implementation. The non-streaming API is well-documented; streaming is less so.
- **Everything else:** HIGH confidence. All patterns are established in the codebase, just being composed differently.

---

## Confidence Assessment

| Area | Confidence | Reason |
|------|------------|--------|
| Backend architecture | HIGH | Directly follows established `core/` module pattern; `stream_chat()` already works |
| SSE streaming | HIGH | Existing `module.py` endpoint is the exact pattern to copy |
| Facilitator auth | HIGH | `get_db_user_or_403()` is battle-tested in production |
| Frontend components | HIGH | Chat bubbles, SSE consumption, Vike routing -- all established patterns |
| Fixture schema | HIGH | Directly maps to existing `_build_system_prompt()` parameters |
| LiteLLM thinking (non-streaming) | HIGH | Documented, version supports it, straightforward parameter |
| LiteLLM thinking (streaming) | MEDIUM | Less documented for streaming deltas; needs implementation validation |
| No new dependencies | HIGH | Everything needed is already installed |

---

## Open Questions / Gaps

1. **Thinking block streaming format:** The exact field on streaming delta chunks for reasoning content needs hands-on testing. `delta.reasoning_content` is the documented path, but `delta.provider_specific_fields` may be needed as fallback.

2. **Fixture extraction tooling:** The prior decision says "Manual fixture extraction via Claude Code." This means during implementation, someone needs to query the database for real chat sessions, inspect them, and craft fixture JSONs. This is a content task, not a code task -- but the fixture schema needs to be finalized first so the extraction knows what shape to produce.

3. **Token budget for thinking:** The `budget_tokens` value for the thinking parameter affects cost and response time. Start with 4096 and let facilitators adjust if needed (could add a simple dropdown: "Brief / Standard / Deep").

---

## Sources

- LiteLLM reasoning content docs: https://docs.litellm.ai/docs/reasoning_content
- LiteLLM Anthropic provider docs: https://docs.litellm.ai/docs/providers/anthropic
- Claude extended thinking docs: https://platform.claude.com/docs/en/build-with-claude/extended-thinking
- Codebase: `core/modules/llm.py` (stream_chat), `core/modules/chat.py` (_build_system_prompt), `web_api/routes/module.py` (SSE pattern), `web_frontend/src/components/module/NarrativeChatSection.tsx` (ChatMarkdown, chat bubbles), `web_api/routes/facilitator.py` (facilitator auth), `web_api/auth.py` (JWT auth)
