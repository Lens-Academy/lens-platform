# Hamburger Menu in Module Header

## Problem

The module overview drawer is triggered by a small floating button on the left edge of the screen, below the header. This is easy to miss and feels disconnected from the header navigation. Users expect a hamburger menu in the header for accessing content navigation.

## Design

Move the module drawer trigger into the header as a hamburger icon (far left, before the logo). Remove the floating edge button. The drawer panel, backdrop, and all behavior stay the same.

### Header layout

```
[hamburger] [Logo] [|] [Title] ... [ProgressBar (desktop)] ... [UserMenu]
                                    [prev X/Y next (mobile)]
```

### Changes

**ModuleDrawer.tsx** — Accept `isOpen` and `onToggle` props from parent instead of managing state internally. Remove the floating toggle button. Keep: drawer panel, backdrop, escape key handler, scroll lock.

**ModuleHeader.tsx** — Add hamburger `Menu` icon (lucide) as the first element in the left section. Pass `onMenuToggle` callback up to parent.

**Module.tsx** — Own the drawer open/close state. Wire `ModuleHeader.onMenuToggle` to `ModuleDrawer.isOpen`.

### Interaction

- Click hamburger: opens left-side drawer (same slide animation)
- Click backdrop / press Escape / click close button: closes drawer
- Mobile: backdrop is dimmed, body scroll locked
- Desktop: transparent backdrop
