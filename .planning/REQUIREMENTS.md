# Requirements: v2.0 Tests & Answer Boxes

**Defined:** 2026-02-14
**Core Value:** Students can demonstrate understanding through free-text answers and test sections, while the platform collects AI-assessed learning outcome data internally.

## v1 Requirements

Requirements for the Tests & Answer Boxes milestone. Each maps to roadmap phases 6-9.

### Answer Box

- [x] **AB-01**: Free-text answer box renders as a segment type in the module viewer, accepting typed input
- [x] **AB-02**: Answer box supports voice input (same as existing chat voice input), not enforced
- [x] **AB-03**: Answer box usable within lesson sections (inline with teaching content, not only in tests)

### Test Section

- [ ] **TS-01**: Backend parses `## Test:` sections from Obsidian learning outcome templates into structured test data
- [ ] **TS-02**: Test section renders as a distinct section type in the module viewer with its own progress marker
- [ ] **TS-03**: Test sections group multiple answer boxes as assessment questions tied to learning outcomes
- [ ] **TS-04**: Test sections appear at the end of the module after all lesson content

### AI Assessment

- [ ] **AI-01**: AI scores free-text answers using LiteLLM, producing structured feedback
- [ ] **AI-02**: Per-question scoring uses rubric derived from the learning outcome definition
- [ ] **AI-03**: Socratic (helping learn) vs assessment (measuring learning) mode configurable per question
- [ ] **AI-04**: AI scores stored internally and not exposed to students in the UI

### Data Storage

- [ ] **DS-01**: Database tables for assessment responses (user answers linked to question, module, and learning outcome)
- [ ] **DS-02**: Database tables for assessment scores (AI-generated, JSONB format for schema flexibility)
- [ ] **DS-03**: API endpoints for submitting answers and retrieving assessment data (responses and scores)

## v2 Requirements

Deferred to future milestone. Tracked but not in current roadmap.

### Structured Question Types

- **SQ-01**: Multiple choice questions
- **SQ-02**: Matching / drag-and-drop exercises
- **SQ-03**: Fill-in-the-blank with validation

### Student-Facing Results

- **SR-01**: Students see their assessment scores after completion
- **SR-02**: Score breakdown by learning outcome
- **SR-03**: Certificate generation based on passing scores

### Input Controls

- **IC-01**: Content hiding during test mode blocks navigation to previous lesson pages
- **IC-02**: Voice-only enforcement per question (force speech, with text fallback)

### Advanced Assessment

- **AA-01**: Timed test sections with countdown
- **AA-02**: Randomized question order
- **AA-03**: Adaptive difficulty based on prior answers

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Showing scores to users | Scoring accuracy needs iteration before exposure |
| Multiple choice questions | Free-text only for now; richer signal for AI assessment |
| Certificate generation | Depends on reliable scoring, future milestone |
| Timed assessments | Adds complexity without learning measurement value |
| Facilitator assessment dashboard | Admin features are a separate milestone |
| Content hiding during tests | Deferred to future — input controls come after core assessment works |
| Offline test-taking | Requires significant architecture changes |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DS-01 | Phase 6 | Complete |
| DS-02 | Phase 6 | Complete |
| DS-03 | Phase 6 | Complete |
| TS-01 | Phase 6 | Complete |
| AB-01 | Phase 7 | Complete |
| AB-02 | Phase 7 | Complete |
| AB-03 | Phase 7 | Complete |
| TS-02 | Phase 8 | Pending |
| TS-03 | Phase 8 | Pending |
| TS-04 | Phase 8 | Pending |
| AI-01 | Phase 9 | Pending |
| AI-02 | Phase 9 | Pending |
| AI-03 | Phase 9 | Pending |
| AI-04 | Phase 9 | Pending |

**Coverage:**
- v1 requirements: 14 total
- Mapped to phases: 14
- Orphaned: 0
