# Roadmap: AI Safety Course Platform

## Milestones

- v1.0 Mobile Responsiveness - Phases 1-5 (shipped 2026-01-22)
- v2.0 Tests & Answer Boxes - Phases 6-9 (in progress)

## Phases

<details>
<summary>v1.0 Mobile Responsiveness (Phases 1-5) - SHIPPED 2026-01-22</summary>

See `.planning/milestones/v1.0-ROADMAP.md` for full details.

Phase 1: Foundation & Typography (2 plans)
Phase 2: Responsive Layout (3 plans)
Phase 3: Content Components (2 plans)
Phase 4: Chat Interface (2 plans)
Phase 5: Motion & Polish (4 plans)

</details>

### v2.0 Tests & Answer Boxes

**Milestone Goal:** Add answer boxes and test sections to the module viewer so the platform can measure learning outcomes and start collecting assessment data.

- [x] **Phase 6: Data Foundation** - Database tables, API endpoints, and content parsing for tests
- [x] **Phase 7: Answer Box** - Free-text input component with voice support
- [x] **Phase 8: Test Sections** - Grouped assessment questions with test-mode UX
- [ ] **Phase 9: AI Assessment** - LLM-powered scoring with rubrics and mode selection

## Phase Details

### Phase 6: Data Foundation
**Goal**: The backend can store assessment data and parse test content from Obsidian, providing the foundation that all subsequent phases build on
**Depends on**: Nothing (first phase of v2.0; builds on existing codebase)
**Requirements**: DS-01, DS-02, DS-03, TS-01
**Success Criteria** (what must be TRUE):
  1. Assessment response records can be created and queried via API (user answer linked to question, module, and learning outcome)
  2. Assessment score records can be stored as JSONB and queried alongside their responses
  3. Backend parses `## Test:` sections from Obsidian learning outcome content and returns structured test question data in the module API response
  4. Existing module content (lessons, articles, videos, chat) continues to work unchanged
**Plans**: 2 plans

Plans:
- [x] 06-01-PLAN.md — Database schema (assessment_responses + assessment_scores tables), Alembic migration, and core/assessments.py CRUD functions
- [x] 06-02-PLAN.md — Content processor: Question segment type + Test section parsing + comment stripping; Assessment API endpoints (POST/GET responses)

### Phase 7: Answer Box
**Goal**: Students can type or speak answers into a free-text input component that appears within module content
**Depends on**: Phase 6 (needs API endpoints to submit answers, needs test content parsing)
**Requirements**: AB-01, AB-02, AB-03
**Success Criteria** (what must be TRUE):
  1. Student sees an answer box rendered inline within module content and can type a free-text response
  2. Student can use voice input on an answer box (same as existing chat voice input), not enforced
  3. Answer box works both inside lesson sections (inline with teaching content) and inside test sections
  4. Submitted answers are persisted to the database via the Phase 6 API
**Plans**: 2 plans

Plans:
- [x] 07-01-PLAN.md — AnswerBox component with auto-expanding textarea, debounced auto-save (PATCH endpoint), completion flow, and Module.tsx integration
- [x] 07-02-PLAN.md — Voice input via extracted useVoiceRecording hook, NarrativeChatSection refactor, enforceVoice support

### Phase 8: Test Sections
**Goal**: Modules can contain test sections at the end that group assessment questions and enforce test-mode behavior
**Depends on**: Phase 7 (needs answer box component), Phase 6 (needs parsed test data)
**Requirements**: TS-02, TS-03, TS-04
**Success Criteria** (what must be TRUE):
  1. Test section appears as a distinct section type in the module viewer with its own progress dot
  2. Multiple answer boxes are grouped within a test section, each tied to a learning outcome
  3. Test sections render after all lesson content in the module progression
**Plans**: 2 plans

Plans:
- [x] 08-01-PLAN.md — TestSection/TestQuestionCard components, type system updates, Module.tsx integration (Begin screen, sequential reveal, collapse, timer, resume, auto-completion)
- [x] 08-02-PLAN.md — Content hiding: testModeActive state, navigation restrictions, progress bar dimming, drawer dimming, human verification

### Phase 9: AI Assessment
**Goal**: The platform automatically scores student answers using AI and stores results internally for learning outcome measurement
**Depends on**: Phase 7 (needs submitted answers), Phase 6 (needs score storage)
**Requirements**: AI-01, AI-02, AI-03, AI-04
**Success Criteria** (what must be TRUE):
  1. After a student submits an answer, AI generates a structured score using LiteLLM (runs asynchronously, does not block submission)
  2. Scoring uses a rubric derived from the learning outcome definition associated with each question
  3. Questions can be configured as socratic (feedback-oriented) or assessment (measurement-oriented), affecting the AI prompt
  4. AI scores are stored in the database but do not appear anywhere in the student-facing UI
**Plans**: 2 plans

Plans:
- [ ] 09-01-PLAN.md — Core scoring module (core/scoring.py) with LLM structured output, prompt building, socratic/assessment mode, question resolution from content cache, and unit tests
- [ ] 09-02-PLAN.md — Wire scoring trigger into PATCH endpoint for fire-and-forget background scoring on answer completion

## Progress

**Execution Order:** 6 -> 7 -> 8 -> 9

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation & Typography | v1.0 | 2/2 | Complete | 2026-01-22 |
| 2. Responsive Layout | v1.0 | 3/3 | Complete | 2026-01-22 |
| 3. Content Components | v1.0 | 2/2 | Complete | 2026-01-22 |
| 4. Chat Interface | v1.0 | 2/2 | Complete | 2026-01-22 |
| 5. Motion & Polish | v1.0 | 4/4 | Complete | 2026-01-22 |
| 6. Data Foundation | v2.0 | 2/2 | Complete | 2026-02-14 |
| 7. Answer Box | v2.0 | 2/2 | Complete | 2026-02-16 |
| 8. Test Sections | v2.0 | 2/2 | Complete | 2026-02-16 |
| 9. AI Assessment | v2.0 | 0/2 | Not started | - |
