# Phase 6: Prompt Lab — Issues Found During Testing

## Blockers

### Issue 3+4: Thinking mode broken and hardcoded on — blocks ALL regeneration

**Where:**
- Backend: `core/promptlab/regenerate.py:71-77` — uses deprecated `thinking: {type: "enabled", budget_tokens: 4096}` with `max_tokens=2048` (must be > budget_tokens)
- Frontend: `web_frontend/src/views/PromptLab.tsx:132` and `:202` — both `regenerateResponse()` and `continueConversation()` hardcode `enableThinking: true`

**What happens:** Every regeneration request immediately fails with `litellm.BadRequestError: "max_tokens must be greater than thinking.budget_tokens"`. There's no UI toggle to disable thinking, so ALL LLM functionality is broken.

**Impact:** Blocks ALL regeneration and follow-up. Nothing after fixture selection works.

#### Fix Plan: Adaptive Thinking for Both Normal Chat and Prompt Lab

Per [Anthropic migration guide](https://platform.claude.com/docs/en/about-claude/models/migration-guide), `budget_tokens` is deprecated on Claude 4.6. Switch to `thinking: {type: "adaptive"}`.

**1. `core/modules/llm.py` — Add adaptive thinking to normal chat**

Add optional `thinking` and `effort` parameters to `stream_chat()`:
```python
async def stream_chat(
    messages, system, tools=None, provider=None,
    max_tokens=16384,
    thinking=True,      # enable adaptive thinking by default
    effort="low",       # low effort for normal student chat
):
    kwargs = {
        "model": model,
        "messages": llm_messages,
        "max_tokens": max_tokens,
        "stream": True,
    }
    if thinking:
        kwargs["thinking"] = {"type": "adaptive"}
        kwargs["output_config"] = {"effort": effort}
    ...
    # Also yield {"type": "thinking", ...} events for reasoning_content
```

Also handle `reasoning_content` in the streaming loop (even if normal chat UI ignores it, the events should be emitted).

**2. `core/promptlab/regenerate.py` — Simplify to reuse stream_chat**

Prompt Lab should default to the same config as normal chat, but allow overrides:
```python
async def regenerate_response(
    messages, system_prompt,
    enable_thinking=True,
    effort="low",            # same default as normal chat
    provider=None,           # optional model override
    max_tokens=16384,
):
    # Delegate to stream_chat with same defaults as normal chat
    async for event in stream_chat(
        messages=messages,
        system=system_prompt,
        provider=provider,
        max_tokens=max_tokens,
        thinking=enable_thinking,
        effort=effort,
    ):
        yield event
```

No more separate `acompletion()` call — reuse `stream_chat` so Prompt Lab and normal chat share the same LLM path.

**3. Frontend: API + UI controls**

- `web_api/routes/promptlab.py` — Add optional `effort` and `model` fields to `RegenerateRequest`/`ContinueRequest`, pass through to `regenerate_response()`
- `web_frontend/src/api/promptlab.ts` — Add `effort` and `model` params to `regenerateResponse()` and `continueConversation()`
- `web_frontend/src/views/PromptLab.tsx`:
  - Add "Enable reasoning" checkbox (controls `enableThinking`, defaults to true)
  - Add effort selector (low/medium/high, defaults to "high" for Prompt Lab)
  - Optionally: model selector dropdown (defaults to whatever the server uses, but allows override)
  - Place these controls in the prompt editor panel or a small toolbar

**Key design decisions:**
- Normal chat: adaptive thinking ON, effort `low`
- Prompt Lab: same defaults as normal chat (adaptive ON, effort `low`), but both configurable via UI
- Both use `stream_chat()` — single LLM path, no duplication
- `max_tokens` bumped to 16384 for both (from 1024/2048) to give headroom for thinking + response

## UX Issues

### Issue 1: No access-denied message for non-facilitators

**Where:** `/promptlab` page when logged in as a non-facilitator user
**What happens:** The page shows "Failed to fetch fixtures" with a Retry button. The API returns 403 but the frontend doesn't distinguish between auth failure and a network error.
**Expected:** A clear message like "You need facilitator or admin access to use the Prompt Lab" — not a generic fetch error with a retry button that will just fail again.

### Issue 2: Regeneration fails silently when session expires mid-use

**Where:** Clicking "Regenerate from selected" after session JWT expires
**What happens:** POST `/api/promptlab/regenerate` returns 401, refresh also returns 401, then the page shows a red "Failed to regenerate response" banner — but doesn't redirect to login or explain that the session expired.
**Expected:** When the session is fully expired (refresh fails too), redirect to login or show "Session expired, please sign in again" — not a generic regeneration error.

### Issue 5: Raw API error JSON dumped into error banner

**Where:** The red error banner at the top of the page after regeneration failure
**What happens:** The full error object including `litellm.BadRequestError`, internal JSON with `request_id`, documentation URLs, etc. is displayed verbatim. The banner text is very long, wraps awkwardly, and exposes internals.
**Expected:** A user-friendly error message like "Regeneration failed. Please try again." with raw details logged to console only.

### Issue 6: Error banner is not dismissible

**Where:** Same red error banner as Issue 5
**What happens:** After a failed regeneration, the error banner persists until you navigate away (e.g., back to Fixtures). There's no X button or way to dismiss it. It also clears the message selection, forcing re-selection after dismissal.
**Expected:** Error banner should have a dismiss/close button.

## Untested (blocked by Issues 3+4)

The following features could not be tested because all LLM calls fail:

- SSE streaming display (progressive text rendering)
- Original vs regenerated message comparison (collapsed original above new)
- Chain-of-thought / "Show reasoning" toggle on regenerated messages
- Follow-up messaging as student (input + AI response)
- Multiple regenerations on the same message

## What Works

- Auth gate: unauthenticated users see "Sign in with Discord", authenticated non-facilitators get blocked (though with wrong message — Issue 1)
- Fixture browser: loads fixtures, displays cards with titles/modules/descriptions
- Module filter: correctly hidden when all fixtures share one module, present when >1
- Two-panel layout: system prompt (left, monospace) + conversation (right)
- Prompt editing: textarea editable, "Modified" indicator appears, "Reset to original" restores and disables
- Message selection: click Tutor message to select, blue highlight, dimmed messages after selection, "Messages below will be replaced" separator
- "Regenerate from selected" button appears on selection
- Back navigation: "← Fixtures" returns to fixture browser cleanly
- Follow-up input correctly disabled before regeneration
