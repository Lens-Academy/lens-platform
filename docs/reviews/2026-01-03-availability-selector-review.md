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
4. Refactored `core/enrollment.py` to use the shared helper (DRY)
5. Added migration support in frontend for legacy format data

---

## Data Flow Overview

```
Frontend (React)
    ↓
AvailabilityData: { "Monday": ["08:00", "08:30"], ... }
    ↓
JSON.stringify() → '{"Monday":["08:00","08:30"],...}'
    ↓
PATCH /api/users/me
    ↓
Database: users.availability_utc (TEXT column, JSON string)
    ↓
Scheduler reads from DB
    ↓
cohort_scheduler.parse_interval_string() expects: "M09:00 M10:00, T14:00 T15:00"
```

---

## Issues Found

### 1. CRITICAL: Format Mismatch in `scheduling.py`

**Location:** `core/scheduling.py:121-122`

```python
intervals = cohort_scheduler.parse_interval_string(row["availability_utc"] or "")
if_needed = cohort_scheduler.parse_interval_string(row["if_needed_availability_utc"] or "")
```

**Problem:** Passes JSON string directly to parser that expects interval format.

- **Input:** `'{"Monday":["09:00","09:30"]}'`
- **Expected:** `"M09:00 M10:00, T14:00 T15:00"`
- **Result:** `parse_interval_string()` returns `[]` - all users appear to have no availability

**Correct implementation exists in:** `core/enrollment.py:43-75`

---

### 2. Misleading Column Name

**Location:** `core/tables.py:58`

The column `availability_utc` stores times in the **user's local timezone**, not UTC. The actual timezone is stored separately in the `timezone` column.

**Recommendation:** Rename to `availability_local` or `availability_json` to avoid confusion.

---

### 3. Half-Hour Slots Treated as 1-Hour Blocks

**Location:** `core/enrollment.py:57-59`

```python
hour = int(slot.split(":")[0])
end_hour = hour + 1  # Always adds 1 hour, ignores minutes
interval_str = f"{day_code}{slot} {day_code}{end_hour:02d}:00"
```

**Problem:** The `:30` portion of time slots is ignored.

- User selects "08:00" → Interval: 8:00-9:00 ✓
- User selects "08:30" → Interval: 8:00-9:00 ✗ (should be 8:30-9:30 or 8:30-9:00)

The frontend grid has 30-minute slots, but conversion treats each as a 1-hour block starting at the hour.

---

### 4. Duplicate Conversion Logic

**Locations:**
- `core/enrollment.py:52-63` (availability conversion)
- `core/enrollment.py:66-75` (if_needed conversion)
- `discord_bot/tests/test_scheduler.py:466-476` (test helper)

**Recommendation:** Extract to shared helper function.

---

### 5. Two Separate Scheduling Code Paths

- `core/enrollment.py:get_people_for_scheduling()` - Works correctly with JSON
- `core/scheduling.py:schedule_cohort()` - Broken, skips JSON parsing

Unclear which is used in production. May indicate dead code or incomplete migration.

---

## File Reference

| File | Lines | Purpose |
|------|-------|---------|
| `web_frontend/src/types/signup.ts` | 1-47 | Type definitions, `formatTimeSlot()` |
| `web_frontend/src/components/schedule/ScheduleSelector.tsx` | 1-188 | Visual grid component |
| `web_frontend/src/components/schedule/useScheduleSelection.ts` | 1-276 | Drag selection logic |
| `web_frontend/src/pages/Availability.tsx` | 1-169 | Standalone availability editor |
| `web_api/routes/users.py` | 34-62 | `PATCH /api/users/me` endpoint |
| `core/users.py` | 64-114 | `update_user_profile()` |
| `core/enrollment.py` | 18-97 | `get_people_for_scheduling()` - correct conversion |
| `core/scheduling.py` | 54-226 | `schedule_cohort()` - broken conversion |
| `core/cohorts.py` | 15-83 | `find_availability_overlap()` - uses JSON correctly |
| `core/tables.py` | 47-77 | Database schema |

---

## Recommendations

1. **Fix `scheduling.py`**: Add JSON parsing and format conversion
2. **Extract shared helper**: `availability_json_to_intervals(json_str) -> list[tuple]`
3. **Fix 30-minute handling**: Respect the `:30` portion of time slots
4. **Rename column**: `availability_utc` → `availability_json` or similar
5. **Add integration test**: Full flow from API to scheduler
6. **Audit code paths**: Determine if `enrollment.py` or `scheduling.py` is the active path
