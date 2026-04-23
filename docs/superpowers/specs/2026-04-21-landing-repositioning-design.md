# Landing Page Repositioning — From Education to Guidance

**Date:** 2026-04-21
**Author:** Luc (with Claude)

## Context

The public landing page (`/`, rendered by `web_frontend/src/pages/index/+Page.tsx`) currently positions Lens Academy as an *educational course platform*. The hero frames understanding as the endpoint ("Understand why"), and the page's differentiators are course features (AI tutoring, group discussions, focused curriculum).

Our SFF funding proposal repositions Lens as a *full guidance program* for AI Safety — orientation → upskilling → action — with the vision that Lens stays with people from first curiosity through taking meaningful action. Lens Coach (an AI meta-system for ongoing guidance) is part of the roadmap but not shipped.

The landing page should begin reflecting this positioning, without overpromising on capabilities that don't yet exist.

## Goal

Reposition the landing page's messaging from "education" to "guidance" — through minimal, hero-focused copy changes that don't add new sections or require new artwork. The hero carries the repositioning; the rest of the page delivers what currently exists (courses, AI tutor, community).

## Scope

- **In scope:**
  - `web_frontend/src/pages/index/+Page.tsx` — hero section copy.
  - `web_frontend/src/components/LandingNav.tsx` — nav CTA label.
- **Out of scope:**
  - About page (currently empty; separate spec).
  - Partner logos (MATS / Effective Thesis / AFFINE) — pending approvals.
  - Any 3-stage journey section, action-stage section, or Coach roadmap section — deferred to a later iteration.
  - Any visual/layout redesign.
  - The existing "Focused / AI Tutoring / Group Discussions" 3-card section — unchanged.
  - Screenshot section, courses section, pie chart, how-to-enroll, bottom CTA, footer — unchanged.
  - Analytics/tracking.

## Changes

### 1. Nav CTA label

File: `web_frontend/src/components/LandingNav.tsx`

- **Desktop CTA:** `Start Learning` → `Start with the intro`
- **Mobile CTA:** `Start Learning` → `Start with the intro`

The `CTA_HREF` (`/course/default/module/introduction`) stays unchanged.

### 2. Hero headline

File: `web_frontend/src/pages/index/+Page.tsx`

- **Before:**
  > Some of the smartest people alive are worried about AI. Understand why.
- **After:**
  > Some of the smartest people alive are worried about AI. We'll help you do something about it.

### 3. Hero subhead

File: `web_frontend/src/pages/index/+Page.tsx`

- **Before:**
  > Learn why superintelligent AI could be catastrophic for humanity — and what to do about it.
- **After:**
  > Lens guides you from first understanding why superintelligent AI could be catastrophic — to finding what you, specifically, can do about it.

### 4. Hero primary CTA label

File: `web_frontend/src/pages/index/+Page.tsx`

- **Before:** `Start Learning` (links to `/course/default/module/introduction`)
- **After:** `Start with the intro` (same link)

The `Enroll in a Course` secondary CTA stays unchanged.

### 5. Bottom CTA — left unchanged

The bottom CTA's `Start Learning` button (inside the `Try the intro module today` section near the page footer) **stays as `Start Learning`** for this iteration. Rationale: the bottom CTA is framed around the heading *"Try the intro module today"* and already primes the reader correctly; re-labeling would be noise. Revisit when/if we unify CTA labels later.

## What stays exactly as-is

- The hero's two small-print lines ("Get started in under 1 minute…" / "Free for you. Funded by…")
- Screenshot + "A tailor-made learning experience" section
- "Focused / AI Tutoring / Group Discussions" 3-card section
- Courses section (Superintelligence 101 + Navigating Superintelligence)
- "How Our Courses Work" section (with pie chart)
- How to Enroll section
- Bottom CTA section
- Footer
- Page layout, grid structure, reveal animations, color system, typography

## Verification

- `npm run lint` from `web_frontend/` passes.
- `npm run build` from `web_frontend/` passes (TypeScript + Vike build).
- Manual visual check via Chrome DevTools MCP at `http://dev.vps:3100/`:
  - Hero renders with the new headline, subhead, and primary CTA label.
  - Mobile and desktop nav both show `Start with the intro`.
  - No other visible changes on the page.
- No automated tests are added. These are copy changes; there is no logic to test.

## Non-goals / explicit deferrals

The following were considered and explicitly deferred:

- **3-stage journey section (Orient → Upskill → Act).** The single most architecturally significant repositioning move. Deferred per user preference for a minimal first iteration. Candidate for a follow-up spec.
- **"What graduates do next" action-stage section.** Deferred in the same iteration.
- **Lens Coach mention.** Not named anywhere on the landing page in this iteration; the hero's "guides you" framing carries the vision without naming a product that isn't shipped.
- **Rewriting the 3 differentiator cards** to lean toward guidance framing. Kept as-is for minimality; revisit if the hero-vs-cards tension becomes noticeable in feedback.
