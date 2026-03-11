# Landing Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a new landing page for Lens Academy with warm editorial design (Instrument Serif + DM Sans, cream palette, amber/gold CTAs), plus shared nav/footer for future `/about` page.

**Architecture:** Single-file landing page (`+Page.tsx`) with shared `LandingNav` (updated) and new `LandingFooter` component. Google Fonts loaded in `+Head.tsx`. Landing-specific CSS variables in `globals.css`.

**Tech Stack:** Vike + React 19, Tailwind CSS v4, lucide-react, Google Fonts (Instrument Serif, DM Sans)

---

### Task 1: Add Google Fonts (Instrument Serif + DM Sans)

**Files:**
- Modify: `web_frontend/src/pages/+Head.tsx`

**Step 1: Add font links to Head**

Add Instrument Serif and DM Sans to the existing Google Fonts link. Keep Inter for the rest of the app.

```tsx
// In +Head.tsx, replace the Inter-only font link with:
<link
  href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700&display=swap"
  rel="stylesheet"
/>
```

**Step 2: Verify fonts load**

Run: `cd web_frontend && npm run build`
Expected: Build succeeds. Fonts are just CSS links, no build impact.

**Step 3: Commit**

```
feat: add Instrument Serif and DM Sans fonts
```

---

### Task 2: Add landing page CSS variables

**Files:**
- Modify: `web_frontend/src/styles/globals.css`

**Step 1: Add landing page custom properties**

Add after the existing `:root` block (or inside it):

```css
/* Landing page palette */
--landing-bg: #faf9f6;
--landing-bg-alt: #ffffff;
--landing-text: #1a1a1a;
--landing-text-muted: #6b6b6b;
--landing-accent: #c9952d;
--landing-accent-hover: #b8862a;
--landing-accent-text: #ffffff;
--landing-border: #e8e5df;
--landing-font-display: "Instrument Serif", serif;
--landing-font-body: "DM Sans", sans-serif;
```

**Step 2: Commit**

```
feat: add landing page CSS variables
```

---

### Task 3: Create LandingFooter component

**Files:**
- Create: `web_frontend/src/components/LandingFooter.tsx`

**Step 1: Create the footer**

```tsx
import { DISCORD_INVITE_URL } from "../config";

export function LandingFooter() {
  return (
    <footer
      className="border-t py-12 px-4"
      style={{
        fontFamily: "var(--landing-font-body)",
        borderColor: "var(--landing-border)",
        backgroundColor: "var(--landing-bg)",
        color: "var(--landing-text-muted)",
      }}
    >
      <div className="max-w-4xl mx-auto text-center">
        <nav className="flex items-center justify-center gap-8 mb-6 text-sm font-medium">
          <a href="/course/default" className="hover:text-[var(--landing-text)] transition-colors">
            Courses
          </a>
          <a
            href={DISCORD_INVITE_URL}
            className="hover:text-[var(--landing-text)] transition-colors"
          >
            Community
          </a>
          <a href="/about" className="hover:text-[var(--landing-text)] transition-colors">
            About
          </a>
        </nav>
        <p className="text-sm">
          Lens Academy is a registered nonprofit.
        </p>
      </div>
    </footer>
  );
}
```

**Step 2: Commit**

```
feat: add LandingFooter component
```

---

### Task 4: Update LandingNav for new design

**Files:**
- Modify: `web_frontend/src/components/LandingNav.tsx`

**Step 1: Update nav with new styling and links**

Update the nav to use the landing palette, add Courses/Community/About links, and a "Start Learning" CTA button. Key changes:

- Background: `var(--landing-bg)` with backdrop-blur
- Font: `var(--landing-font-body)`
- Links: Courses | Community (Discord) | About
- Right side: "Start Learning" button in amber accent
- Keep existing mobile hamburger pattern
- Keep scroll-direction hiding behavior

The nav links replace the current "Course" + DiscordInviteButton layout. The "Start Learning" button is the amber CTA. UserMenu stays for authenticated users.

Desktop right side order: nav links → UserMenu → Start Learning button.

```tsx
{/* Desktop nav links */}
<div className="flex items-center gap-6">
  <a href="/course/default" className="font-medium text-sm hover:text-[var(--landing-text)] transition-colors" style={{ color: "var(--landing-text-muted)" }}>
    Courses
  </a>
  <a href={DISCORD_INVITE_URL} className="font-medium text-sm hover:text-[var(--landing-text)] transition-colors" style={{ color: "var(--landing-text-muted)" }}>
    Community
  </a>
  <a href="/about" className="font-medium text-sm hover:text-[var(--landing-text)] transition-colors" style={{ color: "var(--landing-text-muted)" }}>
    About
  </a>
  <UserMenu signInRedirect="/course" compact />
  <a
    href="/course/default/module/introduction"
    className="px-5 py-2 rounded-full text-sm font-semibold transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
    style={{
      backgroundColor: "var(--landing-accent)",
      color: "var(--landing-accent-text)",
    }}
  >
    Start Learning
  </a>
</div>
```

Also update the MobileMenu usage to include the new links (Courses, Community, About) — either update MobileMenu props or inline the links in LandingNav's mobile menu.

**Step 2: Update mobile menu links**

The existing MobileMenu component has hardcoded links. Either:
- (a) Pass links as props to MobileMenu, or
- (b) Create a landing-specific mobile menu inline in LandingNav

Option (b) is simpler — inline a landing-specific mobile overlay in LandingNav since MobileMenu is also used elsewhere and shouldn't be changed for landing-only nav items.

**Step 3: Verify**

Run: `cd web_frontend && npm run build`
Expected: Build succeeds.

**Step 4: Commit**

```
feat: update LandingNav with new design and links
```

---

### Task 5: Build the landing page

**Files:**
- Modify: `web_frontend/src/pages/index/+Page.tsx`

This is the main task. All sections are inline in one file. Reference the design doc at `docs/plans/2026-03-11-landing-page-design.md` for section details and copy.

**Step 1: Write the complete landing page**

The page structure:

```tsx
import { LandingNav } from "@/components/LandingNav";
import { LandingFooter } from "@/components/LandingFooter";
import { Target, MessageSquare, Users } from "lucide-react";
import { DISCORD_INVITE_URL } from "@/config";

export default function LandingPage() {
  return (
    <div style={{ fontFamily: "var(--landing-font-body)", backgroundColor: "var(--landing-bg)", color: "var(--landing-text)" }}>
      <LandingNav />

      {/* Hero */}
      <section className="pt-32 pb-20 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h1
            className="text-4xl sm:text-5xl lg:text-6xl font-normal tracking-tight mb-8 leading-tight"
            style={{ fontFamily: "var(--landing-font-display)" }}
          >
            Understand why superintelligence might end everything — and what to do about it.
          </h1>
          <p className="text-lg sm:text-xl mb-2" style={{ color: "var(--landing-text-muted)" }}>
            A free, in-depth course on the AI risk that actually keeps researchers up at night.
          </p>
          <p className="text-lg sm:text-xl mb-10" style={{ color: "var(--landing-text-muted)" }}>
            Learn with a 1-on-1 AI tutor. No application process.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-4">
            <a
              href="/course/default/module/introduction"
              className="w-full sm:w-auto px-8 py-3.5 rounded-full font-semibold text-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl"
              style={{ backgroundColor: "var(--landing-accent)", color: "var(--landing-accent-text)" }}
            >
              Start Learning
            </a>
            <a
              href="/enroll"
              className="w-full sm:w-auto px-8 py-3.5 rounded-full font-semibold text-lg border-2 transition-all duration-200 hover:-translate-y-0.5"
              style={{ borderColor: "var(--landing-border)", color: "var(--landing-text)" }}
            >
              Enroll in the Course
            </a>
          </div>
          <p className="text-sm mb-3" style={{ color: "var(--landing-text-muted)" }}>
            Takes 1 minute to get started.
          </p>
          <p className="text-sm" style={{ color: "var(--landing-text-muted)" }}>
            Free. Funded by people who believe AI Safety education should reach everyone.
          </p>

          {/* Product screenshot placeholder */}
          <div className="mt-16 mx-auto max-w-4xl">
            <div className="rounded-xl overflow-hidden shadow-2xl border" style={{ borderColor: "var(--landing-border)" }}>
              <img
                src="/assets/screenshots/course-interface.png"
                alt="Lens Academy course interface with AI tutor"
                className="w-full"
              />
            </div>
          </div>
        </div>
      </section>

      {/* The Problem */}
      <section className="py-20 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <p className="text-lg sm:text-xl leading-relaxed" style={{ color: "var(--landing-text-muted)" }}>
            Lots of people have heard of AI Safety. Far fewer can actually explain why alignment is hard, or articulate why superintelligence might pose an existential risk. We think closing that gap is one of the most important things that can happen right now.
          </p>
        </div>
      </section>

      {/* What Makes This Different — 3 cards */}
      <section className="py-20 px-4" style={{ backgroundColor: "var(--landing-bg-alt)" }}>
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Card 1 */}
            <div className="p-8">
              <Target className="w-8 h-8 mb-4" style={{ color: "var(--landing-accent)" }} />
              <h3 className="text-xl font-semibold mb-3" style={{ fontFamily: "var(--landing-font-display)" }}>
                Deep, not broad
              </h3>
              <p style={{ color: "var(--landing-text-muted)" }}>
                We don't survey all of AI Safety. We go deep on misaligned superintelligence — why alignment is genuinely hard, and how to think strategically about what to work on.
              </p>
            </div>
            {/* Card 2 */}
            <div className="p-8">
              <MessageSquare className="w-8 h-8 mb-4" style={{ color: "var(--landing-accent)" }} />
              <h3 className="text-xl font-semibold mb-3" style={{ fontFamily: "var(--landing-font-display)" }}>
                Learn with an AI tutor
              </h3>
              <p style={{ color: "var(--landing-text-muted)" }}>
                You don't just read articles. Our AI tutor asks you hard questions, challenges your reasoning, and pushes your understanding until you can actually explain the ideas yourself.
              </p>
            </div>
            {/* Card 3 */}
            <div className="p-8">
              <Users className="w-8 h-8 mb-4" style={{ color: "var(--landing-accent)" }} />
              <h3 className="text-xl font-semibold mb-3" style={{ fontFamily: "var(--landing-font-display)" }}>
                Learn with a cohort
              </h3>
              <p style={{ color: "var(--landing-text-muted)" }}>
                Weekly group discussions with other students. Work through the hardest ideas together and build connections with others who care about getting this right.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Our Courses — 2 cards */}
      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <h2
            className="text-3xl sm:text-4xl font-normal text-center mb-12"
            style={{ fontFamily: "var(--landing-font-display)" }}
          >
            Our Courses
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Intro course */}
            <div className="p-8 rounded-xl border" style={{ borderColor: "var(--landing-border)", backgroundColor: "var(--landing-bg-alt)" }}>
              <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold mb-4" style={{ backgroundColor: "var(--landing-accent)", color: "var(--landing-accent-text)" }}>
                Available now
              </span>
              <h3 className="text-2xl font-semibold mb-3" style={{ fontFamily: "var(--landing-font-display)" }}>
                Introduction to AI Safety
              </h3>
              <p className="mb-6" style={{ color: "var(--landing-text-muted)" }}>
                Our core course with AI tutoring. Understand why alignment is hard and what to do about it.
              </p>
              <a
                href="/course/default/module/introduction"
                className="inline-block px-6 py-2.5 rounded-full font-semibold transition-all duration-200 hover:-translate-y-0.5"
                style={{ backgroundColor: "var(--landing-accent)", color: "var(--landing-accent-text)" }}
              >
                Start Learning
              </a>
            </div>
            {/* Book club */}
            <div className="p-8 rounded-xl border" style={{ borderColor: "var(--landing-border)", backgroundColor: "var(--landing-bg-alt)" }}>
              <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold mb-4 border" style={{ borderColor: "var(--landing-border)", color: "var(--landing-text-muted)" }}>
                Starting April 2026
              </span>
              <h3 className="text-2xl font-semibold mb-3" style={{ fontFamily: "var(--landing-font-display)" }}>
                Book Club: If Anyone Builds It, Everyone Dies
              </h3>
              <p className="mb-6" style={{ color: "var(--landing-text-muted)" }}>
                Read and discuss the book with a cohort. Weekly sessions exploring the core arguments.
              </p>
              <a
                href="/course/default/module/introduction"
                className="inline-block px-6 py-2.5 rounded-full font-semibold border transition-all duration-200 hover:-translate-y-0.5"
                style={{ borderColor: "var(--landing-border)", color: "var(--landing-text)" }}
              >
                Try the intro module
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Who This Is For */}
      <section className="py-20 px-4" style={{ backgroundColor: "var(--landing-bg-alt)" }}>
        <div className="max-w-2xl mx-auto text-center space-y-6">
          <p className="text-xl sm:text-2xl italic" style={{ fontFamily: "var(--landing-font-display)" }}>
            "You've heard of AI Safety but couldn't explain the core argument to a friend."
          </p>
          <p className="text-xl sm:text-2xl italic" style={{ fontFamily: "var(--landing-font-display)" }}>
            "You want to contribute to AI Safety but aren't sure where to start."
          </p>
        </div>
      </section>

      {/* For AI Safety Experts */}
      <section className="py-12 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <p className="text-sm" style={{ color: "var(--landing-text-muted)" }}>
            Already working in AI Safety? We'd love your feedback.{" "}
            <a href="/course/default" className="underline hover:text-[var(--landing-text)] transition-colors">
              Review our curriculum
            </a>{" "}
            and tell us what's missing.
          </p>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="py-20 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-6">
            <a
              href="/course/default/module/introduction"
              className="w-full sm:w-auto px-8 py-3.5 rounded-full font-semibold text-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl"
              style={{ backgroundColor: "var(--landing-accent)", color: "var(--landing-accent-text)" }}
            >
              Start Learning
            </a>
            <a
              href="/enroll"
              className="w-full sm:w-auto px-8 py-3.5 rounded-full font-semibold text-lg border-2 transition-all duration-200 hover:-translate-y-0.5"
              style={{ borderColor: "var(--landing-border)", color: "var(--landing-text)" }}
            >
              Enroll in the Course
            </a>
          </div>
          <p className="text-sm" style={{ color: "var(--landing-text-muted)" }}>
            Free. No application process. Takes 1 minute to get started.
          </p>
        </div>
      </section>

      <LandingFooter />
    </div>
  );
}
```

Use the frontend-design skill's aesthetic guidelines to refine:
- Typography sizing and spacing
- Card visual treatment (shadows, borders, hover states)
- Scroll-triggered fade-in animations (CSS-only, using `@keyframes` + intersection observer or `animation-timeline: view()`)
- Screenshot browser-frame mockup styling
- Overall rhythm and pacing between sections

The code above is the structural skeleton. The implementing engineer should apply the frontend-design aesthetic judgment to make it visually distinctive — not generic.

**Step 2: Verify build**

Run: `cd web_frontend && npm run build`
Expected: Build succeeds.

**Step 3: Verify visually**

Start dev server: `cd web_frontend && npm run dev`
Navigate to `http://dev.vps:3100/` and check:
- Fonts load (Instrument Serif for headlines, DM Sans for body)
- Color palette applies (cream bg, amber CTAs)
- Responsive: check mobile (< 768px) and desktop
- All links point correctly
- Screenshot placeholder area visible

**Step 4: Commit**

```
feat: build new landing page with editorial design
```

---

### Task 6: Add screenshot assets

**Files:**
- Create: `web_frontend/public/assets/screenshots/` directory

**Step 1: Create screenshots directory**

```bash
mkdir -p web_frontend/public/assets/screenshots
```

**Step 2: Add placeholder**

The user will provide actual screenshot images. For now, create a simple placeholder or leave the `<img>` tag pointing to the expected path. The image path is `/assets/screenshots/course-interface.png`.

If no image is available yet, wrap the `<img>` in a conditional or use a colored placeholder div:

```tsx
<div className="aspect-video rounded-xl bg-slate-100 flex items-center justify-center text-slate-400">
  Screenshot placeholder
</div>
```

**Step 3: Commit**

```
feat: add screenshot assets directory
```

---

### Task 7: Create /about page (placeholder)

**Files:**
- Create: `web_frontend/src/pages/about/+Page.tsx`

**Step 1: Create basic about page**

```tsx
import { LandingNav } from "@/components/LandingNav";
import { LandingFooter } from "@/components/LandingFooter";

export default function AboutPage() {
  return (
    <div style={{ fontFamily: "var(--landing-font-body)", backgroundColor: "var(--landing-bg)", color: "var(--landing-text)" }}>
      <LandingNav />

      <main className="pt-32 pb-20 px-4">
        <div className="max-w-2xl mx-auto">
          <h1
            className="text-4xl sm:text-5xl font-normal tracking-tight mb-8"
            style={{ fontFamily: "var(--landing-font-display)" }}
          >
            About Lens Academy
          </h1>
          <p className="text-lg" style={{ color: "var(--landing-text-muted)" }}>
            Content coming soon.
          </p>
        </div>
      </main>

      <LandingFooter />
    </div>
  );
}
```

**Step 2: Add page title**

Create `web_frontend/src/pages/about/+title.ts`:

```ts
export const title = "About — Lens Academy";
```

**Step 3: Verify**

Run: `cd web_frontend && npm run build`
Navigate to `http://dev.vps:3100/about` — should show placeholder about page with same nav/footer styling.

**Step 4: Commit**

```
feat: add placeholder /about page with shared nav/footer
```

---

### Task 8: Update meta description

**Files:**
- Modify: `web_frontend/src/pages/+Head.tsx`

**Step 1: Update meta description**

```tsx
<meta
  name="description"
  content="Understand why superintelligence might end everything — and what to do about it. A free, in-depth AI Safety course with a 1-on-1 AI tutor. No application process."
/>
```

**Step 2: Commit**

```
feat: update meta description for landing page
```

---

### Task 9: Visual polish pass

**Files:**
- Modify: `web_frontend/src/pages/index/+Page.tsx`

**Step 1: Review in browser and refine**

Use Chrome DevTools MCP to navigate to `http://dev.vps:3100/` and evaluate:
- Typography hierarchy feels right (headline dominant, body comfortable)
- Spacing between sections feels editorial (generous but not wasteful)
- Cards have appropriate visual weight
- CTAs are clearly the primary action
- Mobile layout stacks properly
- Screenshot area integrates well
- Overall page has a warm, confident, non-generic feel

Apply refinements based on what's seen.

**Step 2: Lint check**

Run: `cd web_frontend && npm run lint`
Expected: No errors.

**Step 3: Final build check**

Run: `cd web_frontend && npm run build`
Expected: Build succeeds.

**Step 4: Commit**

```
feat: visual polish for landing page
```
