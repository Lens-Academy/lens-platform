# 07-02 Summary: Voice Input for AnswerBox

## Result: COMPLETE

## What was built

### Task 1: Extract useVoiceRecording hook and refactor NarrativeChatSection
- Created `web_frontend/src/hooks/useVoiceRecording.ts` (~310 lines) — encapsulates MediaRecorder, AudioContext, volume metering, timer, transcription, and cleanup
- Refactored `NarrativeChatSection.tsx` to import and use the hook — removed ~300 lines of inline recording logic
- Chat voice input behavior unchanged (regression-free)

### Task 2: Add voice input to AnswerBox
- Added `useVoiceRecording` hook to AnswerBox with mic button positioned inside textarea area
- Recording UI: volume bars, timer, Stop button, 60s warning
- enforceVoice mode: blue-highlighted mic button, adjusted placeholder text
- Voice metadata tracked via `setMetadata({ voice_used: true })`

### Task 3: Human verification (checkpoint)
- User tested on `/module/demo#text-box-trial`
- Found and fixed 3 bugs during testing:
  1. **FIELD_PATTERN regex** — `\w+` didn't match hyphens, so `user-instruction::` was silently dropped. Fixed to `[\w-]+` in both `lens.ts` and `sections.ts`
  2. **Viewport jumping** — textarea auto-expand set `height: "auto"` causing scroll position loss. Fixed by saving/restoring `window.scrollY` and using `overflow-hidden`
  3. **Misleading mic error** — `navigator.mediaDevices` is undefined on insecure HTTP origins, causing generic "Could not access microphone". Added `isSecureContext` guard with clear "Voice recording requires HTTPS" message, plus differentiated errors for permission denied, no hardware, and device busy

## Commits
- `mysqmoov` feat(07-02): extract useVoiceRecording hook and refactor NarrativeChatSection
- `qpnopusx` feat(07-02): add voice input to AnswerBox with recording UI and enforceVoice
- `zzwklpvn` fix(07-02): parser hyphenated fields, textarea scroll jump, voice error messages

## Files modified
- `web_frontend/src/hooks/useVoiceRecording.ts` (new)
- `web_frontend/src/components/module/NarrativeChatSection.tsx` (refactored)
- `web_frontend/src/components/module/AnswerBox.tsx` (voice input added + scroll fix)
- `content_processor/src/parser/lens.ts` (FIELD_PATTERN regex fix)
- `content_processor/src/parser/sections.ts` (FIELD_PATTERN regex fix)

## Decisions
- Secure context guard added to useVoiceRecording — prevents TypeError on insecure HTTP origins
- Error auto-dismiss timeout increased to 8s for persistent errors (HTTPS, no hardware)
- Stream cleanup added in catch block when getUserMedia succeeds but later setup fails
