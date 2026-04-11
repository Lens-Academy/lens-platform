# Duplicate Signup Fix Design

## Problem

Users can create duplicate signups (multiple rows for the same user+cohort) because:

1. No `UNIQUE` constraint on `(user_id, cohort_id)` in the signups table
2. `enroll_in_cohort()` does a blind INSERT with no duplicate check
3. Frontend submit buttons never disable during submission — `isSubmitting` state is declared but unused

## Approach: Unique constraint + INSERT ON CONFLICT

### Database Layer

Add `UNIQUE(user_id, cohort_id)` constraint to `signups` table via Alembic migration. Assumes duplicates have been manually cleaned up before running.

### Backend Layer

Change `enroll_in_cohort()` to use `INSERT ... ON CONFLICT (user_id, cohort_id) DO NOTHING`, then SELECT the existing row. Makes the function idempotent — double calls return the same signup.

### Frontend Layer

1. **EnrollWizard.tsx** — destructure `isSubmitting` so it's readable, pass it to child step components
2. **AvailabilityStep.tsx** — accept `isSubmitting` prop, add to button's `disabled` condition
3. **GroupSelectionStep.tsx** — already handles the prop, just needs it passed from parent

### Error Handling

No new error states. `ON CONFLICT DO NOTHING` silently resolves duplicates. Existing frontend error handling is sufficient.

### Testing

- Backend: verify double-enroll returns same signup (not two rows)
- Frontend: verify buttons disable when `isSubmitting=true`
