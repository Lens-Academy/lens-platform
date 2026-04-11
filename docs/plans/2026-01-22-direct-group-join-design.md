# Direct Group Join Design

## Problem

Currently, users must provide their availability and wait for the scheduler to assign them to a group. This creates friction for:

1. **New users** joining a cohort that's already been scheduled - they have to wait for another scheduling run
2. **Ungrouped users** who signed up but couldn't be scheduled due to availability conflicts - they're stuck with no way to join

We want users to be able to directly join an existing group, bypassing the availability-based scheduling.

## Solution

Two entry points, same group selection UI:

1. **New user enrollment** - Step 3 of enrollment wizard shows groups instead of availability picker (when cohort has groups)
2. **Existing user group management** - `/group` page accessible from profile for changing/joining groups

## Enrollment Wizard Changes

### Current Flow
1. PersonalInfoStep - Discord, email, display name, ToS
2. CohortRoleStep - Select cohort, select role
3. AvailabilityStep - Timezone + weekly schedule grid → Submit

### New Flow
Steps 1-2 unchanged. Step 3 becomes conditional:

- **If selected cohort has groups** → GroupSelectionStep
- **If selected cohort has no groups** → AvailabilityStep (unchanged)

## GroupSelectionStep Component

### Layout
```
┌─────────────────────────────────────────────────────┐
│  Select Your Group                                  │
│  Choose a group that fits your schedule.            │
│                                                     │
│  Your Timezone: [America/New_York ▼]               │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │ ⭐ Group 1 - Wednesdays 3:00 PM            │   │
│  │    4 members · Best size to join!           │   │
│  └─────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────┐   │
│  │    Group 2 - Thursdays 7:00 PM             │   │
│  │    5 members                                │   │
│  └─────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────┐   │
│  │    Group 3 - Saturdays 10:00 AM            │   │
│  │    6 members · ✓ Matches your availability  │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  None of these work? [Join a different cohort]     │
│                                                     │
│  [Back]                    [Complete Enrollment]    │
└─────────────────────────────────────────────────────┘
```

### Group Display Rules

**Shown with badge:**
- 3-4 members: "Best size to join!" badge (green/highlighted)

**Shown normally:**
- 5-6 members: No special indicator

**Hidden entirely:**
- 7-8 members: Not displayed (considered full)

### Availability Overlap Indicator

If user has existing availability on file (from previous enrollment or profile update):
- Show "Matches your availability" checkmark on groups where meeting time overlaps
- Still allow joining groups that don't match

### Timezone Picker

- Same component as current AvailabilityStep
- Changing timezone updates displayed meeting times in real-time
- Timezone is saved to user profile on submit

### "None of these work?" Escape Hatch

When clicked:
1. Show cohort picker (list of available cohorts)
2. User selects a different cohort
3. Click Next → AvailabilityStep for that cohort (traditional flow)

This routes users who can't find a suitable group into the availability-based scheduling for a different cohort.

## Existing User Group Management

### Entry Point

Profile page button:
- **"Join group"** - if enrolled in a cohort but not in a group
- **"Change group"** - if already in a group
- **Hidden** - if not enrolled in any cohort

### Page: `/group`

Same GroupSelectionStep UI, but:
- Shows groups for the user's current cohort
- If user is already in a group, current group is highlighted/indicated
- Submitting switches their group membership

### Joining Rules

**Can join a group if:**
- Group hasn't had its first meeting yet

**Cannot join if:**
- Group has already had its first meeting AND user is not currently in any group
- (Users already in a group can still switch to another group that hasn't started)

This prevents late joiners from missing content, while allowing existing participants to switch early in the cohort.

## Data Flow

### New Enrollment Submit
```
POST /api/users/me
{
  nickname, email, timezone, tos_accepted,
  cohort_id,
  role,
  group_id        // NEW: direct group join
}
```

Backend:
1. Update user profile (timezone, etc.)
2. Create signup record
3. Add user to groups_users with selected group_id
4. Skip availability storage (not needed for direct join)

### Group Change (Existing User)
```
POST /api/groups/join
{
  group_id
}
```

Backend:
1. Remove user from current group (set groups_users.status = 'removed', left_at = now)
2. Add user to new group (insert groups_users)
3. (Stage 2: Handle meeting/notification cleanup)

## API Endpoints

### New Endpoints

**GET `/api/cohorts/{cohort_id}/groups`**
Returns groups available for joining:
```json
{
  "groups": [
    {
      "group_id": 1,
      "group_name": "Group 1",
      "recurring_meeting_time_utc": "Wednesday 15:00",
      "member_count": 4,
      "first_meeting_at": "2026-02-01T15:00:00Z",
      "has_started": false
    }
  ]
}
```

**POST `/api/groups/join`**
Join or switch to a group:
```json
{
  "group_id": 1
}
```

### Modified Endpoints

**PATCH `/api/users/me`**
Add optional `group_id` parameter for direct enrollment.

**GET `/api/cohorts/available`**
Add `has_groups: boolean` to each cohort in response.

## Stage 2 (Deferred)

When a user switches groups, additional cleanup needed:
- Remove from old group's future meetings
- Cancel scheduled notification messages for old group
- Add to new group's future meetings
- Schedule notification messages for new group
- Update calendar invites

For Stage 1, we just update groups_users. Users will manually need to be aware of meeting changes.

## Edge Cases

**User tries to join after first meeting:**
- API returns error, frontend shows message explaining they can't join mid-cohort

**All groups are full (7-8 members):**
- No groups displayed
- Show message: "All groups are currently full. Join a different cohort to be matched based on availability."

**Cohort has no groups yet:**
- GroupSelectionStep never renders
- User sees AvailabilityStep as normal

**User already in a group clicks "Change group":**
- Current group shown but not selectable (or shown with "Your current group" label)
- Only other groups are selectable

## Success Criteria

1. New users can enroll and immediately join an existing group
2. Ungrouped users can self-serve into an available group
3. Users in groups can switch to a different group (before first meeting)
4. Group sizes stay balanced via visual nudging toward smaller groups
