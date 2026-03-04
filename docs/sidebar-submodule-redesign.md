# Course Sidebar Redesign: Submodule Markers

## Problem

Modules can have 21+ sections, which is overwhelming. Sections naturally group by `learningOutcomeName` (LO) — consecutive sections sharing an LO form a "submodule." The sidebar should expose these submodules to give users a sense of structure without showing every individual section.

## Inspiration

BlueDot's layout at `bluedot.org/courses/agi-strategy/3/1`:
- Numbered modules as top-level items
- Sub-items (submodules) nested beneath each module with duration

## Current Sidebar Hierarchy

```
Unit 1          (collapsible header, progress "0/2")
  Introduction  (module item)
  Core Concepts (module item)
Unit 2
  Advanced Topics
```

## Target Sidebar Hierarchy

```
── Due before Meeting 1 ──
Introduction          (collapsible header, progress "3/6")
  Welcome             (standalone stage — no LO name)
  Intro outcome 1     (LO group, 2 stages)
  Objections L1       (LO group)
  Background Claims   (standalone)
  Worst-case thinking  (standalone)
Core Concepts         (collapsible header, progress "0/2")
  (submodule items...)
── Due before Meeting 2 ──
Advanced Topics       (collapsible header)
  (submodule items...)
```

## Key Design Decisions

1. **Unit headers removed entirely** — modules become the top-level expandable items
2. **"Due before Meeting N"** — subtle divider between module groups from different units (not a grouping header)
3. **Modules as collapsible headers** — status icon + title + progress badge + chevron
4. **LO-grouped stages as nested items** — each shows completion indicator + title + optional stage count
5. **Clicking a submodule** navigates to the module viewer at that section

## Data Flow

`learningOutcomeName` exists on every section in content processor output and flows through the module viewer API, but is **not** in the course progress API response (`GET /api/courses/{slug}/progress`).

**Backend change needed**: Add `learningOutcomeName` to each stage dict in `web_api/routes/courses.py` (the stage-building loop around line 216-225).

## Grouping Logic

`groupStagesIntoSubmodules(stages)`:
- Walk stages sequentially
- Consecutive stages with the same non-null `learningOutcomeName` → one group titled by the LO name
- Stages with null `learningOutcomeName` → standalone group titled by stage title

This mirrors the existing `groupSectionsIntoSubmodules()` in `submoduleGrouping.ts` (which operates on `ModuleSection[]` for the module viewer).

## Module Viewer (Deprioritized)

The experiment change (`xkokovnq`) also modified the module viewer to:
- Show only current submodule's sections in the progress bar
- Display "{submodule title} . N of M" in the header
- Translate between group-local and global section indices

This was found buggy and is deprioritized. The sidebar is the focus.

## Existing Submodule Utility

`web_frontend/src/utils/submoduleGrouping.ts` already has:
- `groupSectionsIntoSubmodules(sections: ModuleSection[])` — for module viewer
- `getSubmoduleForIndex(submodules, globalIndex)` — for finding which submodule a section belongs to

The experiment added `groupStagesIntoSubmodules(stages: StageInfo[])` — same logic but for the lighter `StageInfo` type used in course progress.

## Files Involved

| File | Role |
|------|------|
| `web_api/routes/courses.py` | Add `learningOutcomeName` to stage dict |
| `web_frontend/src/types/course.ts` | Add `learningOutcomeName` to `StageInfo` |
| `web_frontend/src/utils/submoduleGrouping.ts` | Add `groupStagesIntoSubmodules()` |
| `web_frontend/src/components/course/CourseSidebar.tsx` | Rewrite: modules as headers, LO groups as items |
| `web_frontend/src/views/CourseOverview.tsx` | Add submodule click handler |

## User Quotes

> "I would probably remove the units and just have the modules"

> "You can think of 'Drivers of AI Progress' as a module, and then of 'Technical trends driving AI progress (30min)' as a submodule"

> "Maybe the system should behave more like YAML and JSON. Less about absolute header level and all about relative header level." (re: content format, future work)
