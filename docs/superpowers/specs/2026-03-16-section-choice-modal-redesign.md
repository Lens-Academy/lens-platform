# Section Choice Modal Redesign + TLDR Truncation

## Context

The SectionChoiceModal appears after completing a section when optional content follows, letting users choose between optional and required sections. The current implementation (from earlier today) puts the required section prominently at top with optional below — but the visual style uses generic indigo/gray colors that don't match the brand, and the ordering should be flipped to present optional lenses first as an invitation before the core continue path.

Separately, TLDRs in the ModuleOverview sidebar take too much vertical space. They should be truncated by default with an expand toggle.

## Change 1: Redesign SectionChoiceModal with Brand Colors and New Ordering

**File:** `web_frontend/src/components/module/SectionChoiceModal.tsx`

**Layout (top to bottom):**
1. Completion acknowledgement — green checkmark + "Completed [title]" (existing, keep as-is)
2. Remove the existing "What's Next?" `<h2>` heading — the section labels below serve the same purpose with more specificity
3. "Want to explore an optional lens?" label — `text-sm font-medium` in `lens-gold-700` (`#7a470c`)
3. Optional section cards — light gold cards:
   - Background: `lens-gold-50` (`#fdf8f0`)
   - Border: `1.5px solid lens-gold-100` (`#f9eedb`), hover → `lens-gold-300` (`#dea96c`)
   - Dashed circle icon (matching current `StageIcon` usage) with `lens-gold-300` dashed border
   - Title in `lens-gold-700`, metadata in `lens-gold-500`
   - Optional badge: `bg-lens-gold-100 text-lens-gold-600` (`#9a5c10`)
   - Duration shown as today
   - TLDR shown below metadata if present (always expanded, no truncation in modal)
3. Label is count-sensitive: "Want to explore this optional lens?" (1 optional) vs "Want to explore an optional lens?" (2+)
4. "Or continue with the core material:" label — same style as optional label
5. Required section card — stronger gold treatment:
   - Background: `lens-gold-50`
   - Border: `1.5px solid lens-gold-300` (`#dea96c`), hover → `lens-gold-400` (`#d08838`)
   - Solid circle icon with `lens-gold-400` border, `lens-gold-100` fill
   - Title in `lens-gold-700` with `font-semibold` (bolder than optional)
   - Right chevron arrow in `lens-gold-400`
   - Slightly larger circle (28px vs 24px for optional)

**Accessibility:** All choices must use `<button>` elements (not styled `<div>`s) to preserve keyboard navigation and screen reader support.

**When there are no optional sections:** Don't show the modal at all — auto-advance as before (this is existing behavior, no change needed).

**When there's no required section** (only optional content remaining): Show optional cards + "Skip" button at bottom (existing behavior, restyle to gold).

## Change 2: TLDR Truncation in ModuleOverview Sidebar

**File:** `web_frontend/src/components/course/ModuleOverview.tsx`

**Behavior:**
- TLDRs render truncated to 2 lines by default using `line-clamp-2`
- A small downward chevron (`▾` or SVG) appears inline after truncated text
- Clicking the chevron (or the TLDR text area) expands to show full text; chevron rotates to point up
- State is component-local (per-section, using a `Set<number>` of expanded indices or similar)
- Collapsed is the default for all sections

**Implementation approach:**
- Wrap TLDR text in a container with `line-clamp-2` and `overflow-hidden`
- Use a ref or `scrollHeight > clientHeight` check to detect if text is actually truncated (don't show chevron for short TLDRs)
- Toggle removes `line-clamp-2` class

## Files to Modify

- `web_frontend/src/components/module/SectionChoiceModal.tsx` — new layout and gold styling
- `web_frontend/src/components/course/ModuleOverview.tsx` — TLDR truncation

## Verification

1. `cd web_frontend && npm run lint && npm run build`
2. Navigate to a module with optional sections after a required section
3. Complete a section that triggers the choice modal
4. Verify optional lenses appear first with warm gold cards
5. Verify core section appears below with stronger gold treatment + arrow
6. Verify clicking any option navigates correctly
7. Open module drawer sidebar — verify TLDRs are truncated to 2 lines with expand chevrons
8. Click a chevron — verify TLDR expands; click again — verify it collapses
