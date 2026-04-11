# Deferred Test Completion - Manual Testing

## Test Cases

- [x] **T1: Feedback chat appears after completing all test questions** — PASS. Feedback chat renders below the test with the "I just completed a test..." message and tutor response.
- [x] **T2: Page does NOT auto-advance after test completion** — PASS. Page stays on `#test`, does not navigate to next section.
- [x] **T3: Continue button appears below feedback chat** — PASS. Green emerald "Continue >" button visible below NarrativeChatSection.
- [x] **T4: Clicking Continue marks test complete and advances** — PASS. URL changes from `#test` to `#section-3` (next section). `handleMarkComplete` fires correctly.
- [ ] **T5: Sidebar shows test as incomplete before Continue** — UNABLE TO TEST. Test was already marked complete from a prior session. Would need clean DB state to verify.
- [ ] **T6: Sidebar shows test as complete after Continue** — UNABLE TO TEST (same reason). Header dot showed checkmark both before and after.
- [x] **T7: Navigation unlocked during feedback** — PASS. Successfully navigated to Page 3 via sidebar during feedback phase. No lock.
- [ ] **T8: Test without feedback works normally** — UNABLE TO TEST. Demo module only has one test section, and it has `feedback: true`. No test-without-feedback available.
- [ ] **T9: Page reload after test-taking but before Continue** — UNABLE TO TEST with clean state. After reload, Q1+Q2 show as completed, Q3 in editing mode, no feedback chat. But test was already marked complete in DB from prior session, so the checkmark persisted. Per design doc: "If user closes mid-feedback, test shows as incomplete on return since user_content_progress was never written" — only applies to first-time completion.

## Issues Found

### Issue 1: "Answer Again" doesn't reset completedQuestions state (Medium)

**Behavior:** When a question is in "Answer again" (editing) mode, it is still counted as completed in `completedQuestions` (populated from `assessment_responses` API). Completing a different question triggers the "all questions done" flow even though the "Answer again" question hasn't been re-submitted.

**Steps to reproduce:**
1. Complete all 3 test questions
2. Click "Answer again" on Q3 (shows textbox with Finish button)
3. Click "Answer again" on Q1 and Q2
4. Click "Finish" on Q1
5. Click "Finish" on Q2
6. Feedback triggers immediately, even though Q3 still shows a Finish button

**Root cause:** `completedQuestions` Set is populated from API on component mount and only grows via `handleQuestionComplete`. "Answer again" opens the edit UI in AnswerBox but doesn't remove the question from `completedQuestions` in TestSection.

**Impact:** Feedback chat renders with Q3 showing the OLD answer (from the previous submission), not a re-submitted answer. User sees a "Finish" button on Q3 alongside the feedback chat.

**Note:** This is a pre-existing issue with TestSection's "Answer again" flow, not introduced by the deferred completion feature. But the deferred completion makes it more visible because feedback renders inline (previously, markComplete would fire and auto-advance, so the user wouldn't notice).

### Issue 2: Module chat messages are global (Low / Pre-existing)

**Behavior:** Test feedback messages ("I just completed a test...") appear in chat sections on ALL other module pages. Page 3 shows the full test feedback conversation in its chat area.

**Root cause:** `messages` state in Module.tsx is a single global array loaded via `getChatHistory(module.slug)`. All NarrativeChatSection instances render the same messages. Chat backend doesn't scope messages by section.

**Impact:** After test feedback, navigating to Page 3 (or any section with a chat) shows the test Q&A and feedback alongside that section's own content. Confusing for users.

**Note:** Pre-existing architecture issue. Not introduced by this feature, but exacerbated because test feedback generates long messages that clutter other sections.

### Issue 3: Duplicate feedback messages on re-completion (Low)

**Behavior:** Each time the test completion triggers (including via "Answer again" flow), a new "I just completed a test..." message is appended to the chat. Old messages from previous sessions persist.

**Root cause:** `onFeedbackTrigger` always calls `handleSendMessage()` with a new feedback request. The backend stores all messages. `getChatHistory` returns all of them.

**Impact:** After multiple completions, the chat shows 3+ copies of the same feedback request and responses. Cluttered UX.

**Note:** Related to Issue 2 (global chat). Not urgent for MVP but should be addressed.
