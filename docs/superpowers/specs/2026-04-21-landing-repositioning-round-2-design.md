# Landing Page Repositioning — Round 2

**Date:** 2026-04-21
**Author:** Luc (with Claude)
**Follows:** `2026-04-21-landing-repositioning-design.md` (round 1 — hero + nav CTA + tailor-made-program heading)

## Context

Round 1 shifted the landing page's hero messaging from "education" to "guidance" with four copy edits. After seeing the rendered result, the page still reads course-heavy relative to the hero's new promise. Round 2 rebalances toward the broader program framing by:

1. Reframing the middle card in the 3-card section from a course feature ("AI Tutoring") to a program feature ("AI Guidance") that names Lens Coach as a forthcoming product.
2. Adding a single dedicated section for **Lens Coach — coming soon**, giving it enough space to convey the vision (cross-journey AI guidance, drawing on integrated datasets) without overpromising.
3. A one-word consistency tweak in the paragraph under "A tailor-made program."

Cards #1 ("Focused, Not Broad") and #3 ("Group Discussions") in the 3-card section stay unchanged. Courses, pie chart, How-to-Enroll, bottom CTA, nav, and footer all stay unchanged.

## Goal

Make the page's program/guidance framing land visibly, without removing existing sections or adding more than one new section. All claims are calibrated: Lens Tutor stays described as a current course feature; Lens Coach is named explicitly as a product with a "Coming soon" badge.

## Scope

- **In scope:**
  - `web_frontend/src/pages/index/+Page.tsx` — three edits:
    1. Replace the middle card's content (AI Tutoring → AI Guidance)
    2. Update the paragraph under "A tailor-made program" (one-word change)
    3. Insert a new `RevealSection` after the 3-card section and before the Courses section, containing a Lens Coach card
- **Out of scope:**
  - Cards #1 (Focused, Not Broad) and #3 (Group Discussions) — unchanged
  - Courses section, pie chart, How-to-Enroll, bottom CTA — unchanged
  - Nav, footer — unchanged
  - Any new icons, images, or assets
  - About page, partner logos (still TBD for later iteration)
  - Explicit partnership attribution ("in partnership with MATS and AISafety.com") — user decision: leave out for now, mention datasets as data sources only

## Changes

### Change 1: Replace the middle card's content (AI Tutoring → AI Guidance)

File: `web_frontend/src/pages/index/+Page.tsx`

Location: inside the "What makes this different" section (the 3-card grid that is the second `<section>` after the hero/screenshot). The three card objects live in an inline array literal passed to `.map((card, i) => ...)`. The middle card is the one with `icon: MessageSquare`.

Before:

```tsx
{
  icon: MessageSquare,
  title: "AI Tutoring",
  body: "Your AI tutor meets you where you are, challenges your reasoning, and stays with you until things actually click.",
},
```

After:

```tsx
{
  icon: MessageSquare,
  title: "AI Guidance",
  body: "In courses, our AI tutor meets you where you are. Lens Coach, coming soon, stays with you beyond courses too — from first curiosity through meaningful action.",
},
```

Notes:
- Icon (`MessageSquare` from lucide-react) is already imported and stays the same.
- The `body` is a JavaScript string literal (not JSX text), so HTML entities like `&thinsp;` and `&mdash;` do not work here. Use the equivalent Unicode characters: the em-dash `—` (U+2014) works in a JS string and renders correctly. This matches existing codebase patterns — card bodies already use `’` for typographic apostrophes (e.g. `You’re` in card #3).
- Do not change card #1 (Focused, Not Broad) or card #3 (Group Discussions). Keep them exactly as-is.

### Change 2: Update paragraph under "A tailor-made program"

File: `web_frontend/src/pages/index/+Page.tsx`

Location: the screenshot section's right-column paragraph (roughly around line 245 after the heading `A tailor-made program`).

Before:

```tsx
                Designed by a team with years of AI Safety experience and formal
                training in education. We&rsquo;re building a learning
                experience grounded in evidence-based
                principles&thinsp;&mdash;&thinsp;from the course design to the
                AI tutor.
```

After:

```tsx
                Designed by a team with years of AI Safety experience and formal
                training in education. We&rsquo;re building a program grounded
                in evidence-based principles&thinsp;&mdash;&thinsp;from the
                course design to the AI tutor.
```

This is a one-word change (`learning experience` → `program`) plus a re-flow of the text to match the original's ~65-column wrap. All HTML entities (`&rsquo;`, `&thinsp;`, `&mdash;`) are preserved in their existing forms.

### Change 3: Insert a new "Lens Coach — coming soon" section

File: `web_frontend/src/pages/index/+Page.tsx`

Location: between the 3-card section (the `<section>` with class containing `var(--landing-bg-alt)` that wraps the three differentiator cards) and the Courses section (the `<RevealSection>` whose heading is `Our Courses`).

Visual design:

- A single card, centered in a `max-w-3xl` container (narrower than the `max-w-5xl` used by the Courses section — this is a standalone card, not a grid).
- Card styling matches the existing Course cards (same `p-8 sm:p-10 rounded-xl`, `bg-alt` background, border, flex column layout).
- Above the heading: a `Coming soon` badge styled identically to the existing `STARTING 20 APRIL 2026` badge on the Superintelligence 101 card — accent background, accent text, uppercase, tracking-wide, `px-3 py-1 rounded-full`, `mb-5`.
- Heading: `Lens Coach` — same `text-2xl sm:text-3xl mb-4 leading-snug` + `fontDisplay` style as the Course card headings.
- Body: single paragraph, same `text-base leading-relaxed` + muted color as the Course card bodies.
- Section padding: `py-20 sm:py-28 px-4` — same vertical rhythm as the other RevealSection blocks.
- Wrapped in `<RevealSection>` so it gets the same fade-in-on-scroll treatment as surrounding sections.

Concrete JSX to insert (place immediately after the closing `</section>` of the 3-card block and before the opening `<RevealSection>` of the Courses section):

```tsx
      {/* ================================================================= */}
      {/* LENS COACH — coming soon                                          */}
      {/* ================================================================= */}
      <RevealSection className="py-20 sm:py-28 px-4">
        <div className="max-w-3xl mx-auto">
          <div
            className="p-8 sm:p-10 rounded-xl flex flex-col"
            style={{
              backgroundColor: "var(--landing-bg-alt)",
              border: "1px solid var(--landing-border)",
            }}
          >
            <span
              className="inline-block self-start text-xs font-semibold tracking-wide uppercase px-3 py-1 rounded-full mb-5"
              style={{
                backgroundColor: "var(--landing-accent)",
                color: "var(--landing-accent-text)",
              }}
            >
              Coming soon
            </span>
            <h3
              className="text-2xl sm:text-3xl mb-4 leading-snug"
              style={fontDisplay}
            >
              Lens Coach
            </h3>
            <p
              className="text-base leading-relaxed"
              style={{ color: "var(--landing-text-muted)" }}
            >
              An AI that stays with you beyond courses&thinsp;&mdash;&thinsp;from
              first curiosity to meaningful action. Drawing on the alignment
              research dataset, MATS&rsquo;s research project database, and
              aisafety.com&rsquo;s directory of organizations and communities,
              Lens Coach will help you find what&rsquo;s worth reading, who to
              connect with, and what to do next&thinsp;&mdash;&thinsp;at whatever
              stage you are.
            </p>
          </div>
        </div>
      </RevealSection>
```

Notes:
- The body text uses the same HTML entities as the existing landing page (`&thinsp;&mdash;&thinsp;` for em-dashes, `&rsquo;` for apostrophes). Do not use Unicode characters here — this is JSX text, not a JS string literal (contrast Change 1).
- Card heading uses `<h3>` level to match the hierarchy of other Course cards (the `Our Courses` heading is `<h2>`, course card titles are `<h3>`). The new section has no `<h2>`-level heading of its own; the card's `<h3>` is the section header for a one-card section. This matches the screenshot section, which is also a one-block `RevealSection` without a top-level `<h2>`.
- Because the 3-card section has a `var(--landing-bg-alt)` background and the Courses section has the page default `var(--landing-bg)` background, inserting the new RevealSection between them means: 3-card (alt bg) → Coach (default bg) → Courses (default bg). The Coach section and Courses section will share the default background. This is visually fine — they read as sibling content on the same band — but if a visual break is desired between Coach and Courses, that's a later tweak (not in this spec).

## What stays exactly as-is

- Hero (round 1 already shipped)
- Nav (round 1 already shipped)
- Screenshot + `A tailor-made program` heading (round 1 shipped; only the paragraph inside is touched in Change 2)
- 3-card section layout; cards #1 and #3 content
- `Our Courses` section and both course cards
- `How Our Courses Work` pie chart section
- `How to Enroll` section
- Bottom CTA (`Try the intro module today`)
- Footer
- `Start Learning` button in the "Try the intro first" card (the known spec gap from round 1)

## Verification

- `npm run lint` passes (0 errors; pre-existing warnings unchanged).
- `npm run build` passes (TypeScript + Vike build finishes cleanly).
- Manual visual check via Chrome DevTools MCP at `http://dev.vps:3100/`:
  - Middle differentiator card renders with heading `AI Guidance` and the new body (em-dash rendered as U+2014, apostrophe in `Lens Coach, coming soon` area renders cleanly).
  - Paragraph under `A tailor-made program` now reads `…we're building a program grounded in evidence-based principles…`.
  - Between the 3-card section and the Courses section, a new single-card block renders with: `Coming soon` badge → `Lens Coach` heading → the full body paragraph. The badge is legible (accent color on accent-text color), the card has a visible border, and the section has the same vertical rhythm as neighbors.
  - No console errors introduced by these changes.
  - Reveal-on-scroll animation works for the new section on initial load.
- Mobile viewport (375×812): new section stacks vertically, card is full-width minus `px-4`, readable.
- No automated tests added. These are copy + layout additions; there is no logic to test.

## Non-goals

- No changes to existing `<section>` or `<RevealSection>` blocks other than the three edits listed.
- No new imports beyond what's already in the file (`RevealSection` is already used; `MessageSquare` stays).
- No new assets (icons, images).
- No About page, partner page, or Coach product page.
- No partnership attribution line in the Coach body — the user explicitly chose to reference data sources without naming partnerships in this iteration.
- No accessibility / ARIA changes beyond what the existing patterns already provide.
