# AI Coach Phase 2: Per-User Persistence, Course Tools, and Scheduled Jobs

**Date:** 2026-04-25
**Status:** Draft
**Depends on:** Phase 1 prototype (`docs/superpowers/specs/2026-04-10-ai-coach-discord-prototype-design.md`)

## Context

Phase 1 shipped a working AI coach on Discord DM with a handoff-ready multi-agent architecture (coach + tutor stub). It can hold conversations, hand off to the tutor for technical questions, and persist conversation history.

What it can't do: remember anything about the user across sessions, access their course progress, schedule reminders, or adapt its personality per user. Every user gets the same generic coach.

Phase 2 turns the coach from a generic chatbot into a personalized assistant inspired by OpenClaw's architecture: per-user identity files, persistent memory, course-aware tools, and scheduled check-ins. The goal is the "OpenClaw of AI safety coaching" — an assistant that knows you, remembers your journey, and reaches out when it matters.

## Goal

1. **Per-user files** — three Markdown-style files per user (`agent_style.md`, `user.md`, `memory.md`) that persist the coach's style adjustments, knowledge about the user, and running notes
2. **Course-context tools** — the coach can look up the user's progress and upcoming deadlines
3. **Scheduled jobs** — the coach can schedule check-ins that fire as full coach turns, sending DMs when due
4. **Non-transfer tool execution** — extend the dispatcher to handle regular tool calls (not just handoff tools)

## Architecture

### How it extends Phase 1

Phase 1's dispatcher runs an LLM loop that handles handoff tool calls (`transfer_to_*`). Phase 2 extends this loop to also handle **regular tool calls** — the same pattern the existing tutor uses in `core/modules/chat.py` (multi-round tool execution with `MAX_TOOL_ROUNDS`).

```
User DMs bot
    |
    v
dispatcher.handle_message(identity, text)
    |
    +-- load per-user files (agent_style.md, user.md, memory.md)
    +-- inject files into system prompt (stable, cached)
    +-- build per-turn context injection (time, progress, deadlines — dynamic)
    +-- append context + user message to message array tail
    +-- run LLM loop:
    |     +-- LLM responds with text → done
    |     +-- LLM calls transfer_to_* → handoff (existing)
    |     +-- LLM calls get_my_progress → execute, append result, loop  [NEW]
    |     +-- LLM calls append_memory → execute, append result, loop   [NEW]
    |     +-- LLM calls schedule_reminder → execute, append result, loop [NEW]
    |
    +-- save session + updated files
```

### New tables

Two new tables. No changes to existing tables (the `chat_sessions` partial unique index from Phase 1 is already in place).

### Message schema addition

Phase 2 adds a `ts` field (ISO 8601 UTC string) to every message in the `chat_sessions.messages` JSONB array. This is a backward-compatible addition — existing messages without `ts` are displayed without timestamps. The dispatcher adds `ts` to both user and assistant messages at creation time.

### New modules

```
core/
  agents/
    tools/                      # NEW subdirectory
      __init__.py               # Tool executor registry
      memory_tools.py           # read_file, write_file, append_memory
      progress_tools.py         # get_my_progress, get_my_upcoming_deadlines
      scheduling_tools.py       # schedule_reminder, list_my_reminders, cancel_reminder
    coach/                      # MOVED from core/coach/ — agents are subdirectories of agents/
      __init__.py
      persona.py                # MODIFIED: update system prompt, add tool_executor
      context.py                # NEW: builds the per-turn context injection block
    user_files.py               # NEW: load/save per-user files from DB
    dispatcher.py               # MODIFIED: add non-transfer tool execution loop + context injection
```

## Schema

### `coach_user_files`

Per-user "workspace" of Markdown-style files. Three rows per active user.

```sql
CREATE TABLE coach_user_files (
    user_id     INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    filename    TEXT NOT NULL,
    content     TEXT NOT NULL DEFAULT '',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, filename)
);
```

Standard filenames: `agent_style.md`, `user.md`, `memory.md`.

Rows are created lazily on first coach interaction (all three files, empty content). No migration of existing users — files appear when they first message the coach.

### `coach_scheduled_jobs`

Scheduled jobs that fire full coach turns.

```sql
CREATE TABLE coach_scheduled_jobs (
    job_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    fire_at     TIMESTAMPTZ NOT NULL,
    reason      TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_coach_jobs_pending ON coach_scheduled_jobs (fire_at)
    WHERE status = 'pending';
CREATE INDEX idx_coach_jobs_user ON coach_scheduled_jobs (user_id);
```

Status values: `pending` | `sent` | `skipped` | `cancelled` | `failed`.

No `message` or `condition` columns — the coach has full judgment at fire time. It sees the reason, loads user context, decides what to say (or whether to say anything at all).

## Per-user files

### The three files

| File | Purpose | Who writes | Changes how often |
|---|---|---|---|
| `agent_style.md` | Coach style overlay for this user. Tone, verbosity, name preferences. | Agent (rare, confirmed) + user via future UI | Rarely — stable once tuned |
| `user.md` | Facts about the user. Name, timezone, goals, motivations, schedule. | Agent (confirmed) + user via future UI | Occasionally — as coach learns more |
| `memory.md` | Running notes. Observations, decisions, patterns the coach has noticed. | Agent via `append_memory` (frequent, confirmed) | Every few sessions |

**Why three and not one**: write isolation. `memory.md` gets frequent appends via a dedicated tool that can't accidentally clobber `agent_style.md`. `agent_style.md` gets rare full-replaces with user confirmation. Different change rates, different actors, different blast radii. This matches the OpenClaw/Letta pattern validated by community experience.

**Why three and not seven** (OpenClaw's full set): IDENTITY.md folds into `agent_style.md`. AGENTS.md and TOOLS.md are our hardcoded base prompt (not per-user). HEARTBEAT.md is not applicable (we use scheduled jobs). Three files covers our needs without unnecessary splits.

### File-shaped tools

| Tool | Schema for LLM | What it does |
|---|---|---|
| `read_file(filename)` | `{filename: str}` | Returns content of agent_style.md, user.md, or memory.md |
| `edit_file(filename, old_string, new_string)` | `{filename: str, old_string: str, new_string: str}` | Find-and-replace within a file. `old_string` must match exactly (fails if not found or ambiguous). Surgical edits only — no full-file overwrites. Modeled after Claude Code's Edit tool. |
| `append_memory(note)` | `{note: str}` | Appends `\n- {YYYY-MM-DD}: {note}` to memory.md. The primary write tool — safe, append-only, can't clobber other files. |

**No `write_file` tool.** Full file replacement is intentionally not available. If the coach needs to rewrite a whole file (e.g., memory compaction), it does so via `edit_file` with the entire current content as `old_string` — deliberately clunky to make full rewrites feel intentional.

The tools take `filename` as a parameter, but only the three known filenames are accepted. Unknown filenames return an error. The LLM cannot create new files — fixed schema, fixed set.

### Prompt assembly

The system prompt contains only stable content (cacheable). Dynamic content goes into the message array.

**System prompt (stable, cached):**
```
[BASE_COACH_PROMPT — hardcoded, shared across all users]

You have a personal workspace for this user with three files that persist
across sessions. Use them to remember things and adapt your behavior.

## agent_style.md (your style adjustments for this user)
{content or "(empty — use default style from the base prompt above)"}

## user.md (what you know about this user)
{content or "(empty — you haven't learned about this user yet. Ask them!)"}

## memory.md (your running notes about this user)
{content or "(empty)"}
```

**Message array (dynamic tail):**
```
...conversation history (append-only, cached)...
[per-turn context injection — see "Per-turn context injection" section]
[user's latest message]
```

**Token budget**: System prompt at typical sizes (base ~500 words, persona ~200, user ~200, memory ~500) = ~2.5k tokens. Per-turn context injection = ~80 tokens. Well within budget.

**Caching**: The system prompt changes only when the agent writes to a file (rare). The conversation history is append-only. Both cache well. Only the context injection + latest message are uncached — this is the minimum possible uncached tail.

### Memory policy

**Explicit or confirmed** (ChatGPT-style):
- User says "remember that I study on Tuesdays" → coach calls `append_memory`
- Coach asks "should I note that you prefer morning sessions?" → if user confirms, calls `append_memory`
- User says "be more direct" → coach confirms, then calls `write_file("agent_style.md", ...)`
- Coach does NOT silently extract facts from conversations

This keeps users in control and avoids the "how does it know that about me?" trust issue. Can evolve toward more agentic memory (Mem0-style auto-extraction) later if needed.

### Memory growth

`memory.md` is append-only and will grow over time. For the prototype:
- No automatic compaction or summarization
- The 50k input token cap from Phase 1 serves as a hard ceiling (memory is part of the system prompt, which is part of input tokens)
- If memory grows too large, the coach can be asked to "clean up your notes" (manual compaction — the user asks, the coach rewrites memory.md with a distilled version)
- Automated compaction is a future optimization (Anthropic Compaction API, or a periodic LLM call to summarize)

## Course-context tools

### `get_my_progress`

**What the LLM sees:**
```json
{
    "name": "get_my_progress",
    "description": "Get the current user's course progress. Returns which modules they've completed, which they're working on, and overall completion percentage.",
    "parameters": {"type": "object", "properties": {}, "required": []}
}
```

No parameters — `user_id` is injected by the dispatcher, not exposed to the LLM.

**What it does internally:**
1. Call `get_completed_content_ids(conn, user_id)` → set of completed content UUIDs
2. Load the course structure via `load_course(course_slug)` → get the list of modules + their content IDs
3. Cross-reference: for each module, count completed vs total lenses
4. Return a formatted summary string:
   ```
   Course: AI Safety Fundamentals
   Overall: 12/30 lenses completed (40%)

   Module 1: Introduction to AI Safety — 5/5 completed
   Module 2: Risks from AI — 4/8 completed (in progress)
   Module 3: Technical Alignment — 0/7 not started
   ...
   ```

**What the coach does with it**: Incorporates into its response. "Looks like you're halfway through Module 2! Want to tackle the corrigibility section today?"

### `get_my_upcoming_deadlines`

**What the LLM sees:**
```json
{
    "name": "get_my_upcoming_deadlines",
    "description": "Get the current user's upcoming deadlines: next group meeting, cohort end date, and which modules are due before each meeting.",
    "parameters": {"type": "object", "properties": {}, "required": []}
}
```

**What it does internally:**
1. Call `get_meeting_dates_for_user(conn, user_id)` → `{meeting_number: iso_date}`
2. Filter for future meetings only
3. Load course structure to find which modules are due before each meeting (via `get_due_by_meeting()`)
4. Get cohort info (start date, duration) from the user's group/cohort join
5. Return formatted summary:
   ```
   Next group meeting: Meeting 4 on Thursday April 28 at 2:00 PM UTC
     Due before this meeting: Module 3 (Technical Alignment) — not started

   Following meeting: Meeting 5 on Thursday May 5 at 2:00 PM UTC
     Due: Module 4 (Governance) — not started

   Cohort ends: May 30, 2026
   ```

**Unenrolled users**: If the user has no active group, return: "You're not currently enrolled in an active cohort. Visit the web platform to sign up!"

### Tool context pattern

Both tools need `user_id` but the LLM must not control it. Following the existing codebase pattern (`core/modules/chat.py` passes `content_index` into tool execution):

```python
# At dispatch time, bind user_id into the tool executor:
async def execute_tool(tool_call, user_id: int) -> str:
    name = tool_call["function"]["name"]
    if name == "get_my_progress":
        return await _get_progress_for_user(user_id)
    elif name == "get_my_upcoming_deadlines":
        return await _get_deadlines_for_user(user_id)
    elif name == "edit_file":
        args = json.loads(tool_call["function"]["arguments"])
        return await _edit_file(user_id, args["filename"], args["old_string"], args["new_string"])
    elif name == "append_memory":
        args = json.loads(tool_call["function"]["arguments"])
        return await _append_memory(user_id, args["note"])
    ...
```

The `user_id` comes from the authenticated session, not from the tool call arguments. The LLM never sees or controls it.

## Dispatcher changes

### Non-transfer tool execution

Phase 1's dispatch loop breaks when there's no handoff. Phase 2 adds a third case: **regular tool call → execute → append result → loop**.

The loop becomes:

```
while True:
    check token cap
    run LLM
    append assistant message

    if assistant has tool_calls:
        for each tool_call:
            if transfer_to_* → handle handoff (existing)
            else → execute tool, append tool result

        if handoff happened → switch agent, loop
        if regular tools only → loop (LLM needs another turn to respond with tool results)
    else:
        break (text-only response, done)
```

**MAX_TOOL_ROUNDS**: Cap at 5 tool-execution rounds per user turn (matching the existing tutor's `MAX_TOOL_ROUNDS` pattern in `chat.py`). Final round uses `tool_choice: "none"` to force a text response.

### Tool registration

Tools are registered per-agent, not globally. The `Agent` dataclass already has `extra_tools: tuple[dict, ...]` for tool schemas. Phase 2 adds:

- A `tool_executor` field on Agent that maps tool calls to handler functions
- The dispatcher calls `agent.tool_executor(tool_call, user_id)` when it sees a non-transfer tool call

```python
# Extend Agent dataclass
@dataclass(frozen=True)
class Agent:
    name: str
    system_prompt: str
    model: str
    extra_tools: tuple[dict, ...] = ()
    can_handoff_to: tuple[str, ...] = ()
    tool_executor: Callable | None = None  # async (tool_call, user_id) -> str
```

The coach agent registers its tools (memory, progress, deadlines, scheduling) via `tool_executor`. The tutor stub has no extra tools (for now).

## Scheduled jobs

### How they work

1. **During conversation**: Coach says "Want me to check in tomorrow?" → User says yes → Coach calls `schedule_reminder(fire_at="2026-04-26T18:00:00Z", reason="Daily progress check-in")`

2. **System-level cron** (runs every 15 minutes, NOT per-user):
   ```sql
   SELECT * FROM coach_scheduled_jobs
   WHERE status = 'pending' AND fire_at <= now()
   ORDER BY fire_at
   LIMIT 50
   ```

3. **For each due job**: Fire a full coach turn in isolation:
   - Load user's files (agent_style.md, user.md, memory.md)
   - Build system prompt with the base coach prompt + user files
   - Add a system message: "A scheduled job has fired. Reason: {reason}. Decide whether to message the user and what to say. You have access to your usual tools (progress, deadlines, memory). If you decide not to message, respond with '[NO_MESSAGE]'."
   - Run the LLM (with tools available)
   - If response is not `[NO_MESSAGE]`: send as DM via `core.discord_outbound.send_dm`
   - Update job status to `sent` or `skipped`

4. **User responds** to the DM → normal coach conversation resumes in their session

### Scheduling tools

| Tool | Schema | What it does |
|---|---|---|
| `schedule_reminder(fire_at, reason)` | `{fire_at: str (ISO 8601), reason: str}` | Insert a row into `coach_scheduled_jobs` |
| `list_my_reminders()` | `{}` | Return all pending jobs for this user |
| `cancel_reminder(job_id)` | `{job_id: str}` | Set status = 'cancelled' for the given job |

### Rate limits

- Max 20 pending jobs per user (prevents abuse or runaway scheduling)
- Jobs can be scheduled at most 90 days in the future
- The cron worker processes at most 50 jobs per run (prevents thundering herd)
- Failed jobs are retried once after 5 minutes, then marked `failed`

### Integration with APScheduler

The existing `core/notifications/scheduler.py` uses APScheduler with a SQLAlchemy job store. We have two options:

**Option A**: Use APScheduler directly — add our cron-check as an APScheduler interval job that runs every 15 minutes and scans `coach_scheduled_jobs`.

**Option B**: Use a simpler approach — a standalone async task started at app startup that runs `asyncio.sleep(900)` in a loop and scans the table.

Recommendation: **Option A** — reuse the existing scheduler infrastructure. The cron worker is just one more APScheduler job:

```python
scheduler.add_job(
    process_due_coach_jobs,
    trigger="interval",
    minutes=15,
    id="coach_job_processor",
)
```

## Temporal awareness: message timestamps

Every message (user and assistant) gets a `ts` field stored in the DB as ISO 8601 UTC. At LLM-call time, timestamps are converted to the user's timezone and prepended to message content, giving the coach natural temporal awareness — like reading a WhatsApp chat with timestamps.

**In the DB:**
```json
{"role": "user", "content": "Hey", "platform": "discord_dm", "ts": "2026-04-25T13:42:00Z"}
{"role": "assistant", "agent": "coach", "content": "Hey! How's it going?", "ts": "2026-04-25T13:42:08Z"}
{"role": "user", "content": "Actually I had a question", "platform": "discord_dm", "ts": "2026-04-27T08:15:00Z"}
```

**What the LLM sees (user TZ: Europe/Amsterdam):**
```
user: [Thu Apr 25, 3:42 PM] Hey
assistant: [Thu Apr 25, 3:42 PM] Hey! How's it going?
user: [Sat Apr 27, 10:15 AM] Actually I had a question
```

**What this gives the coach for free:**
- Current date/time (from the latest message timestamp)
- Time gaps ("two days passed since last message")
- Conversation pacing ("user responded in seconds" vs "user came back after a week")
- Day boundaries and time-of-day awareness ("good morning" vs "good evening")

**Implementation**: The `ts` field is added at message creation time by the dispatcher (`datetime.now(timezone.utc)`). The timezone conversion + prepending happens in `_strip_custom_keys()` (or equivalent), which already processes messages before sending to the LLM. The `ts` key is stripped like `agent` and `platform` — only the prepended text reaches the LLM.

**User timezone**: Read from `users.timezone` (IANA string, e.g., `"Europe/Amsterdam"`). If not set, fall back to UTC with a note in the format: `[Sat Apr 27, 10:15 AM UTC]`.

## Per-turn context injection

In addition to timestamps on messages, a small programmatic context block is injected into the message array to give the coach ambient awareness of the user's course state. This is NOT about time (timestamps handle that) — it's about platform state that changes outside the conversation.

The block is injected as a system-role message near the end of the message array (exact placement relative to the user message to be determined during implementation).

```
Progress: 12/30 lenses (40%) — working on Module 2: Risks from AI
Next meeting: Meeting 4, Thu Apr 28 at 2:00 PM (in 3 days)
Last studied: 2 days ago
```

**Key properties:**
- **~50 tokens**: Minimal overhead per turn.
- **Computed fresh every turn**: SQL queries, no LLM calls.
- **No date/time**: Timestamps on messages already handle temporal awareness.
- **Authoritative**: The coach trusts this for current platform state.

**What's NOT included** (available via tool call if needed):
- Detailed per-module breakdown (use `get_my_progress` tool)
- Full meeting schedule (use `get_my_upcoming_deadlines` tool)

This mirrors how the existing tutor injects course context programmatically via `_build_system_prompt()`.

## Coach system prompt update

The base coach prompt (shared, hardcoded) needs to be updated to:

1. Reference the per-user files and explain their purpose
2. Document the available tools and when to use them
3. Include memory policy guidance (explicit/confirmed)
4. Include scheduling guidance

Key additions to the coach system prompt:

```
## Your tools
You have these tools available:

### Memory tools
- read_file(filename) — read agent_style.md, user.md, or memory.md
- edit_file(filename, old_string, new_string) — surgical find-and-replace within a file
- append_memory(note) — add a timestamped note to memory.md

### Course tools
- get_my_progress() — see the user's course completion status
- get_my_upcoming_deadlines() — see upcoming meetings and what's due

### Scheduling tools
- schedule_reminder(fire_at, reason) — schedule a future check-in
- list_my_reminders() — show pending reminders
- cancel_reminder(job_id) — cancel a scheduled reminder

## Memory guidelines
- When the user tells you something worth remembering, ask: "Want me to note that?"
- Use append_memory for running observations. Use edit_file for curated profile updates.
- Confirm with the user before editing agent_style.md or user.md.
- Keep memory.md focused — don't note every detail of every conversation.

## Scheduling guidelines
- Offer to schedule check-ins when it feels natural ("Want me to nudge you tomorrow?")
- Don't schedule reminders the user didn't ask for
- When a scheduled job fires, you have full context and judgment — decide whether
  to actually message the user based on their current state
```

## Error handling

| Failure | Response |
|---|---|
| Tool execution fails (DB error, etc.) | Return error message as tool result; LLM sees it and can apologize to user |
| `edit_file` with unknown filename | Return error: "Unknown file. Valid files: agent_style.md, user.md, memory.md" |
| `edit_file` where `old_string` not found | Return error: "Text not found in {filename}. Read the file first to see current content." |
| `edit_file` where `old_string` matches multiple times | Return error: "Ambiguous match — text appears multiple times. Use a longer old_string for a unique match." |
| `memory.md` exceeds soft limit (e.g., 10k chars) | Tool returns warning: "Memory is getting long (X chars). Consider asking the user if you should clean it up." |
| `schedule_reminder` exceeds per-user job limit | Return error: "You have 20 pending reminders. Cancel some before scheduling more." |
| `schedule_reminder` with past fire_at | Return error: "Can't schedule in the past." |
| Cron worker: LLM call fails for a job | Retry once after 5 min; then mark `failed`, log to Sentry |
| Cron worker: send_dm fails | Mark job `failed`, log to Sentry. Don't retry DM (user might have blocked the bot). |
| User not enrolled (progress/deadlines tools) | Return friendly message: "You're not enrolled in an active cohort yet." |

## Testing strategy

### Unit tests (mock LiteLLM, mock DB where needed)

- `test_user_files.py`: load creates three empty files, load returns existing, save persists, unknown filename rejected
- `test_memory_tools.py`: read_file returns content, write_file replaces, append_memory appends with timestamp, soft limit warning
- `test_progress_tools.py`: formats progress correctly, handles unenrolled user, handles empty progress
- `test_scheduling_tools.py`: schedule_reminder creates job, list returns pending, cancel updates status, rate limits enforced
- `test_dispatcher_tools.py`: non-transfer tool calls trigger execution and loop, MAX_TOOL_ROUNDS enforced, tool_choice=none on final round

### Integration tests (real DB)

- Full flow: user messages → coach calls get_my_progress → coach responds with progress info
- Full flow: user asks "remind me tomorrow" → coach calls schedule_reminder → job created in DB
- Cron worker: seed a due job → worker fires → LLM called → DM sent (mock send_dm)

### Manual test

- DM the bot, have a conversation
- Say "remember that I study best in the mornings" → verify memory.md updated
- Ask "how am I doing in the course?" → verify progress tool fires
- Ask "remind me tomorrow at 9am to study" → verify job created
- Wait for job to fire (or manually trigger) → verify DM received

## Explicitly out of scope

- **Automated memory extraction** (Mem0-style) — explicit/confirmed only for now
- **Memory compaction / summarization** — manual only ("clean up your notes")
- **Event-driven nudges routed through coach** — the existing notification system stays as-is; routing events through the coach is Phase 3
- **System announcement parsing** — future
- **Subscribable event hooks** — future
- **External integrations** (user's calendar, etc.) — future
- **Web UI for memory transparency** ("what do you know about me?") — future
- **Tutor/coach shared user.md** — future (the schema supports it, the dispatcher doesn't handle it yet)
- **Vector search over memory** (pgvector) — not needed at current scale
- **Pre-baked conditional reminders** — optimization for later based on observed patterns
- **Course content search tool** for the tutor — Phase 3

## Key uncertainties

1. **Progress tool data quality**: `get_completed_content_ids` returns UUIDs. Cross-referencing with course structure requires loading the course via `load_course()`. Need to verify this works cleanly and produces a readable summary. The course loader may need a stable `course_slug` — need to check if there's a default or if the user's cohort determines the course.

2. **Meeting dates and "due by" mapping**: `get_meeting_dates_for_user()` returns meeting numbers → dates. `get_due_by_meeting()` maps modules to meeting numbers. Need to verify these compose cleanly for the deadlines tool.

3. **APScheduler job ID management**: The existing scheduler uses structured job IDs (e.g., `meeting_{id}_reminder_{type}`). Our coach jobs need a compatible ID scheme that doesn't collide.

4. **Cron worker and bot instance**: The cron worker needs to call `send_dm`, which requires the Discord bot instance to be initialized. This works in the unified server (`main.py` runs both FastAPI and the bot), but needs verification that the bot is available at cron-worker time.

5. **Dispatcher refactor scope**: Adding non-transfer tool execution to the dispatch loop is the riskiest change. It touches load-bearing code. The existing Phase 1 tests must continue passing after the refactor.

## Future work (noted from brainstorming)

These are explicitly called out as next phases:

1. **Event-driven nudges through the coach** — instead of template emails for "meeting in 2 days", route the event through the user's coach, which personalizes the message based on their context. Replaces the existing dumb notification templates.
2. **System announcements parsed by coaches** — admin posts "new course available", each user's coach evaluates relevance and sends a personalized DM if appropriate.
3. **Subscribable event hooks** — coaches can subscribe to event tags; when a matching event fires, the coach evaluates and potentially notifies.
4. **Tutor/coach shared files** — `user.md` and `memory.md` shared between the coach and tutor agents, with separate `agent_style.md` per agent.
5. **Web UI for memory** — render per-user files as editable textareas at `/coach/memory`.
6. **Pre-baked conditional reminders** — optimization: for common patterns like "no progress in 24h", pre-write the message and skip the LLM call at fire time.
7. **Automated memory management** — periodic compaction, Mem0-style extraction, memory search via pgvector.
