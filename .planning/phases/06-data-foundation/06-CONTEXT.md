# Phase 6: Data Foundation - Context

**Gathered:** 2026-02-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Backend tables, API endpoints, and content parsing for assessment data. Provides the foundation that Phases 7-9 build on. The frontend components (answer box UI, test section UX) are NOT in this phase — only the data layer and content parsing.

</domain>

<decisions>
## Implementation Decisions

### Content block types in markdown
- Activities are content blocks using `#### Heading` with `key:: value` properties (same pattern as existing content types like Text, Article-excerpt, Chat)
- **`#### Question`** — free-text response activity (replaces "Textbox" / "Answer Box" naming)
- **`#### Chat: [title]`** — interactive conversation activity (already exists, extended with assessment)
- **`#### Text`** — static display text (already exists)
- These blocks appear both inline in Lenses AND inside `## Test:` sections in Learning Outcomes

### Question block properties
```markdown
#### Question
max-time:: 3:00          %% time limit, "none" for no limit (default) %%
max-chars:: 1000         %% character limit %%
enforce-voice:: true     %% require voice input, false by default %%
user-instruction::
What's the difference between x and y?

assessment-prompt::
Give the user a score based on dimensions j and k.
```
- `user-instruction::` — the prompt shown to the student
- `assessment-prompt::` — rubric for AI scoring, lives in the markdown alongside the question
- `max-time::`, `max-chars::`, `enforce-voice::` — optional constraints

### Chat block properties
```markdown
#### Chat: Discussion on X-Risk
instructions::
[System instructions for the chat AI, including context and discussion topics]
```

### Test sections in Learning Outcomes
- `## Test:` heading in Learning Outcome files contains Question/Chat/Text blocks
- Questions inside a Test section inherit the learning outcome from their parent LO file
- Test sections appear at the end of modules (decided in v2.0 requirements)

### All questions are internally assessed
- Even "practice" questions inline in Lenses get AI assessment internally
- The user doesn't necessarily know which questions are "tests" vs "practice"
- The platform uses all responses to measure learning progress over time

### Response storage
- Each response is a separate record (supports multiple attempts over days/weeks/months)
- Answer and assessment stored together per response
- Schema will evolve significantly — keep it flexible with JSONB, don't over-engineer
- Minimal initial schema: user, question reference, answer text, timestamp, assessment result

### Schema flexibility
- JSONB for assessment scores (already decided)
- Expect schema changes as Phases 7-9 reveal what's needed
- Question identification mechanism (UUID vs derived) deferred until markdown format and UI are more concrete

### Claude's Discretion
- Database table design and relationships
- API endpoint structure and response shapes
- Content parser implementation approach
- Migration strategy
- How to handle malformed or missing test content

</decisions>

<specifics>
## Specific Ideas

- Content format follows existing Obsidian patterns: `#### Type` headings with `key:: value` properties and `%% comments %%`
- Lenses have frontmatter with `id:`, `tags:` (including `lens`, `work-in-progress`)
- Lenses use `### Page` for page breaks, `### Article: [title]` for article sections with `source:: [[link]]`
- Article-excerpt blocks use `to:: "exact quote"` to define excerpt boundaries
- The user provided detailed markdown examples showing the full content authoring format (see discussion)

</specifics>

<open>
## Open Design Questions

These came up during discussion but need UX iteration before deciding:

- **Question identification:** UUID in markdown vs derived from structure — depends on how content sync works in practice
- **Test context tagging:** Need to distinguish beginning-of-module tests, end-of-module tests, and spaced-repetition retests for filtering — format TBD
- **LO linkage for inline questions:** How questions in Lenses link to learning outcomes (explicit tag vs structural inference)
- **Chat-about-answer pattern:** After answering a Question, should follow-up chat be a property (`chat-about-answer:: true`) or a separate `#### Chat` block? Leaning toward separate block for consistency, but needs UX validation
- **Response metadata:** Time tracking, voice-used flag — useful for analysis but not needed in initial schema

</open>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 06-data-foundation*
*Context gathered: 2026-02-14*
