# Phase 6: Chat Evaluation - Context

**Gathered:** 2026-02-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Facilitator-only evaluation workbench for loading chat conversation fixtures, editing system prompts, regenerating AI tutor responses, and continuing conversations interactively to iterate on prompt quality. Assessment evaluation is Phase 7.

</domain>

<decisions>
## Implementation Decisions

### Conversation display & interaction
- Reuse existing chat bubble pattern (student/tutor messages) — extract ChatMarkdown from NarrativeChatSection.tsx into shared component first
- Facilitator clicks any AI message to select it for regeneration
- Messages after the selected point are dimmed/collapsed (they'll be replaced by the regeneration)
- After regeneration, facilitator can type follow-up messages as the student via text input at bottom (same pattern as student chat, minus voice recording)

### Prompt editing experience
- Two-panel layout: prompt editor on left, conversation on right (side-by-side, not stacked)
- Monospace textarea/code editor for system prompt — no syntax highlighting (it's natural language)
- Flow: load fixture → conversation on right → edit prompt on left → select message → "Regenerate" → new response streams in
- Single explicit "Regenerate" button (no auto-regenerate on prompt change)
- No prompt versioning or saving — this is a scratchpad for iteration
- Reset button to restore original system prompt from the fixture

### Comparison & chain-of-thought
- After regeneration, original AI message appears collapsed/dimmed directly above the new response — inline in the conversation, not a separate panel
- Facilitator can expand the original to compare
- Chain-of-thought: collapsible "Show reasoning" toggle below each regenerated message
- CoT collapsed by default, one click to reveal
- Only regenerated messages show comparison/CoT — original messages stay clean

### Fixture browsing & selection
- Simple list view as initial screen or left panel before fixture is loaded
- Each fixture shows name and module
- Filter/search by module name (dropdown or text filter)
- Loading a fixture replaces the current conversation (no multi-tab)
- Empty state: instructions on how fixtures are added (JSON files in repo)

### Claude's Discretion
- Exact editor component choice (textarea vs CodeMirror vs similar)
- Loading skeleton design and transitions
- Exact spacing, typography, and color choices
- Error state handling (failed regeneration, network issues)
- How the "select message for regeneration" interaction is styled (highlight, border, button placement)

</decisions>

<specifics>
## Specific Ideas

- Chat rendering should feel familiar — same bubble pattern facilitators already see in student chats
- This is an internal facilitator tool: minimal chrome, maximum utility
- Prompt Lab calls stream_chat() directly via core/promptlab/ — does not modify chat.py or scoring.py

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-chat-evaluation*
*Context gathered: 2026-02-20*
