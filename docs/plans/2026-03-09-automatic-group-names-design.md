# Automatic Group Names

## Problem

Groups are currently named "Group 1", "Group 2", etc. This is generic and does nothing for group identity, memorability, or delight.

## Solution

Assign each group a name from a curated list of ~50 notable thinkers/scientists. Names are randomly selected at creation time, excluding names currently in use or recently used.

## Name Pool

~50 thinkers spanning math, CS, philosophy, and science — diverse across gender, era, and geography. Examples: Turing, Lovelace, Curie, Ramanujan, Hypatia, Noether, Feynman, Shannon, Darwin, Rosalind Franklin, etc.

## Assignment Rules

- **Random selection** from the pool, excluding names that are currently "in use"
- **In use** = any group where:
  - Status is active or preview, OR
  - `actual_end_date` (falling back to `expected_end_date`) is within the last 30 days
- **Exhaustion fallback**: if all 50 names are in use, fall back to appending a number (e.g. "Turing 2")

## Code Changes

1. **Repurpose `core/cohort_names.py`** into `core/group_names.py`:
   - Replace the 9-name cohort list with ~50 thinker names
   - Replace `CohortNameGenerator` class with an async `pick_available_name(conn)` function that queries active/recent groups and picks randomly from available names
   - Remove old cohort naming code

2. **`core/scheduling.py`** — replace `f"Group {i}"` with a call to `pick_available_name(conn)`

3. **No other changes needed**:
   - `core/queries/groups.py` `create_group()` already accepts `group_name` as a parameter
   - Frontend already displays `group_name` as-is
   - Discord channel naming already uses `group_name`
   - No DB migration (group_name is already a text field)
