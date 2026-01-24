---
created: 2026-01-22T09:47
title: Fix mobile article horizontal scroll
area: ui
files:
  - web_frontend/src/components/module/ArticleEmbed.tsx
  - web_frontend/src/styles/globals.css
---

## Problem

On mobile viewport, the article view has a horizontal scrollbar. This breaks the mobile experience - users should not need to scroll horizontally on phone screens.

**Symptoms:**
- Horizontal scrollbar visible
- Charts/images getting cut off on the right side (e.g., the AI capabilities chart is clipped)
- Content overflowing container width

Likely caused by images, charts, or wide elements without proper responsive constraints.

## Solution

- Check for elements without `max-width: 100%` or `overflow-x: hidden`
- Ensure images and charts have `max-width: 100%` and `width: 100%`
- SVG/canvas charts may need explicit viewport constraints
- Code blocks may need `overflow-x: auto` with `white-space: pre-wrap`
- Add `overflow-x: hidden` to article container as safety net
- Check if chart component has fixed width that doesn't adapt to mobile
