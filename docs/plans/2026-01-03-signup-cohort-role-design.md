# Signup: Cohort & Role Selection Design

**Date:** 2026-01-03
**Status:** Approved

## Overview

Add cohort and role selection to the signup wizard, allowing users to enroll in a cohort as either a participant or facilitator.

## User Flow

### Wizard Steps (Revised)

1. **Step 1: Personal Info** — Discord OAuth, name, email (existing)
2. **Step 2: Cohort & Role** — Select cohort, choose/become facilitator (NEW)
3. **Step 3: Availability** — Time zone, availability grid (existing)
4. **On submit**: Enroll in cohort + save profile

### Step 2: Cohort & Role Selection

**Already Enrolled Section** (if user has existing enrollments):
```
You're signed up for:
• Fall 2026 Cohort (as participant) — starts Sep 7
```
Read-only display. Cannot change existing enrollments.

**New Enrollment Section**:
- Dropdown of future cohorts user is NOT enrolled in
- Shows cohort name + start date
- If enrolled in all future cohorts: "You're enrolled in all available cohorts."

**Role Selection** (appears after selecting a cohort):
- If user is in `facilitators` table: Radio buttons "Facilitator" / "Participant"
- If not a facilitator: "Participant" pre-selected + "Become a facilitator" button

**"Become a Facilitator" Modal**:
- Text: "Facilitators lead weekly group discussions and help participants engage with the material. You'll be matched with a group based on your availability."
- Buttons: "Confirm" / "Cancel"
- On confirm: Add to `facilitators` table, show role radio buttons

## Backend API

### New Endpoints

**GET `/api/cohorts/available`** (requires auth)
- Returns future cohorts with enrollment status for current user
- Response:
```json
{
  "enrolled": [
    {"cohort_id": 2, "cohort_name": "Fall 2026", "start_date": "2026-09-07", "role": "participant"}
  ],
  "available": [
    {"cohort_id": 1, "cohort_name": "Spring 2026", "start_date": "2026-03-15"}
  ]
}
```

**GET `/api/users/me/facilitator-status`** (requires auth)
- Response: `{"is_facilitator": true|false}`

**POST `/api/users/me/become-facilitator`** (requires auth)
- Adds user to `facilitators` table
- Response: `{"success": true}`

### Updated Endpoint

**PATCH `/api/users/me`** — Add optional enrollment fields:
- `cohort_id`: Cohort to enroll in
- `role_in_cohort`: "facilitator" | "participant"

If provided, creates `courses_users` record with:
- `user_id`, `course_id` (from cohort), `cohort_id`
- `role_in_cohort`
- `grouping_status` = 'awaiting_grouping'

## Core Functions

API routes call core functions (no direct DB in routes):

```
core/queries/cohorts.py
  get_available_cohorts(user_id) → {enrolled: [...], available: [...]}

core/queries/users.py
  is_facilitator(user_id) → bool

core/users.py
  become_facilitator(discord_id) → bool
  enroll_in_cohort(discord_id, cohort_id, role_in_cohort) → dict
```

## Database

Uses existing tables:
- `facilitators` — Global facilitator status
- `courses_users` — Per-cohort enrollment with `role_in_cohort`
- `cohorts` — Cohort list, filtered by `cohort_start_date > today` and `status = 'active'`

## Edge Cases

1. **User already enrolled in selected cohort** — Not possible, dropdown excludes enrolled cohorts
2. **User enrolled in all future cohorts** — Hide dropdown, show message
3. **No future cohorts exist** — Show "No cohorts available for signup"
4. **User becomes facilitator mid-signup** — Modal adds to `facilitators`, role selector appears
