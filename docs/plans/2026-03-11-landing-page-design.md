# Landing Page + About Page Design

## Context

Lens Academy is a free, nonprofit AI Safety education platform. The landing page needs to convert visitors into learners — "1 minute to get started." Also designing `/about` page in tandem (shared nav/footer).

Target audience: general — not just LessWrong/rationalist community. People who've heard of AI Safety but can't explain it yet. Tone: direct, honest, builder-showing-work. Not startup marketing.

## Tech Stack

- Vike + React 19 + Tailwind CSS v4
- lucide-react for icons
- No component library — custom Tailwind
- SPA (no SSR)

## Architecture

**Approach A: Single-file landing page.** All sections inline in `+Page.tsx`. Shared components: nav (`LandingNav.tsx` updated) and footer (new `LandingFooter.tsx`). Both `/` and `/about` use these shared components.

## Aesthetic Direction: "Confident editorial, warm and approachable"

Like a well-designed magazine feature — accessible to anyone, typographically strong, generous space. The seriousness comes from typography and copy, not from darkness or visual intensity.

### Typography

- **Headlines:** Instrument Serif (Google Fonts) — modern serif with character, conveys intellectual gravity
- **Body:** DM Sans (Google Fonts) — clean, readable, pairs well with serif
- Replaces Inter (current) for landing/about pages only (course interface keeps its own typography)

### Color Palette

- **Background:** Warm cream/off-white (`#faf9f6` range)
- **Text:** Dark slate for body, near-black for headlines
- **Accent:** Amber/gold (`#d4a843` range) for CTAs and emphasis — conveys urgency and importance without aggression
- **Muted:** Warm grays for secondary text and borders

### Motion

Minimal. Subtle fade-ins on scroll. No flashy animations. Restraint signals seriousness.

### Layout

Generous whitespace, large type, editorial pacing. Sections feel like turning pages. Not cramped.

## Page Sections

### Nav Bar
- Fixed top, backdrop-blur on scroll
- Left: Logo + "Lens Academy"
- Right: Courses | Community | About (placeholder links) + "Start Learning" button (amber accent)
- Mobile: hamburger (existing MobileMenu component)
- Warm cream background, subtle shadow on scroll

### Hero
- Large Instrument Serif headline: "Understand why superintelligence might end everything — and what to do about it."
- DM Sans subheadline, muted color
- Two CTAs: "Start Learning" (filled amber) + "Enroll in the Course" (outline/ghost)
- Small text: "Takes 1 minute to get started."
- Funding line in smaller muted text
- Product screenshot below in browser-frame mockup — bright visual anchor against cream
- Generous padding, fills most of viewport but scrolls

### The Problem (2-3 sentences)
- Centered text block, slightly larger body font
- No heading — just the paragraph
- Subtle separation from hero (space or thin border)

### What Makes This Different (3 cards)
- Three cards in a row (stack on mobile)
- lucide icons (Target, MessageSquare, Users) in amber/gold
- Bold title + body text per card
- Subtle background differentiation (white on cream or vice versa)
- Light shadows, no heavy borders

### Our Courses (2 cards)
- Larger cards, side by side on desktop
- Intro course: "Available now" badge, "Start Learning" CTA
- Book club: "Starting April 2026" badge, CTA TBD (placeholder)
- Subtle border, generous padding

### Who This Is For
- Two short statements as styled pull-quotes or large italic text
- Centered, generous vertical space

### For AI Safety Experts
- Visually distinct smaller section — muted background band
- Short copy + "Review our curriculum" link
- Understated

### Bottom CTA
- Repeat hero CTAs
- "Free. No application process. Takes 1 minute to get started."

### Footer
- Links: Courses | Community | About
- "Lens Academy is a registered nonprofit."
- Minimal, warm gray on cream

## /about Page (designed in tandem)
- Same nav + footer
- Content: team bios, pedagogy, tech/features, scalability — everything NOT on the landing page
- Design TBD — will follow same aesthetic (Instrument Serif + DM Sans, cream palette)

## What's NOT on the landing page
- Team bios → /about
- Feature/tech lists → /about
- Scalability, cost, automation → /about
- Full pedagogy argument → /about
- Time commitment details → enrollment flow

## Assets
- Product screenshots (provided by user, placed in appropriate assets directory)
- Logo already exists at `/assets/Logo only.png`
