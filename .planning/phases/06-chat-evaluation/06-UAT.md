---
status: complete
phase: 06-chat-evaluation
source: 06-01-SUMMARY.md, 06-02-SUMMARY.md, 06-03-SUMMARY.md, 06-04-SUMMARY.md
started: 2026-02-20T18:30:00Z
updated: 2026-02-20T19:15:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Auth gate — unauthenticated user
expected: Visiting /promptlab while logged out shows "Prompt Lab" heading and a "Sign in with Discord" button. No fixture data is visible.
result: skipped
reason: Requires logging out; verified in previous manual testing session

### 2. Auth gate — non-facilitator user
expected: Visiting /promptlab while logged in as a non-facilitator shows an error when fetching fixtures (the API returns 403). The page should indicate that facilitator/admin access is required.
result: skipped
reason: Requires switching to non-facilitator account; verified in previous manual testing session

### 3. Fixture browser loads and displays cards
expected: As a facilitator/admin, /promptlab shows fixture cards with name (bold), module (small gray), and description. At least 2 fixtures are visible.
result: pass

### 4. Module filter dropdown
expected: If fixtures span multiple modules, a module filter dropdown appears. Selecting a module filters the cards. If all fixtures share one module, no filter dropdown is shown.
result: pass

### 5. Two-panel layout after selecting fixture
expected: Clicking a fixture card opens a two-panel layout: left panel has a monospace system prompt editor, right panel shows the conversation messages.
result: pass

### 6. System prompt editing and reset
expected: The system prompt textarea is editable. Editing shows a "Modified" indicator. Clicking "Reset to original" restores the original text and the indicator disappears.
result: pass

### 7. Message selection for regeneration
expected: Clicking an assistant message in the conversation highlights it. Messages after the selection are dimmed. A "Regenerate from selected" button appears. A separator indicates "Messages below will be replaced."
result: pass

### 8. SSE-streamed regeneration
expected: Clicking "Regenerate from selected" starts streaming a new AI response. Text appears progressively. When complete, the regenerated message replaces the selected message and everything after it.
result: pass

### 9. Original vs regenerated comparison
expected: After regeneration, the regenerated message shows a "Show original" toggle. Expanding it reveals the original fixture message above the new one.
result: pass

### 10. Chain-of-thought / reasoning display
expected: If the AI included reasoning (thinking) in its response, a "Show reasoning" toggle appears on the regenerated message. Expanding it shows the chain-of-thought text.
result: pass

### 11. Follow-up messaging
expected: After regeneration, a text input appears at the bottom of the conversation. Typing a message and submitting sends it as a follow-up. The AI response streams in below the user's message.
result: pass

### 12. Reasoning toggle and effort selector
expected: Between the header bar and two-panel layout, there is a "Reasoning" checkbox (checked by default) and an "Effort" dropdown (defaulting to "Low"). Unchecking Reasoning hides the effort dropdown.
result: pass

### 13. Error banner sanitization and dismiss
expected: If an error occurs, the error banner in the header shows a short user-friendly message (not raw JSON/stack traces). Long errors show "Request failed. Check console for details." The banner has an X button to dismiss it.
result: pass

### 14. Back navigation
expected: Clicking "← Fixtures" in the header returns to the fixture browser cleanly, clearing all state (prompt, messages, selection, errors).
result: pass

## Summary

total: 14
passed: 12
issues: 0
pending: 0
skipped: 2

## Gaps

[none]
