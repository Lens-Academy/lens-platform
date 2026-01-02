# Unified Tooltip Component Design

## Problem

The app has inconsistent tooltip implementations:
- Native `title` attributes (ugly, unstyled, inconsistent across browsers)
- A custom React tooltip in StageProgressBar (manual positioning, duplicated logic)

We need a unified, reusable tooltip pattern.

## Solution

A `<Tooltip>` component powered by Floating UI for positioning.

## Dependencies

Add `@floating-ui/react` (~8kb gzipped) - handles positioning, viewport collision, and auto-flipping.

## Component API

```tsx
import { Tooltip } from '../components/Tooltip';

// Basic usage
<Tooltip content="Save your work">
  <button onClick={save}>Save</button>
</Tooltip>

// With options
<Tooltip
  content="Chat sections can't be revisited"
  placement="bottom"
  delay={300}
  persistOnClick
>
  <button disabled>...</button>
</Tooltip>
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `content` | `ReactNode` | required | Tooltip content |
| `placement` | `'top' \| 'bottom' \| 'left' \| 'right'` | `'top'` | Preferred position (auto-flips if no space) |
| `delay` | `number` | `400` | Hover delay in ms before showing |
| `persistOnClick` | `boolean` | `false` | Keep tooltip visible when trigger is clicked |

### Behavior

- **Hover**: Shows after delay, hides immediately on mouse leave
- **Focus**: Shows immediately (accessibility)
- **Click**: Hides tooltip (default) OR keeps visible (`persistOnClick`)
- **Escape**: Hides tooltip

### Styling

Dark background, white text, matching existing design:
- `bg-gray-800 text-white text-xs px-2 py-1 rounded`
- 8px offset from trigger element

## File Location

`web_frontend/src/components/Tooltip.tsx`

## Migration

### StageProgressBar.tsx

Replace custom tooltip implementation:
- Remove: `tooltipIndex` state, `hoverTimeoutRef`, mouse handlers, inline tooltip JSX
- Add: `<Tooltip>` wrapper around stage buttons
- Use `persistOnClick` for past chat stages

### ArticleLesson.tsx

Replace native `title` attributes with `<Tooltip>` components.

## Implementation Notes

Key Floating UI configuration:
- `offset(8)` - 8px gap between trigger and tooltip
- `flip()` - auto-flip if tooltip would overflow viewport
- `shift()` - shift along axis to stay in viewport
- `useDismiss({ referencePress: false })` - enables `persistOnClick` behavior
