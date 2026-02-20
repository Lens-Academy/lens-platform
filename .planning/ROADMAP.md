# Roadmap: AI Safety Course Platform

## Milestones

- v1.0 Mobile Responsiveness - Phases 1-5 (shipped 2026-01-22)
- **v3.0 Prompt Lab** - Phases 6-7 (in progress)

## Phases

<details>
<summary>v1.0 Mobile Responsiveness (Phases 1-5) - SHIPPED 2026-01-22</summary>

See `.planning/milestones/v1.0-ROADMAP.md` for full details.

5 phases, 13 plans, 29 requirements completed.

</details>

### v3.0 Prompt Lab (In Progress)

**Milestone Goal:** Build a facilitator-only evaluation workbench for iterating on AI tutor system prompts and assessment scoring prompts using real student data.

**Phase Numbering:**
- Integer phases (6, 7): Planned milestone work
- Decimal phases (6.1, 6.2): Urgent insertions (marked with INSERTED)

- [ ] **Phase 6: Chat Evaluation** - Infrastructure, chat fixtures, and complete chat tutor evaluation workflow
- [ ] **Phase 7: Assessment Evaluation** - Assessment fixtures and scoring evaluation workflow (after ws3 merge)

## Phase Details

### Phase 6: Chat Evaluation
**Goal**: Facilitators can load real chat conversations, edit system prompts, and regenerate AI tutor responses to iterate on prompt quality
**Depends on**: Nothing (uses only existing `stream_chat()` from ws2)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, FIX-01, FIX-03, FIX-04, CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05, CHAT-06, CHAT-07
**Success Criteria** (what must be TRUE):
  1. Facilitator can navigate to /promptlab while logged in with facilitator role, and non-facilitators are denied access
  2. Facilitator can browse available chat fixtures by name and module, select one, and see the full conversation rendered with student and AI messages
  3. Facilitator can edit the system prompt in a code editor, pick any AI message in the conversation, and regenerate it with the edited prompt -- the new response streams in via SSE in real time
  4. After regenerating a response, facilitator can write follow-up messages as the student and continue the conversation interactively
  5. Facilitator can see the original AI response alongside the regenerated one, and optionally view the LLM's chain-of-thought for regenerated responses
**Plans:** 5 plans

Plans:
- [ ] 06-01-PLAN.md — Extract ChatMarkdown, create core/promptlab/ fixtures module with sample data
- [ ] 06-02-PLAN.md — Backend regeneration with thinking support + API routes
- [ ] 06-03-PLAN.md — Frontend page, API client, and fixture browser
- [ ] 06-04-PLAN.md — Full interactive UI: two-panel layout, regeneration, comparison, CoT, follow-up
- [ ] 06-05-PLAN.md — Integration verification and end-to-end manual testing

### Phase 7: Assessment Evaluation
**Goal**: Facilitators can load student answer fixtures, edit scoring prompts, run AI assessment, and compare AI scores against human ground-truth
**Depends on**: Phase 6 (shared infrastructure), ws3 merge (`complete()` function and `SCORE_SCHEMA`)
**Requirements**: FIX-02, FIX-05, ASMNT-01, ASMNT-02, ASMNT-03, ASMNT-04, ASMNT-05
**Success Criteria** (what must be TRUE):
  1. Facilitator can browse available assessment fixtures by name and module, select one, and see the student answer with question context displayed
  2. Facilitator can edit the scoring prompt in a code editor, run AI assessment, and see the full structured output: overall score, reasoning, per-dimension scores, and key observations
  3. Facilitator can see the AI's chain-of-thought reasoning displayed alongside the score, and compare the AI score against the human ground-truth score from the fixture
**Plans**: TBD

Plans:
- [ ] 07-01: TBD
- [ ] 07-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 6 -> 6.x (if any) -> 7

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 6. Chat Evaluation | v3.0 | 0/5 | Not started | - |
| 7. Assessment Evaluation | v3.0 | 0/TBD | Not started | - |
