# Domain Pitfalls: Prompt Lab Evaluation Workbench

**Domain:** Adding LLM prompt evaluation/playground tool to an existing educational platform
**Researched:** 2026-02-20
**Primary concerns:** Over-engineering, production safety, fixture management, cross-workspace conflicts

---

## Critical Pitfalls

Mistakes that cause rewrites, production incidents, or significant wasted effort.

### Pitfall 1: Prompt Override Leaking into Production

**What goes wrong:** The Prompt Lab lets facilitators edit system prompts to test variations. If the architecture shares any mutable state with the production chat path, an edited prompt could accidentally affect real student conversations.

**Why it happens:** The existing `_build_system_prompt()` in `core/modules/chat.py` constructs prompts inline from hardcoded strings and stage data. A naive approach adds an `override_prompt` parameter that threads through the same code path, or stores overrides in a shared location (environment variable, global dict) that production code also reads. The functions in `chat.py` look reusable -- a developer thinks "I'll just add an eval_mode flag" to avoid duplicating code.

**Consequences:** Students receive experimental prompts during real learning sessions. Since there is no logging of which prompt was used per-conversation in production, the issue could go undetected for days. Additionally, the Prompt Lab inherits unwanted behavior (transition tools, session persistence, stage-based context) that makes evaluation results misleading.

**Prevention:**
- Prompt Lab must NEVER call `send_module_message()` or `_build_system_prompt()` directly. Create a separate function (e.g., `replay_with_prompt()`) in a new `core/promptlab/chat_eval.py` that calls `stream_chat()` from `core/modules/llm.py` directly, bypassing the production prompt construction entirely.
- The Prompt Lab receives the full prompt text from the frontend and passes it through to the LLM layer. The production prompt builder is never involved.
- Route the Prompt Lab API through a separate router (`/api/promptlab/...`) with facilitator auth, completely separated from `/api/chat/module`.
- No shared mutable state: no global variables, no environment variable overrides, no database rows that production reads.
- Accept the ~10 lines of "duplication" in assembling the LLM call -- the parameters are intentionally different between production and evaluation.

**Detection:** If any Prompt Lab code imports from or calls `core/modules/chat.py`, it is wrong. If you find yourself adding `if eval_mode:` branches to `chat.py` or `module.py`, stop. The only shared import should be `core/modules/llm.py` (the low-level LLM abstraction).

**Roadmap phase:** Phase 1 (foundation/architecture). Must be established before any feature code.

---

### Pitfall 2: Accidentally Persisting Eval Data as Real Student Data

**What goes wrong:** Using the existing `get_or_create_chat_session()` + `add_chat_message()` pattern for Prompt Lab conversations, which writes to the `chat_sessions` table. Similarly, using `submit_response()` from `core/assessments.py` for assessment evaluation, which writes to the `assessment_responses` table.

**Why it happens:** The patterns are familiar and readily available. The developer reuses them without thinking about data integrity. The `chat_sessions` table's JSONB `messages` column looks like a convenient place to store eval conversations.

**Consequences:** Facilitator eval conversations appear in student chat history. Facilitator progress data gets corrupted. Facilitator's "play student" messages show up in analytics. Data integrity violation that is hard to detect and even harder to clean up (requires manual database surgery to identify and remove eval data mixed with production data).

**Prevention:**
- Prompt Lab endpoints must NOT write to `chat_sessions`, `user_content_progress`, `assessment_responses`, or `assessment_scores` tables.
- All Prompt Lab state is frontend-only (React state). No database writes. No background tasks.
- Verify this in code review by grepping for table imports in `core/promptlab/` and `web_api/routes/promptlab.py`.

**Detection:** If `core/promptlab/` imports from `core/modules/chat_sessions.py` or `core/assessments.py` for WRITE operations, that is a red flag. READ operations for fixture extraction (one-time, manual) are acceptable but should happen outside the Prompt Lab code path.

**Roadmap phase:** Phase 1 (architecture). Enforce as a hard rule from the start.

---

### Pitfall 3: Over-Engineering Automated Metrics When Manual Review Is the Goal

**What goes wrong:** The team builds automated scoring metrics, comparison dashboards, statistical significance tests, or LLM-as-judge pipelines when the actual need is for a human facilitator to read 5-15 conversations and form a qualitative judgment about prompt quality.

**Why it happens:** LLM evaluation tooling (Promptfoo, Braintrust, LangSmith) is designed for scale -- hundreds or thousands of test cases with automated metrics. These tools set expectations about what an "evaluation workbench" should look like. Engineers default to what they have seen in the ecosystem rather than what the use case requires. The PROJECT.md explicitly lists "Automated prompt optimization," "Batch evaluation with metrics/dashboards," "LLM-as-judge automated scoring," and "Side-by-side comparison UI" as OUT OF SCOPE.

**Consequences:** Weeks spent building infrastructure that does not get used. The facilitator only has 5-15 test conversations. At this scale, reading them is faster than configuring automated metrics. The complexity also raises the barrier to entry for facilitators who just want to try a prompt tweak.

**Prevention:**
- The evaluation UX is: read a conversation, form an opinion, try a different prompt, read again. No scores, no metrics, no dashboards in v3.0.
- For assessment evaluation: the only "metric" is the human looking at the AI's score output (overall_score, reasoning, dimensions) and comparing it to their own judgment. No inter-rater reliability calculations, no automated aggregation.
- Resist the urge to add a "score this response" button, a comparison matrix, or any aggregation. If facilitators want to track their observations, they can take notes externally.
- If automated metrics become needed later, they should be a separate milestone with their own research phase.

**Detection:** Ask: "Does this feature help a facilitator READ and JUDGE a conversation?" If no, it is scope creep.

**Roadmap phase:** All phases. This is a design constraint, not a feature. Revisit in every phase review.

---

### Pitfall 4: Fixture Data Containing PII from Production

**What goes wrong:** Conversation fixtures extracted from the production `chat_sessions` table contain student names, email references, personal anecdotes, or other personally identifiable information. These fixtures are committed to the repo (per PROJECT.md constraint: "Fixtures stored as JSON in repo"), making PII visible to anyone with repo access and version-controlled permanently.

**Why it happens:** The `chat_sessions.messages` JSONB column stores raw conversation text. Students often mention personal details during AI safety discussions (e.g., "As a ML engineer at [Company]...", "My name is...", "I'm based in..."). Bulk extraction without review will capture this.

**Consequences:** GDPR/privacy violation. Even if the repo is private, storing PII in version-controlled fixture files means it persists in git history forever (even after deletion). The platform handles user data from an international cohort.

**Prevention:**
- Extraction is manual via Claude Code (per PROJECT.md: "Manual extraction via Claude Code"). This is correct -- do NOT build an automated extraction pipeline.
- Create an extraction checklist:
  1. Select conversations that demonstrate interesting tutor behavior, not conversations with interesting student content.
  2. Before committing, review every message in the fixture for PII.
  3. Replace any PII with plausible fake data (names, locations, companies).
  4. Use generic student identifiers (e.g., "student_01") not real user IDs or anonymous tokens.
- Never include `user_id`, `anonymous_token`, `session_id`, or `content_id` from production in fixture files. Assign synthetic IDs.
- Fixture format should strip database metadata entirely -- just the conversation messages, module slug, section context, and stage instructions.

**Detection:** Pre-commit review of any file in the fixtures directory. Grep for email patterns, Discord usernames, and known student names before committing.

**Roadmap phase:** Phase 1 (fixture extraction). Must be done carefully before building any UI.

---

### Pitfall 5: Not Capturing Full Prompt Context in Fixtures

**What goes wrong:** The Prompt Lab shows the system prompt as an editable text field, but the actual prompt sent to the LLM in production includes more context than just the system prompt -- specifically, the `previous_content` (article text, video transcript) that gets appended. The facilitator edits the system prompt but has no visibility into what content was included, so their evaluation is incomplete.

**Consequences:** A facilitator thinks they are testing "the prompt" but they are actually testing the prompt WITHOUT the 2000-word article that was included in production. Their evaluation results do not reflect production behavior.

**Why it happens:** Looking at `_build_system_prompt()` in `core/modules/chat.py`:
```python
if not current_stage.hide_previous_content_from_tutor and previous_content:
    prompt += f"\n\nThe user just engaged with this content:\n---\n{previous_content}\n---"
```
The `previous_content` is article/video text gathered by `gather_section_context()`. This is a dynamic, large block of text that is NOT part of the "system prompt" in the facilitator's mental model -- it is injected context.

**Prevention:**
- Fixtures must capture the FULL prompt context at extraction time. Store these as separate fields in the fixture JSON:
  - `base_system_prompt`: The hardcoded base prompt from `chat.py`
  - `instructions`: The per-chat-stage `instructions::` from content markdown
  - `previous_content`: The article/video text that was injected
  - `messages`: The conversation history
- The Prompt Lab UI should show: (1) editable system prompt / instructions, (2) read-only content context (collapsible, since it can be long), (3) the conversation messages.
- When replaying, construct the full prompt from all components, not just the editable part.
- Consider a "Show what was sent to the LLM" toggle that displays the exact assembled prompt.

**Detection:** Compare a replayed Prompt Lab response against the same conversation's original production response. If they differ significantly with the "same" prompt, context is likely missing.

**Roadmap phase:** Phase 1 (fixture format design) and Phase 2 (chat replay UI).

---

### Pitfall 6: SSE Streaming State Corruption When Regenerating Mid-Conversation

**What goes wrong:** In the Prompt Lab, the facilitator can regenerate an AI response from any point in a conversation (not just the end). If a regeneration request is sent while a previous SSE stream is still active, the frontend receives interleaved chunks from two different responses, corrupting the displayed text.

**Why it happens:** The existing `sendMessage()` in `api/modules.ts` uses `fetch()` with a ReadableStream reader. There is no abort mechanism -- no `AbortController` is wired up. In production this is fine because students send one message at a time and wait. In the Prompt Lab, rapid iteration means: click "regenerate," realize you want a different prompt, click "regenerate" again before the first one finishes.

**Consequences:** Garbled text in the chat display mixing tokens from two responses. Potential state inconsistency if the Prompt Lab tries to accumulate the "assistant response" -- it might concatenate a partial response from the first stream with the second.

**Prevention:**
- Use `AbortController` on every SSE request. Before sending a new regeneration request, abort the previous one.
- The Prompt Lab's SSE handler should track the current request ID (a simple counter or timestamp). When processing incoming chunks, ignore any that do not match the current request.
- Do NOT save Prompt Lab regenerated responses to the database. Keep them in frontend state only. This eliminates the "partial save" corruption issue entirely.
- Handle the `{"type": "done"}` event carefully -- only update state if the request ID matches.
- Add a simple debounce on the "Regenerate" button (disable for 2 seconds after click) to prevent accidental double-clicks.

**Detection:** Test by clicking "regenerate" twice rapidly. If the second click does not abort the first stream, this bug exists.

**Roadmap phase:** Phase 2 (chat replay with streaming). Must be addressed in the SSE implementation, not bolted on later.

---

## Moderate Pitfalls

### Pitfall 7: Cross-Workspace Merge Conflicts with ws3

**What goes wrong:** ws3 is building v2.0 (Tests & Answer Boxes) in parallel. Both workspaces modify overlapping files. When changes are merged to `main`/`staging`, conflicts arise that are tedious to resolve and risk introducing bugs.

**Specific conflict zones identified by diffing ws2 and ws3:**

| File | ws3 Changes | ws2 Prompt Lab Risk |
|------|-------------|---------------------|
| `core/modules/llm.py` | Added `complete()` function (37 lines) | Prompt Lab may need new LLM functions |
| `core/tables.py` | Added `assessment_responses` + `assessment_scores` tables (65 lines) | LOW risk -- Prompt Lab uses no new tables per Pitfall 10 |
| `main.py` | Added `assessments_router` import + include (2 lines) | Prompt Lab adds `promptlab_router` -- trivial merge |
| `web_frontend/src/views/Module.tsx` | Extensive changes for AnswerBox + TestSection | Prompt Lab must NOT modify Module.tsx |
| `web_frontend/src/types/module.ts` | Added test/question types | Prompt Lab types in separate files |
| `web_frontend/src/components/module/NarrativeChatSection.tsx` | Extracted `useVoiceRecording` hook, other changes | Prompt Lab chat is a separate component |
| `web_frontend/src/components/ModuleHeader.tsx` | Added `testModeActive` prop | No conflict -- Prompt Lab does not use ModuleHeader |
| `web_frontend/src/components/module/ModuleDrawer.tsx` | Test section integration | No conflict -- Prompt Lab does not use ModuleDrawer |
| `web_frontend/src/components/module/StageProgressBar.tsx` | Test stage type support | No conflict |

**Prevention:**
- Prompt Lab code should live in NEW files, not modify existing ones:
  - Backend: `core/promptlab/` (new directory), `web_api/routes/promptlab.py` (new file)
  - Frontend: `web_frontend/src/pages/promptlab/` (new page), `web_frontend/src/components/promptlab/` (new component directory), `web_frontend/src/api/promptlab.ts` (new API file)
- The only shared files that both ws2 and ws3 need to modify are:
  - `main.py` (adding router) -- trivial merge, just two different import+include lines
  - `core/modules/llm.py` (if Prompt Lab needs new LLM functions) -- ws3 already added `complete()`, Prompt Lab should reuse it or add functions at the bottom
- Do NOT modify `Module.tsx`, `NarrativeChatSection.tsx`, or any existing component. Build Prompt Lab as a self-contained page.
- Merge ws3 into main FIRST (it is further along: phases 6-10 complete, phase 11 remaining). Then start ws2/v3.0 work from a base that includes ws3 changes.

**Detection:** Before starting each phase, run `diff -rq` between ws2 and ws3/main to identify new conflict zones.

**Roadmap phase:** Pre-phase coordination. The merge ordering decision should be made before Phase 1 begins.

---

### Pitfall 8: Assessment Evaluation Depending on Unmerged ws3 Code

**What goes wrong:** The Prompt Lab has two evaluation modes: chat tutor replay and assessment scoring evaluation. The assessment mode needs the scoring infrastructure (`SCORE_SCHEMA`, `_build_scoring_prompt()`, `complete()`, `assessment_responses` and `assessment_scores` tables) that exists only in ws3. If ws2 tries to build assessment evaluation before ws3 is merged, it must either duplicate code or work against an incomplete foundation.

**Why it happens:** ws3's v2.0 is almost complete (10 of 11 phases done), but Phase 11 (Answer Feedback Chat) is still in progress. The natural impulse is to design the "complete" Prompt Lab with both modes before building anything, making the whole feature dependent on ws3.

**Consequences:** Chat eval (which has zero ws3 dependencies) gets blocked by assessment eval (which depends on ws3). Nothing ships until ws3 merges.

**Prevention:**
- Build chat tutor evaluation FIRST (no ws3 dependency). This is the higher-priority mode anyway.
- Build assessment evaluation SECOND, after ws3 is merged into main.
- In the roadmap, structure phases so chat replay is early and assessment evaluation is late.
- The frontend tab for "Assessment Eval" can show a "coming soon" placeholder in Phase 1.
- Keep the two modes in separate files: `ChatEval.tsx` / `AssessmentEval.tsx` on the frontend, `chat_eval.py` / `assessment_eval.py` on the backend.
- If assessment evaluation must start before ws3 merge: create fixture files that include pre-computed score data (extracted from production after ws3 scoring runs), so the Prompt Lab can display and compare scores without needing the scoring pipeline locally.

**Detection:** If Phase 1 has any imports from `core/scoring.py` or references `complete()`, the dependency has leaked.

**Roadmap phase:** Phase sequencing decision. Chat replay in early phases, assessment eval in later phases.

---

### Pitfall 9: Cognitive Overload in Human Evaluation UX

**What goes wrong:** The facilitator sees a conversation with 10+ messages, an editable system prompt, content context, and needs to form a judgment. With no structure, they either:
(a) Skim too fast and miss quality differences between prompt versions, or
(b) Try to evaluate every message individually and burn out after 2-3 conversations.

**Why it happens:** Human evaluation research consistently shows that reviewers experience fatigue and quality degradation after extended annotation sessions. With 5-15 conversations to review, each with 6-10 message exchanges, the total reading volume is significant. Without UX guidance on WHAT to look for, facilitators default to reading everything with equal attention.

**Consequences:** Low-quality evaluations that do not actually help improve prompts. Facilitators abandon the tool after initial novelty because it is exhausting to use.

**Prevention:**
- Keep the conversation display compact. Reuse the existing `ChatMarkdown` renderer style, not a verbose format.
- For chat replay: highlight the AI responses visually (they are what changes between prompt versions). Student messages are fixed -- they do not need equal visual weight.
- For assessment evaluation: show the score output (overall_score, reasoning, dimensions) prominently. The facilitator's main task is "does this score match my judgment?" not "read the entire scoring chain."
- Do NOT build side-by-side comparison in v3.0 (it is explicitly out of scope). Sequential review is less cognitively demanding than simultaneous comparison, and with only 5-15 test cases, the facilitator can remember their impression from the previous version.
- Limit session length implicitly: the tool works on small fixture sets (5-15), not unlimited data. Do not add pagination or infinite scroll patterns that encourage marathon sessions.

**Detection:** User test with a facilitator: can they evaluate 5 conversations in under 30 minutes without feeling overwhelmed?

**Roadmap phase:** Phase 2 (chat replay UI) and Phase 3 (assessment eval UI). UX design decisions.

---

### Pitfall 10: Building Database Storage for Prompt Lab State

**What goes wrong:** The team creates database tables for Prompt Lab experiments, prompt versions, evaluation results, or run history. This adds migration complexity, schema coupling with ws3's assessment tables, and maintenance burden -- all for a tool used by 2-3 facilitators.

**Why it happens:** The codebase pattern is "everything goes in PostgreSQL." The existing chat_sessions, assessment_responses, and assessment_scores tables set an expectation that new features need their own tables.

**Prevention:**
- Prompt Lab state lives in the FRONTEND only (React state) during a session.
- Fixtures live in the REPO as JSON files (per PROJECT.md constraint).
- Prompt versions/edits are NOT saved between sessions. The facilitator copies their prompt to a text file if they want to keep it. The Prompt Lab is a scratchpad, not a versioning system.
- If persistent prompt version tracking becomes needed later, it should be a future milestone with its own design. For v3.0, avoid database tables entirely.
- The only database interaction is READ-ONLY: extracting fixture data from production (done once, manually, by Claude Code).

**Detection:** Does any Prompt Lab code call `get_transaction()` or `conn.execute(insert(...))`? If yes, reconsider whether database storage is actually needed.

**Roadmap phase:** Phase 1 (architecture decision). Explicitly decide "no new tables" before building.

---

### Pitfall 11: Fixture Staleness After Content Updates

**What goes wrong:** Fixtures are extracted from production conversations tied to specific module content. When the content team updates an article or changes chat stage instructions in the Obsidian vault, the fixture's context no longer matches the current content. Replaying with the "current" prompt against stale fixture context produces misleading results.

**Why it happens:** Content is fetched from GitHub via the relay and can change at any time. The fixture captures a point-in-time snapshot but the article text, video transcript, and chat instructions are mutable upstream.

**Prevention:**
- Fixtures should capture ALL context at extraction time including metadata: `extracted_at` timestamp, `module_slug`, article/video source references, and optionally a content commit hash.
- Accept that fixtures are historical snapshots, not live data. The Prompt Lab documentation should make this clear: "You are replaying against the content as it was when this conversation happened."
- When content changes are significant (e.g., article rewritten), extract new fixtures rather than trying to update old ones.
- Do NOT build a live-content mode that fetches current articles. This creates a confusing hybrid where the student messages were written in response to content that no longer matches.
- Consider showing the current production prompt alongside the fixture's original prompt for comparison ("what production uses NOW" vs "what was used THEN").

**Detection:** If a replayed response makes references that do not match the fixture's content context, the content has likely changed.

**Roadmap phase:** Phase 1 (fixture format design). The fixture schema should account for this from the start.

---

## Minor Pitfalls

### Pitfall 12: Prompt Lab Auth Using Wrong Role Check

**What goes wrong:** The Prompt Lab requires facilitator access but the auth check uses the wrong mechanism. The existing `get_current_user` returns any authenticated user. The `facilitators` table exists but may not have a corresponding FastAPI dependency for checking facilitator status.

**Prevention:**
- Check that a `get_current_facilitator` or equivalent dependency exists, or create one that joins `users` to `facilitators`.
- The check should verify the user has a row in the `facilitators` table, not just that they are authenticated.
- If `is_admin` on the `users` table is the intended check instead, clarify with the user which role gates Prompt Lab access.
- Return 403 (not 404) for non-facilitators to be explicit about authorization failure.

**Roadmap phase:** Phase 1 (API foundation).

---

### Pitfall 13: Regenerating from Mid-Conversation Breaks Message Array Semantics

**What goes wrong:** When the facilitator clicks "regenerate from here" on message N in a 10-message conversation, the frontend must truncate messages N through 10, send messages 1 through N-1 to the LLM, and stream a new response. If the truncation logic is off by one, or if the user/assistant role alternation is broken, the LLM receives a malformed conversation.

**Prevention:**
- Messages in the fixture are a simple array. "Regenerate assistant response at position N" means: send `messages.slice(0, N)` where message N-1 is the user message that prompted the response.
- If the facilitator edited a user message at position N, send `messages.slice(0, N+1)` with the edited content at position N.
- Edge case: regenerating the very first assistant message means sending just the user's first message. Make sure this works with the system prompt construction.
- Edge case: system messages in the conversation (stage transition markers like `{"role": "system", ...}`). The existing `event_generator` filters these out with `if m["role"] in ("user", "assistant")`. The Prompt Lab must also filter them before sending to the LLM.

**Roadmap phase:** Phase 2 (chat replay implementation).

---

### Pitfall 14: Assessment Ground-Truth Calibration Is Subjective

**What goes wrong:** The Prompt Lab's assessment evaluation mode shows the AI's score alongside the facilitator's judgment. But facilitators disagree with each other about what score a student answer deserves. The tool presents a single human judgment as objective truth, creating false confidence in the assessment prompt's accuracy.

**Why it happens:** Inter-rater reliability research shows that human evaluators achieve only moderate agreement on subjective assessments (Krippendorff's alpha 0.4-0.6 for educational scoring). A single facilitator's judgment is not ground truth -- it is one data point. Studies show that for sarcasm detection, both humans and LLMs struggled with low inter-rater reliability (alpha = 0.25).

**Prevention:**
- Do NOT label the human judgment as "ground truth" or "correct score" in the UI. Label it as "your assessment" or "facilitator score."
- The goal is not "does the AI match the human?" but "does the AI's reasoning make sense?" Focus the UI on displaying the AI's chain-of-thought reasoning, not just the numeric score.
- If multiple facilitators use the tool, their different judgments on the same answer are valuable data about scoring subjectivity, not errors to resolve.
- Do not build calibration workflows, inter-rater reliability calculations, or consensus mechanisms in v3.0. These are future research concerns.

**Roadmap phase:** Phase 3 (assessment evaluation UI). Labeling and framing decisions.

---

### Pitfall 15: LLM Cost Surprise from Prompt Lab Usage

**What goes wrong:** Each "regenerate" in the Prompt Lab makes a real LLM API call. A facilitator iterating rapidly on prompts across 15 fixtures could make 100+ LLM calls in a session. With long article contexts (2000+ words per fixture), token costs add up.

**Prevention:**
- This is a minor risk given the small scale (5-15 fixtures, 2-3 facilitators). At roughly $0.003/1K input tokens for Claude Sonnet, even aggressive usage would cost under $5/day.
- Consider supporting cheaper/faster models for iteration (e.g., Haiku for quick checks, Sonnet for quality evaluation). The `provider` parameter in `stream_chat()` already supports this via the `LLM_PROVIDER` environment variable.
- A simple request counter in the frontend (displayed, not enforced) helps facilitators stay aware of usage.

**Roadmap phase:** Phase 2 (chat replay). Model selection UI.

---

### Pitfall 16: Frontend State Loss on Tab Switch

**What goes wrong:** Facilitator edits a prompt, regenerates, starts following up as student, then switches browser tabs. When they return, the React state (edited prompt, regenerated messages, follow-up conversation) might be lost if the component unmounts.

**Prevention:** This is acceptable for MVP (the tool is ephemeral by design). If it becomes a pain point, add `localStorage` persistence for the current eval session state. Do NOT add database persistence -- that creates the coupling problems described in Pitfalls 2 and 10.

**Roadmap phase:** Post-MVP polish, if needed.

---

### Pitfall 17: SSE Connection Dropping During Long Regenerations

**What goes wrong:** The SSE streaming connection for chat regeneration drops after 30-60 seconds on some proxies/load balancers (Railway, Cloudflare), silently truncating the AI response.

**Prevention:** Set `max_tokens=2048` (not unlimited) to keep responses bounded. Consider sending periodic heartbeat events (`data: {"type": "heartbeat"}\n\n`) every 15 seconds during streaming to keep the connection alive. The existing `module.py` streaming does not have heartbeats because student responses are short (~1024 tokens), but eval responses might be longer if facilitators use higher max_tokens settings.

**Roadmap phase:** Phase 2 (streaming implementation).

---

### Pitfall 18: .planning/ Files Creating Merge Conflicts

**What goes wrong:** Both ws2 and ws3 have `.planning/` directories with research, roadmaps, and state files. When branches merge, these planning files conflict because both workspaces update `PROJECT.md`, `STATE.md`, and `MILESTONES.md`.

**Prevention:**
- Accept that `.planning/` merge conflicts are cosmetic, not code-breaking. Resolve them by taking the latest version (the workspace merging second has the most current state).
- Never let `.planning/` merge conflicts block a code merge. Resolve planning files separately from code files.
- Consider whether `.planning/` should even be committed to main. If it is workspace-local documentation, it could stay on feature branches only.

**Roadmap phase:** Pre-phase. Decide `.planning/` merge strategy before starting.

---

### Pitfall 19: Assessment Eval Calling enqueue_scoring() Instead of complete() Directly

**What goes wrong:** The Prompt Lab's assessment evaluation mode needs to call the LLM and return the score to the UI synchronously. But the production scoring path uses `enqueue_scoring()` which is fire-and-forget (writes to the database in a background task and never returns the result to the caller).

**Why it happens:** `enqueue_scoring()` in `core/scoring.py` is designed for production use where the score is stored for later retrieval. The Prompt Lab needs the score returned immediately to display in the UI.

**Prevention:** The Prompt Lab assessment eval should call `complete()` directly from `core/modules/llm.py` (the non-streaming LLM function that ws3 added), build its own prompt using the fixture's scoring context, and return the parsed JSON score to the frontend. Do NOT import `enqueue_scoring()`. The prompt construction can reference `_build_scoring_prompt()` for the format but should be a separate function in `core/promptlab/assessment_eval.py`.

**Detection:** If Prompt Lab code imports `enqueue_scoring`, it will either not get results (fire-and-forget) or will try to read from the database (writing eval data to production tables).

**Roadmap phase:** Phase 3 (assessment evaluation).

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Fixture extraction | PII in conversation data (Pitfall 4) | Manual review, synthetic IDs, PII checklist |
| Fixture format design | Missing context fields (Pitfall 5) | Capture system prompt + instructions + content + metadata separately |
| Fixture format design | Staleness not tracked (Pitfall 11) | Include extracted_at timestamp and content identifiers |
| API/architecture setup | Prompt override leaking to production (Pitfall 1) | Separate module, separate router, no shared mutable state |
| API/architecture setup | Persisting eval data as student data (Pitfall 2) | No writes to production tables, frontend-only state |
| API/architecture setup | Database tables for eval state (Pitfall 10) | Frontend-only state, repo-only fixtures, no new tables |
| API/architecture setup | Auth role check (Pitfall 12) | Verify facilitator role, not just authenticated user |
| Chat replay UI | SSE state corruption on regenerate (Pitfall 6) | AbortController, request ID tracking, debounce button |
| Chat replay UI | Mid-conversation truncation bugs (Pitfall 13) | Careful message array slicing, role alternation validation |
| Chat replay UI | Cognitive overload (Pitfall 9) | Compact display, highlight AI responses, small fixture sets |
| Chat replay UI | SSE connection timeout (Pitfall 17) | Bounded max_tokens, heartbeat events |
| Assessment eval UI | Ground-truth framing (Pitfall 14) | Label as "your assessment," focus on reasoning display |
| Assessment eval UI | ws3 dependency (Pitfall 8) | Build after ws3 merge, or use pre-computed score data |
| Assessment eval UI | Using enqueue_scoring() (Pitfall 19) | Call complete() directly, return score to frontend |
| Cross-workspace | Merge conflicts with ws3 (Pitfall 7) | New files only, merge ws3 first, avoid modifying shared files |
| Cross-workspace | .planning/ file conflicts (Pitfall 18) | Treat as cosmetic, resolve by taking latest |
| All phases | Over-engineering metrics (Pitfall 3) | Constant constraint: "does this help READ and JUDGE?" |
| All phases | LLM cost (Pitfall 15) | Low risk at current scale, model selection, usage counter |

## Sources

- [Avoiding Common Pitfalls in LLM Evaluation](https://www.honeyhive.ai/post/avoiding-common-pitfalls-in-llm-evaluation) -- evaluation metric selection mistakes
- [LLM Evaluation 101 - Langfuse](https://langfuse.com/blog/2025-03-04-llm-evaluation-101-best-practices-and-challenges) -- human-in-the-loop evaluation best practices
- [Demystifying Evals for AI Agents - Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) -- starting with narrow evals, avoiding over-engineering
- [Inter-Rater Reliability between LLMs and Human Raters](https://arxiv.org/abs/2508.14764) -- human agreement limitations on subjective scoring
- [Can You Trust LLM Judgments?](https://arxiv.org/html/2412.12509v2) -- calibration challenges, verbosity bias
- [LiteLLM Scrub Data Docs](https://docs.litellm.ai/docs/observability/scrub_data) -- PII scrubbing in LLM pipelines
- [Minimize Cognitive Load - NN/g](https://www.nngroup.com/articles/minimize-cognitive-load/) -- UX cognitive load principles
- [Clash - Merge conflict management for parallel AI agents](https://github.com/clash-sh/clash) -- parallel workspace conflict detection
- Codebase analysis: `core/modules/chat.py` (prompt construction), `core/modules/llm.py` (LLM abstraction), `core/scoring.py` (ws3 scoring pipeline), `web_api/routes/module.py` (SSE streaming), `core/tables.py` (schema), `core/modules/chat_sessions.py` (session persistence)
- Cross-workspace diff: `diff -rq ws2/ ws3/` identifying 15+ divergent files across backend and frontend
