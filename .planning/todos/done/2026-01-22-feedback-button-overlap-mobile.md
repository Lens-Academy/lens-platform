---
created: 2026-01-22T09:47
title: Fix Feedback button overlap on mobile
area: ui
files:
  - web_frontend/src/components/FeedbackButton.tsx
  - web_frontend/src/components/module/Module.tsx
---

## Problem

The purple "Feedback" button (fixed position, bottom-left) overlaps with the "Mark section complete" button on mobile viewports. This can cause accidental taps and creates visual clutter. Issue is mobile-specific - desktop layout is fine.

## Solution

- Adjust Feedback button position on mobile (higher up, or move to different corner)
- Or hide Feedback button when completion button is visible
- Or make Feedback button smaller/more subtle on mobile
- Consider moving Feedback to the mobile menu instead of floating
