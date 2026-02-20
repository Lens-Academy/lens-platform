# Requirements: AI Safety Course Platform — v3.0 Prompt Lab

**Defined:** 2026-02-20
**Core Value:** Students can engage with course content and demonstrate understanding while the platform collects data to improve both teaching and measurement.

## v3.0 Requirements

Requirements for the Prompt Lab milestone. Each maps to roadmap phases.

### Fixtures

- [ ] **FIX-01**: Facilitator can load curated chat conversation fixtures from JSON files in the repo
- [ ] **FIX-02**: Facilitator can load curated assessment answer fixtures from JSON files in the repo
- [ ] **FIX-03**: Facilitator can browse available fixtures with name, module, and description
- [ ] **FIX-04**: Chat fixtures include full context: original system prompt, per-chat instructions, previous content, and conversation messages
- [ ] **FIX-05**: Assessment fixtures include student answer, question context, scoring prompt, and human ground-truth scores

### Chat Tutor Evaluation

- [ ] **CHAT-01**: Facilitator can view a loaded conversation with all student and AI messages rendered
- [ ] **CHAT-02**: Facilitator can edit the system prompt (base + per-chat instructions) in a code editor
- [ ] **CHAT-03**: Facilitator can pick any point in the conversation and regenerate the AI response with the edited prompt
- [ ] **CHAT-04**: Regenerated AI responses stream via SSE in real time
- [ ] **CHAT-05**: Facilitator can write follow-up messages as the student after a regenerated response
- [ ] **CHAT-06**: Facilitator can see the original AI response alongside the regenerated response
- [ ] **CHAT-07**: Facilitator can optionally see the LLM's chain-of-thought/extended thinking for regenerated responses

### Assessment Evaluation

- [ ] **ASMNT-01**: Facilitator can view a loaded student answer with question context
- [ ] **ASMNT-02**: Facilitator can edit the scoring prompt (system prompt for assessment) in a code editor
- [ ] **ASMNT-03**: Facilitator can run the AI assessment and see the full structured output (overall score, reasoning, dimensions, key observations)
- [ ] **ASMNT-04**: Facilitator can see the AI's chain-of-thought reasoning displayed alongside the score
- [ ] **ASMNT-05**: Facilitator can see the human ground-truth score from the fixture alongside the AI score for comparison

### Infrastructure

- [ ] **INFRA-01**: Prompt Lab is accessible only to authenticated facilitators
- [ ] **INFRA-02**: Prompt Lab has a dedicated route in the platform (e.g., /promptlab)
- [ ] **INFRA-03**: Prompt Lab uses a separate backend module (core/promptlab/) that does not import from chat.py or scoring.py
- [ ] **INFRA-04**: Prompt Lab does not write to any database tables (chat_sessions, assessment_responses, assessment_scores)

## Future Requirements

Deferred to future release. Tracked but not in current roadmap.

### Differentiators

- **DIFF-01**: Facilitator can save prompt versions and switch between them
- **DIFF-02**: Facilitator can run all fixtures through a prompt as a curated test suite
- **DIFF-03**: Facilitator can add annotations/notes to specific conversations
- **DIFF-04**: Facilitator can compare responses from different models side-by-side
- **DIFF-05**: Facilitator can fork a conversation at any point (branching)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Automated metrics (BLEU, ROUGE, embedding similarity) | Evaluation is qualitative; 5-15 conversations don't need automated scoring |
| LLM-as-judge evaluation | Adds complexity; humans are the judges at this scale |
| CI/CD integration / regression testing | Over-engineered for 2-3 facilitators with small datasets |
| Production A/B testing | Irresponsible to route students to experimental prompts; manual review first |
| Prompt auto-optimization | Educational prompt intent is domain-specific; can't be auto-optimized |
| Database tables for eval state | Prompt Lab is ephemeral; fixtures in repo, state in frontend only |
| Human score entry in UI | Human scores come from external process (markdown/Excel), embedded in fixtures |
| Batch evaluation dashboard | Manual review for now; add metrics later if needed |
| Conversation extraction UI | Extraction done manually via Claude Code; no UI needed |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FIX-01 | Phase 6 | Pending |
| FIX-02 | Phase 7 | Pending |
| FIX-03 | Phase 6 | Pending |
| FIX-04 | Phase 6 | Pending |
| FIX-05 | Phase 7 | Pending |
| CHAT-01 | Phase 6 | Pending |
| CHAT-02 | Phase 6 | Pending |
| CHAT-03 | Phase 6 | Pending |
| CHAT-04 | Phase 6 | Pending |
| CHAT-05 | Phase 6 | Pending |
| CHAT-06 | Phase 6 | Pending |
| CHAT-07 | Phase 6 | Pending |
| ASMNT-01 | Phase 7 | Pending |
| ASMNT-02 | Phase 7 | Pending |
| ASMNT-03 | Phase 7 | Pending |
| ASMNT-04 | Phase 7 | Pending |
| ASMNT-05 | Phase 7 | Pending |
| INFRA-01 | Phase 6 | Pending |
| INFRA-02 | Phase 6 | Pending |
| INFRA-03 | Phase 6 | Pending |
| INFRA-04 | Phase 6 | Pending |

**Coverage:**
- v3.0 requirements: 21 total
- Mapped to phases: 21
- Unmapped: 0

---
*Requirements defined: 2026-02-20*
*Last updated: 2026-02-20 after roadmap creation*
