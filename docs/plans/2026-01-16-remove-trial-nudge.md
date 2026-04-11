# Remove Trial Nudge Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Cleanly remove the trial nudge (lesson completion reminder) feature from the codebase.

**Architecture:** The trial nudge feature spans 4 files: action functions in `core/notifications/actions.py`, exports in `core/notifications/__init__.py`, message templates in `core/notifications/messages.yaml`, and call sites in `web_api/routes/lessons.py`. Removal is straightforward deletion with no refactoring needed.

**Tech Stack:** Python (FastAPI backend), YAML configuration

---

### Task 1: Remove Trial Nudge Call Sites from Lessons Route

**Files:**
- Modify: `web_api/routes/lessons.py:48` (import)
- Modify: `web_api/routes/lessons.py:245-253` (schedule call)
- Modify: `web_api/routes/lessons.py:508-514` (cancel call)

**Step 1: Remove the import statement**

In `web_api/routes/lessons.py`, change line 48 from:

```python
from core.notifications import schedule_trial_nudge, cancel_trial_nudge
```

to:

```python
# (delete this line entirely)
```

Also remove the unused import on line 49:

```python
from core.notifications.urls import build_lesson_url
```

**Step 2: Remove the schedule_trial_nudge call**

Delete lines 245-253 (the entire block):

```python
    # Schedule trial nudge for logged-in users (24h reminder to complete)
    if user_id is not None:
        try:
            schedule_trial_nudge(
                session_id=session["session_id"],
                user_id=user_id,
                lesson_url=build_lesson_url(request_body.lesson_slug),
            )
        except Exception as e:
```

Also delete the logging line that follows if present.

**Step 3: Remove the cancel_trial_nudge call**

Delete lines 508-514:

```python
        # Cancel any scheduled trial nudge since user completed the lesson
        try:
            cancel_trial_nudge(session_id)
        except Exception as e:
            print(
                f"[Notifications] Failed to cancel trial nudge for session {session_id}: {e}"
            )
```

**Step 4: Run linting to verify no errors**

Run: `ruff check web_api/routes/lessons.py`
Expected: No errors (or only unrelated warnings)

**Step 5: Commit**

```bash
jj describe -m "chore: remove trial nudge calls from lessons route

Remove scheduling and cancellation of trial nudge reminders.
Feature being removed as it's too complex for current needs."
```

---

### Task 2: Remove Trial Nudge Functions from Actions Module

**Files:**
- Modify: `core/notifications/actions.py:183-200`

**Step 1: Remove the schedule_trial_nudge function**

Delete lines 183-195:

```python
def schedule_trial_nudge(session_id: int, user_id: int, lesson_url: str) -> None:
    """
    Schedule a nudge for incomplete trial lesson.

    Sends 24h after user started trial lesson.
    """
    schedule_reminder(
        job_id=f"trial_{session_id}_nudge",
        run_at=datetime.now(timezone.utc) + timedelta(hours=24),
        message_type="trial_nudge",
        user_ids=[user_id],
        context={"lesson_url": lesson_url},
    )
```

**Step 2: Remove the cancel_trial_nudge function**

Delete lines 198-200:

```python
def cancel_trial_nudge(session_id: int) -> int:
    """Cancel trial nudge (e.g., when user completes lesson or signs up)."""
    return cancel_reminders(f"trial_{session_id}_nudge")
```

**Step 3: Remove the build_lesson_url import if now unused**

Check if `build_lesson_url` is used elsewhere in the file. If only used by trial nudge (line 94 uses it for meeting reminders), keep it. If unused, remove from the import on line 16.

**Step 4: Run linting to verify no errors**

Run: `ruff check core/notifications/actions.py`
Expected: No errors

**Step 5: Commit**

```bash
jj describe -m "chore: remove trial nudge functions from notifications actions"
```

---

### Task 3: Remove Trial Nudge Exports from __init__.py

**Files:**
- Modify: `core/notifications/__init__.py:15-16, 31-32, 48-49`

**Step 1: Remove from docstring**

Delete line 15:

```python
    schedule_trial_nudge(...) - Schedule trial lesson nudge
```

**Step 2: Remove from imports**

Change lines 31-32 from:

```python
    schedule_trial_nudge,
    cancel_trial_nudge,
```

to:

```python
# (delete these two lines)
```

**Step 3: Remove from __all__**

Delete lines 48-49:

```python
    "schedule_trial_nudge",
    "cancel_trial_nudge",
```

**Step 4: Run linting to verify no errors**

Run: `ruff check core/notifications/__init__.py`
Expected: No errors

**Step 5: Commit**

```bash
jj describe -m "chore: remove trial nudge exports from notifications module"
```

---

### Task 4: Remove Trial Nudge Message Template

**Files:**
- Modify: `core/notifications/messages.yaml:116-129`

**Step 1: Remove the trial_nudge template**

Delete lines 116-129:

```yaml
trial_nudge:
  email_subject: Finish your trial lesson?
  email_body: |
    Hi {name},

    You started the trial lesson but didn't finish.
    Pick up where you left off: {lesson_url}

    Best,
    Luc
    Founder of Lens Academy
  discord: |
    Hey {name}! You started the trial lesson yesterday.
    Want to finish it? {lesson_url}
```

**Step 2: Commit**

```bash
jj describe -m "chore: remove trial nudge message template"
```

---

### Task 5: Final Verification

**Step 1: Search for any remaining references**

Run: `rg -i "trial.?nudge" --type py --type yaml`
Expected: No matches (or only in jj operation store / git history)

**Step 2: Run full lint check**

Run: `ruff check .`
Expected: No new errors

**Step 3: Run format check**

Run: `ruff format --check .`
Expected: No formatting issues

**Step 4: Run tests**

Run: `pytest`
Expected: All tests pass

**Step 5: Squash commits and finalize**

```bash
jj squash --from 'description(glob:"chore: remove trial*")' --into @
jj describe -m "chore: remove trial nudge feature

Remove the lesson completion reminder feature that sent nudges
to users 24h after starting but not completing the intro lesson.

Removed:
- schedule_trial_nudge() and cancel_trial_nudge() functions
- trial_nudge message template
- Call sites in lessons route

The feature was too complex with multiple bugs (broken links,
incorrect targeting logic) and not worth fixing at this time."
```

---

## Summary

| Task | Files | Action |
|------|-------|--------|
| 1 | `web_api/routes/lessons.py` | Remove imports and call sites |
| 2 | `core/notifications/actions.py` | Remove function definitions |
| 3 | `core/notifications/__init__.py` | Remove exports |
| 4 | `core/notifications/messages.yaml` | Remove message template |
| 5 | (verification) | Search, lint, test, commit |

Total: ~50 lines of code removed across 4 files.
