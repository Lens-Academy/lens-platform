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
Database: users.availability_utc (TEXT column, JSON string)
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

### 2. ⚠️ OPEN: Misleading Column Name

**Location:** `core/tables.py:58`

The column `availability_utc` stores times in the **user's local timezone**, not UTC. The actual timezone is stored separately in the `timezone` column.

**Recommendation:** Rename to `availability_local` or `availability_json` to avoid confusion.

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
4. **Rename column**: `availability_utc` → `availability_json` (low priority)
5. **Add integration test**: Full flow from API to scheduler
6. ~~Audit code paths~~ ✅
