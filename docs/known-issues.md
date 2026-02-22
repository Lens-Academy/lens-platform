# Known Issues

## Voice input autosave error

When using voice input (enforce_voice segments), autosave tries to save but shows an error — presumably because the text field is empty when autosave fires before any transcription has happened.

## "Answer again" button not working

On completed questions, the "Answer again" button doesn't visibly reset the question to editing state. Needs investigation — may be a state management issue in AnswerBox.
