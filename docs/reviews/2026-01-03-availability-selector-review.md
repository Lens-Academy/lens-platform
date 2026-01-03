# Code Review: Availability Selector → Database → Scheduler Integration

**Date:** 2026-01-03
**Scope:** Frontend availability selector, database storage, scheduler integration
**Status:** RESOLVED

## Summary

Critical format mismatch bug found in `core/scheduling.py`. The `schedule_cohort()` function directly passes raw JSON availability strings to the scheduler's parser, which expects a completely different format.

## Resolution

**Fixed in this session:**

1. Changed frontend format from `"08:00"` to explicit `"08:00-08:30"` ranges
2. Created `core/availability.py` with:
   - `merge_adjacent_slots()` - merges adjacent time slots for efficiency
   - `availability_json_to_intervals()` - converts JSON to scheduler tuples
3. Fixed `core/scheduling.py` to use the new helper
4. Deleted dead code `core/enrollment.py` (was never called)

---

## Data Flow (After Fix)

```
Frontend (React)
    ↓
AvailabilityData: { "Monday": ["08:00-08:30", "08:30-09:00"], ... }
    ↓
JSON.stringify() → '{"Monday":["08:00-08:30","08:30-09:00"],...}'
    ↓
PATCH /api/users/me
    ↓
Database: users.availability_local (TEXT column, JSON string)
    ↓
core/scheduling.py: schedule_cohort()
    ↓
core/availability.py: availability_json_to_intervals()
    - Parses JSON
    - Merges adjacent slots: ["08:00-08:30", "08:30-09:00"] → ("08:00", "09:00")
    - Converts to scheduler format: "M08:00 M09:00"
    ↓
cohort_scheduler.parse_interval_string() → [(480, 540)]
```

---

## Issues Found

### 1. ✅ RESOLVED: Format Mismatch in `scheduling.py`

Fixed by using `availability_json_to_intervals()` helper.

---

### 2. ✅ RESOLVED: Column Renamed + UTC Conversion Added

Column renamed from `availability_utc` to `availability_local` to accurately reflect that times are stored in user's local timezone.

UTC conversion now happens at scheduling time via `availability_json_to_intervals(json_str, timezone_str)` using pytz for proper DST handling.

---

### 3. ✅ RESOLVED: Half-Hour Slots Treated as 1-Hour Blocks

Fixed by using explicit `"08:00-08:30"` format in frontend.

---

### 4. ✅ RESOLVED: Duplicate Conversion Logic

Fixed by creating shared `core/availability.py` module.

---

### 5. ✅ RESOLVED: Two Separate Scheduling Code Paths

Audited: `get_people_for_scheduling()` was dead code (never called). Deleted.
Production uses `schedule_cohort()` which is now fixed.

---

## File Reference

| File | Purpose |
|------|---------|
| `web_frontend/src/types/signup.ts` | Type definitions, `formatTimeSlot()` |
| `web_frontend/src/components/schedule/ScheduleSelector.tsx` | Visual grid component |
| `web_frontend/src/components/schedule/useScheduleSelection.ts` | Drag selection logic |
| `web_frontend/src/pages/Availability.tsx` | Standalone availability editor |
| `web_api/routes/users.py` | `PATCH /api/users/me` endpoint |
| `core/availability.py` | **NEW** - `availability_json_to_intervals()`, `merge_adjacent_slots()` |
| `core/scheduling.py` | `schedule_cohort()` - fixed to use helper |
| `core/cohorts.py` | `find_availability_overlap()` |
| `core/tables.py` | Database schema |

---

## Remaining Recommendations

1. ~~Fix `scheduling.py`~~ ✅
2. ~~Extract shared helper~~ ✅
3. ~~Fix 30-minute handling~~ ✅
4. ~~Rename column~~ ✅ → `availability_local` with UTC conversion at scheduling time
5. ~~Add integration test~~ ✅ → `discord_bot/tests/test_availability_integration.py`
6. ~~Audit code paths~~ ✅
7. ~~Add DST transition warnings~~ ✅

---

## Additional Features Added

### DST Transition Warnings

Added warnings when scheduling cohorts where members may be affected by Daylight Saving Time transitions during the cohort period.

**Files:**
- `core/availability.py` - `get_dst_transitions()`, `check_dst_warnings()`
- `core/scheduling.py` - `CohortSchedulingResult.warnings` field, integration in `schedule_cohort()`
- `discord_bot/cogs/scheduler_cog.py` - Display warnings in embed

**How it works:**
1. Collects timezones from all users being scheduled
2. Checks for DST transitions in the next 12 weeks
3. Returns warning messages grouped by transition date
4. Displays warnings in Discord scheduling result embed

---

## Completed Actions

### ✅ Database Migration Applied

Migration `a1b2c3d4e5f6_rename_availability_utc_to_local.py` applied:
- Renamed `availability_utc` → `availability_local`
- Renamed `if_needed_availability_utc` → `if_needed_availability_local`
