---
created: 2026-01-22T09:47
title: Collapse references section on mobile
area: ui
files:
  - web_frontend/src/components/module/ArticleEmbed.tsx
---

## Problem

The references/footnotes section at the end of articles is very long on mobile. Users have to scroll through dozens of reference items to reach the chat input at the bottom. This creates a poor UX for mobile users who want to quickly engage with the discussion prompt.

## Solution

- Detect references section (numbered list at end of article, typically starts with "[1]" style entries)
- Collapse by default on mobile viewports
- Add "Show references" / "Hide references" toggle
- Consider using `<details>` element for native collapse behavior
- Ensure chat input is quickly reachable after article content
