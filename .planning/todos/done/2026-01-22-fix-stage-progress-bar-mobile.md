---
created: 2026-01-22T09:52
title: Fix stage progress bar display on mobile
area: ui
files:
  - web_frontend/src/components/module/StageProgressBar.tsx
  - web_frontend/src/components/module/ModuleHeader.tsx
---

## Problem

On some mobile article pages, the stage progress bar at the top is broken - only showing the left arrow and one stage icon, with the rest cut off or missing. The progress bar should show all stage icons horizontally with scroll arrows if needed.

Screenshot shows: Only `<` arrow and one blue circle visible, other stages missing.

## Solution

- Check overflow handling on StageProgressBar container
- Ensure horizontal scroll works for many stages
- May be related to horizontal scroll overflow issue
- Verify z-index and positioning doesn't clip content
