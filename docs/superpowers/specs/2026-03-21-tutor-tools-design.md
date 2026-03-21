# Tutor Tools & Context — Design Spec

**Date:** 2026-03-21
**Status:** Draft
**Scope:** Add external knowledge tools and course-wide context to the module tutor.

## Problem

The tutor currently has one tool (`transition_to_next`) and only sees the current section's content. It cannot:
- Search the web for current information
- Look up AI alignment research beyond the course material
- Reference other parts of the course
- Search through course content outside the current section

## Design

### Tool Architecture

Add a **tool registry** in `core/modules/tools/` that assembles tools per chat request. Tools use OpenAI function-calling format and are executed server-side in a tool execution loop.

Note: The previous `TRANSITION_TOOL` in `chat.py` is broken and will be removed as part of this work.

#### Tool Registry

`core/modules/tools/__init__.py` exposes `get_tools(stage) -> list[dict] | None`:
- `search_alignment_research` — **all stage types** (loaded from MCP server)
- Future tools (web_search, content_search) — all stage types

Returns `None` (not empty list) when no tools are available, matching LiteLLM convention.

#### Tool Execution Loop

Refactor `send_module_message()` from a single pass-through stream into a multi-round loop:

```
for round in range(MAX_TOOL_ROUNDS):  # MAX_TOOL_ROUNDS = 3
    chunks = []
    async for chunk in acompletion(stream=True, tools=tools, ...):
        chunks.append(chunk)
        yield text/thinking events to caller as they arrive

    message = litellm.stream_chunk_builder(chunks)
    if not message.tool_calls:
        break  # LLM finished with text, done

    append reconstructed assistant message to messages (including thinking_blocks)
    for each tool_call in message.tool_calls:
        yield {"type": "tool_use", "name": tool_call.function.name} to frontend
        execute tool (with timeout)
        append {"role": "tool", "tool_call_id": ..., "name": ..., "content": ...}

else:
    # Hit max rounds — force text response
    final call with tool_choice="none"
```

**Chunk reconstruction:** `litellm.stream_chunk_builder(chunks)` handles accumulating streamed tool call fragments (id, name, argument JSON pieces) into complete tool call objects. No manual fragment buffering needed.

**`llm.py` changes:** The tool loop lives in `chat.py`, not `llm.py`. `stream_chat()` is refactored to return the raw LiteLLM streaming response directly (not our normalized events), so the caller can both yield frontend events and collect chunks for `stream_chunk_builder`. A separate helper `iter_stream_events(chunk)` normalizes a single chunk into our event format for yielding.

**Thinking blocks in multi-turn:** Thinking stays enabled on ALL rounds, including after tool results. Anthropic requires `thinking_blocks` in assistant messages during tool call conversations. The reconstructed message from `stream_chunk_builder` includes these. When appending the assistant message back to the messages list, we must preserve thinking blocks. Known LiteLLM bugs with thinking block interleaving were fixed in ~v1.81.8 (PR #20702); we're on 1.81.11. If issues arise, upgrade LiteLLM.

**Max rounds:** 3 iterations. After 3 rounds, a final call with `tool_choice="none"` forces the LLM to produce text.

**Tool execution timeout:** Each tool call has a 15-second `asyncio.wait_for` timeout. On timeout, the tool result message contains "Tool timed out — respond without this information."

**Error handling:** If a tool call fails (MCP down, timeout, exception), the error is sent back to the LLM as the tool result content (e.g., "Error: search unavailable"). The LLM responds gracefully without the result. Errors are not surfaced directly to the frontend as error events.

**Multiple parallel tool calls:** The LLM may call multiple tools in a single response. All tool results are appended before the next LLM call. Tool executions can be run concurrently with `asyncio.gather`.

#### Saving Tool Interactions to Chat History

Tool call and tool result messages are **not** saved to the persistent chat session. Only the final assistant text response is saved (existing behavior). Rationale:
- Tool results are ephemeral lookups, not conversational context
- Saves storage and avoids bloating the message array
- The assistant's text response already incorporates the tool information

### Tool 1: Alignment Research Search (Stampy MCP) — Phase 1

Search the Alignment Research Dataset (LessWrong, AlignmentForum, arXiv, etc.) via the Stampy MCP server's `search_alignment_research` tool.

**MCP server:** `https://chat.aisafety.info/mcp` (Streamable HTTP transport)

**Implementation approach:**
- Use `mcp` Python SDK (`streamablehttp_client`) to connect as an MCP client
- Use `litellm.experimental_mcp_client` to bridge MCP tools into LiteLLM's tool-calling format:
  - `load_mcp_tools(session, format="openai")` — converts MCP tool definitions to OpenAI format
  - `call_openai_tool(session, openai_tool)` — executes tool calls via MCP, returns results
- If `litellm.experimental_mcp_client` proves unstable, fallback plan: manually define the tool in OpenAI format and call MCP directly via `session.call_tool()`

**MCP session lifecycle:**
- Session opened on app startup (FastAPI lifespan handler)
- Stored as app state (`app.state.mcp_session`)
- On connection failure at startup: log warning, disable alignment search tool (tutor works without it)
- On connection failure during a request: return error string as tool result, log warning, attempt reconnection on next request
- Reconnection strategy: lazy — if session is dead, re-establish on next tool call attempt
- Session closed on app shutdown

**Tool definition (from MCP server):**
- `search_alignment_research(query, k=5)` — semantic vector search over Pinecone
- Returns relevant excerpts with titles, authors, URLs
- Filterable by source, date, authors, quality score

**New files:**
- `core/modules/tools/__init__.py` — tool registry, `get_tools(stage)` function
- `core/modules/tools/alignment_search.py` — MCP client lifecycle + tool wrapper + executor

**New dependency:** `mcp` (Python MCP SDK, for Streamable HTTP client)

**Env var:** `STAMPY_MCP_URL` (default: `https://chat.aisafety.info/mcp`). When unset or empty, the alignment search tool is silently disabled — no startup error, tool simply not included in `get_tools()`.

### Tool 2: Web Search (Exa) — Future Phase

Search the web for current information, papers, news relevant to AI safety topics.

**Provider:** Exa AI ($0.007/query, 1k free/month)

**Implementation:**
- `core/modules/tools/web_search.py`
- `web_search(query)` — calls Exa Search API, returns top 3 results with title/URL/snippet
- Tutor decides autonomously when to search

**Env var:** `EXA_API_KEY`

**New dependency:** `exa-py`

### Tool 3: Course Content Search — Future Phase

Keyword search over all cached course content (articles, video transcripts, lens text segments).

**Implementation:**
- `core/modules/tools/content_search.py`
- `search_course_content(query)` — searches in-memory ContentCache
- Returns top 5 matching excerpts with source info (module, section, segment type)
- Scope: all course content, not just current module
- Start with keyword/fuzzy search; upgrade to embeddings later if needed

**No new dependencies** (operates on existing ContentCache)

### Course Context in System Prompt

Inject a structured course overview into every tutor system prompt so it can reference the broader course structure, know what the student has covered, and point forward/backward.

**Content of the overview:**
- Course title
- Module list in progression order (with meeting markers as unit boundaries)
- Per module: title + per-section title and TLDR
- Student completion status per section (completed / current / upcoming)
- Current position highlighted

**Implementation:**
- New function `build_course_overview()` in `core/modules/prompts.py`
- Takes: current module slug, current section index, user progress (dict of content_id → completed)
- Internally calls `load_course()` and `load_flattened_module()` for each module in the progression
- Returns: formatted string (~500-1500 tokens depending on course size)
- Injected after `DEFAULT_BASE_PROMPT`, before stage-specific instructions

**Data access:**
- Course structure: `load_course()` from `core/modules/course_loader.py` — returns `ParsedCourse` with progression list
- Module sections + TLDRs: `load_flattened_module()` per module — returns `FlattenedModule` with sections (dicts containing `meta.title`, `tldr`, `contentId`)
- User progress: query `lens_progress` table for user's completed content IDs (new query needed in route layer)

**Caching strategy:**
- The static part (course structure + module titles + section titles + TLDRs) is cached as a module-level dict keyed by course slug
- Cache invalidated on content refresh (hook into existing `ContentCache` refresh lifecycle)
- Per-request: only the user's progress markers are merged in
- `load_flattened_module()` reads from the already-in-memory `ContentCache`, so the per-module calls are cheap (dict lookups, not re-parsing)

**Token budget:** The course overview is bounded by course size. With ~15 modules averaging ~3 sections each, at ~80 words per TLDR + overhead, this is ~4000-6000 tokens worst case. If the total system prompt (base + course overview + section context + instructions) exceeds 8000 tokens, truncate the course overview by dropping TLDRs for non-adjacent modules (keep TLDRs only for current module, previous module, and next module).

### Changes to Existing Files

**`core/modules/chat.py`:**
- Remove broken `TRANSITION_TOOL` definition and its usage
- Import tool registry (`get_tools`) and tool executors
- Refactor `send_module_message()` into multi-round tool execution loop
- Accept `course_overview` parameter and prepend to system prompt

**`core/modules/llm.py`:**
- Refactor `stream_chat()` to return the raw LiteLLM async generator (not our normalized events)
- Extract chunk normalization into a helper `iter_chunk_events(chunk) -> list[dict]` for use by the caller
- The tool loop in `chat.py` handles both yielding events and collecting chunks

**`core/modules/prompts.py`:**
- Add `build_course_overview()` function
- Add tool usage guidance to `DEFAULT_BASE_PROMPT` or as a separate block

**`web_api/routes/module.py`:**
- Load course data via `load_course()`
- Query user's lens progress (completed content IDs)
- Call `build_course_overview()` and pass result to `send_module_message()`

**`requirements.txt`:**
- Add `mcp` (Phase 1)
- Add `exa-py` (future phase only)

### System Prompt Additions

Add tool usage guidance (appended when tools are available):

```
You have access to tools for looking up information. Use them when:
- The student asks about alignment research topics beyond the current material
- You need to verify or expand on a specific claim
- The student asks about something not covered in the course

When you use a tool, briefly mention what you're looking up. Cite sources when providing information from tools.
```

### Frontend Considerations

The frontend currently does **not** handle `tool_use` SSE events — they are silently ignored. During tool execution, the user will see a pause (no streaming text) while the tool runs and the LLM re-generates. This is acceptable for Phase 1 since tool calls should complete within seconds.

**Future enhancements (not Phase 1):**
- Handle `tool_use` events in `useTutorChat.ts` to show "Searching..." indicator
- Display source citations in the tutor response
- Show collapsible tool result details

## Implementation Phases

**Phase 1 (this plan):**
1. Tool registry architecture (`core/modules/tools/`)
2. Tool execution loop in `chat.py` + `llm.py`
3. Stampy MCP integration (`alignment_search.py`)
4. Course context in system prompt (`build_course_overview()`)

**Future phases:**
5. Exa web search tool
6. Course content search tool
7. Frontend tool status indicators + citations

## Testing Strategy

- Unit tests for `build_course_overview()` output format and truncation
- Unit tests for tool registry (correct tools per stage type, graceful when MCP unavailable)
- Unit test for tool execution loop in `chat.py` (mock `acompletion` returning tool calls → verify loop executes tools and re-calls)
- Integration test for MCP client connection + tool call round-trip (requires network access to Stampy)
- Integration test for tool execution loop (mock LLM returning tool_use, verify tool executed, result sent back, LLM re-called)
- Test max-rounds limit (mock LLM that always calls tools → verify loop terminates after 3)
- Test tool timeout behavior (mock slow tool → verify error result sent to LLM)
