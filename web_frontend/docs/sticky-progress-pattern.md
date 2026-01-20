# Sticky Progress Icon Pattern

## The Goal

Progress icons should feel connected to scroll position:
1. The **current** section's icon stays vertically centered (e.g., 50vh)
2. When a section scrolls up past center, its icon **sticks to the top** of the viewport
3. Multiple completed icons **stack at the top**, forming a visible progress bar
4. Future sections' icons enter from below as you scroll down

## Key Insight: CSS Sticky Stacking

Multiple sticky elements with the same `top` value naturally stack:

```html
<section class="section-1">
  <div class="icon" style="position: sticky; top: 80px;">[icon 1]</div>
  <div class="content">...</div>
</section>
<section class="section-2">
  <div class="icon" style="position: sticky; top: 120px;">[icon 2]</div>
  <div class="content">...</div>
</section>
<section class="section-3">
  <div class="icon" style="position: sticky; top: 160px;">[icon 3]</div>
  <div class="content">...</div>
</section>
```

As you scroll:
- Section 1's icon sticks at `top: 80px`
- Section 2's icon sticks at `top: 120px` (below icon 1)
- Section 3's icon sticks at `top: 160px` (below icon 2)
- They form a vertical stack at the top!

## Implementation Approach

### Structure
Each section contains its own icon as a child:

```tsx
<section className="relative">
  {/* Icon column on the left, sticky */}
  <div className="absolute left-4 top-0 bottom-0">
    <div
      className="sticky"
      style={{ top: `${80 + sectionIndex * 40}px` }}
    >
      <SectionIcon type={section.type} />
    </div>
  </div>

  {/* Content with left padding */}
  <div className="pl-20">
    {section.content}
  </div>
</section>
```

### Behavior
1. Icon starts at its natural position in the section
2. As section scrolls up, icon becomes sticky at its designated `top` position
3. Icons stack vertically because each has a progressively larger `top` value
4. When section scrolls out completely, icon scrolls away with it...

   **BUT** - this is where we need a tweak: we want completed icons to stay, not leave.

### The "Stay at Top" Problem

Pure CSS sticky alone doesn't keep icons at top after their section leaves. Options:

**Option A: Very tall icon container**
Make the icon's sticky container span multiple sections (or the whole page), so it never "ends":
```tsx
<div className="absolute left-4 top-0" style={{ height: 'calc(100% + remaining sections height)' }}>
  <div className="sticky" style={{ top: `${80 + index * 40}px` }}>
    <Icon />
  </div>
</div>
```

**Option B: Minimal JS - clone to fixed container**
When IntersectionObserver detects section has scrolled past, clone/move the icon to a fixed top container:
```tsx
// Fixed container at top of page
<div className="fixed top-20 left-4 flex flex-col gap-2">
  {completedIcons.map(icon => <Icon key={icon.id} />)}
</div>

// Icons in sections (for current/future)
<section>
  {!isCompleted && <StickyIcon />}
  <Content />
</section>
```

**Option C: CSS Scroll-driven animations** (experimental)
Use `animation-timeline: view()` to animate icon position based on scroll. Limited browser support.

## Recommended Approach

**Option B (Minimal JS)** seems cleanest:
- Each section renders its icon inline with sticky positioning
- When section scrolls past threshold, icon is "promoted" to a fixed top container
- Use IntersectionObserver to detect when sections enter/leave viewport
- React state tracks which sections are "completed" (scrolled past)

This gives us:
- Natural scroll-connected feel (icons are in DOM with their sections)
- Clean stacking at top (fixed container with completed icons)
- Minimal JS (just intersection detection, no scroll position math)

## Visual Result

```
┌─────────────────────────────────┐
│ Header                          │
├─────────────────────────────────┤
│ [📄] ← completed, fixed at top  │
│ [▶️] ← completed, fixed at top  │
│                                 │
│         [📄] ← current section  │
│               icon, sticky at   │
│               ~50vh while       │
│               section is active │
│                                 │
│         Section 3 content...    │
│                                 │
└─────────────────────────────────┘
         [▶️] ← future section
               (below viewport)
```

---

## Implementation Attempts (2026-01-18)

### Attempt 1: Pure JS with React State

Put icons in a fixed sidebar, update positions via `useState` on every scroll frame.

**Problems:**
- React re-renders on every scroll frame = laggy
- CSS `transition-all` on positions fought with JS updates = double-laggy

### Attempt 2: JS with Direct DOM Manipulation

Same fixed sidebar, but use refs and `element.style.transform` instead of state.

**Improvements:**
- `will-change-transform` for GPU acceleration
- Only `setState` when currentIndex changes (not every frame)
- Cancel pending RAF before scheduling new ones

**Result:** Smoother, but still feels like unnecessary complexity for what should be simpler.

### Better Approach: Hybrid CSS Sticky + Minimal JS

**Key insight:** CSS sticky can do most of the work if icons live inside their sections.

```tsx
<section>
  <div className="sticky top-[50vh]">
    <Icon />
  </div>
  <Content />
</section>
```

**What CSS sticky handles automatically:**
- Icon follows section as it enters from below
- Icon sticks at 50vh (center) while section is in view
- No continuous JS updates needed

**What JS handles (IntersectionObserver only):**
- Detect when section crosses the center threshold
- Move completed icons to a fixed container at top
- This is event-driven, not continuous

**Benefits:**
- No scroll listener doing continuous position calculations
- Browser handles the smooth "following" natively
- JS only fires at discrete state transitions

### Current State

ProgressSidebar.tsx currently uses Attempt 2 (direct DOM manipulation).
Next time: refactor to Hybrid approach for cleaner code.
