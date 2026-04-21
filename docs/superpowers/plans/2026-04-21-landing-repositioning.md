# Landing Page Repositioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shift landing page messaging from "education" to "guidance" through four targeted copy edits in two files, with no new sections, no layout changes, and no new tests.

**Architecture:** Pure copy change. Hero carries the repositioning ("We'll help you do something about it" + "Lens guides you…"). Nav CTA label retunes to match. Bottom CTA intentionally untouched. All other sections unchanged.

**Tech Stack:** React 19 + Vike + TypeScript. JSX string literals only; no logic changes.

**Spec:** `docs/superpowers/specs/2026-04-21-landing-repositioning-design.md`

**VCS:** This repo uses `jj` (not git). The working copy is already on change `ttqvtumm` (description: "wip: landing page repositioning implementation"). Edits made in the working copy are auto-captured on every `jj` command. No separate `git add` / `git commit` steps needed — but do run `jj st` frequently to verify.

---

## File Structure

Two files touched, four string replacements total.

- **Modify:** `web_frontend/src/components/LandingNav.tsx`
  - Desktop nav CTA label (line ~128)
  - Mobile nav CTA label (line ~215)
- **Modify:** `web_frontend/src/pages/index/+Page.tsx`
  - Hero `<h1>` headline (line ~166)
  - Hero subhead `<p>` (lines ~172-174)
  - Hero primary CTA label (line ~193)

No new files. No deletions. No tests added (this is copy-only — there is no logic to test).

---

## Task 1: Update nav CTA labels (desktop + mobile)

**Files:**
- Modify: `web_frontend/src/components/LandingNav.tsx` (two occurrences of `Start Learning`)

- [ ] **Step 1: Read the file and confirm both occurrences exist**

Use the Grep tool to search for `Start Learning` in `web_frontend/src/components/LandingNav.tsx` with `output_mode: "content"` and `-n: true`.
Expected: two matches, around lines 128 and 215.

- [ ] **Step 2: Replace both occurrences of the CTA label**

In `web_frontend/src/components/LandingNav.tsx`, replace the text `Start Learning` with `Start with the intro` in **both** places:

1. **Desktop CTA (~line 128)** — inside the `<a href={CTA_HREF}>...</a>` block within the desktop nav:
   ```tsx
   >
     Start Learning
   </a>
   ```
   becomes:
   ```tsx
   >
     Start with the intro
   </a>
   ```

2. **Mobile CTA (~line 215)** — inside the `<a href={CTA_HREF}>...</a>` block within the mobile menu:
   ```tsx
   >
     Start Learning
   </a>
   ```
   becomes:
   ```tsx
   >
     Start with the intro
   </a>
   ```

Use the Edit tool with `replace_all: true` on the exact string `Start Learning` **only if** the grep in Step 1 showed exactly 2 matches in this file. If it showed more (it shouldn't), use two separate Edit calls with surrounding context.

- [ ] **Step 3: Verify both occurrences are updated**

Use the Grep tool to search `Start Learning` in `web_frontend/src/components/LandingNav.tsx`. Expected: **no matches**.

Use the Grep tool to search `Start with the intro` in `web_frontend/src/components/LandingNav.tsx` with `output_mode: "content"`. Expected: two matches (around lines 128 and 215).

- [ ] **Step 4: Verify jj status shows the file as modified**

Run:
```bash
jj st
```
Expected: `M web_frontend/src/components/LandingNav.tsx` appears under "Working copy changes".

---

## Task 2: Update hero headline, subhead, and primary CTA label

**Files:**
- Modify: `web_frontend/src/pages/index/+Page.tsx` (three edits in the hero section, roughly lines 160-194)

- [ ] **Step 1: Replace the hero headline**

In `web_frontend/src/pages/index/+Page.tsx`, find the `<h1>` block (around line 160-166):

```tsx
          <h1
            className="text-[2.25rem] sm:text-[3.5rem] lg:text-[4.25rem] leading-[1.08] tracking-tight mb-8"
            style={fontDisplay}
          >
            Some of the smartest people alive are worried about AI. Understand
            why.
          </h1>
```

Replace the heading text so it reads:

```tsx
          <h1
            className="text-[2.25rem] sm:text-[3.5rem] lg:text-[4.25rem] leading-[1.08] tracking-tight mb-8"
            style={fontDisplay}
          >
            Some of the smartest people alive are worried about AI. We&rsquo;ll
            help you do something about it.
          </h1>
```

Note: use `&rsquo;` for the apostrophe in "We'll" to match the codebase convention (seen elsewhere in the file, e.g. "We're", "you're").

- [ ] **Step 2: Replace the hero subhead**

In the same file, find the subhead `<p>` (around lines 168-174):

```tsx
          <p
            className="text-lg sm:text-xl max-w-2xl mx-auto mb-10 leading-relaxed"
            style={{ color: "var(--landing-text-muted)" }}
          >
            Learn why superintelligent AI could be catastrophic for
            humanity&thinsp;&mdash;&thinsp;and what to do about it.
          </p>
```

Replace the subhead text so it reads:

```tsx
          <p
            className="text-lg sm:text-xl max-w-2xl mx-auto mb-10 leading-relaxed"
            style={{ color: "var(--landing-text-muted)" }}
          >
            Lens guides you from first understanding why superintelligent AI
            could be catastrophic&thinsp;&mdash;&thinsp;to finding what you,
            specifically, can do about it.
          </p>
```

Note: preserve the `&thinsp;&mdash;&thinsp;` em-dash entity exactly — it's the codebase pattern for dashes.

- [ ] **Step 3: Replace the hero primary CTA label**

In the same file, find the primary CTA `<a>` inside the hero (around lines 177-194):

```tsx
            <a
              href="/course/default/module/introduction"
              className="inline-flex items-center justify-center px-7 py-3.5 rounded-lg text-base font-semibold transition-colors duration-200"
              style={{
                backgroundColor: "var(--landing-accent)",
                color: "var(--landing-accent-text)",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor =
                  "var(--landing-accent-hover)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.backgroundColor =
                  "var(--landing-accent)")
              }
            >
              Start Learning
            </a>
```

Change only the button text `Start Learning` → `Start with the intro` so the closing becomes:

```tsx
            >
              Start with the intro
            </a>
```

**Leave unchanged:** the second `<a href="/enroll">...Enroll in a Course...</a>` block immediately below it, and the second `Start Learning` button at the bottom of the page (around line 625 — this is the bottom CTA section, which the spec explicitly leaves as-is).

- [ ] **Step 4: Verify only one `Start Learning` remains in the page (the bottom CTA)**

Use the Grep tool to search `Start Learning` in `web_frontend/src/pages/index/+Page.tsx` with `output_mode: "content"`. Expected: exactly one match, at approximately line 625 (inside the `{/* BOTTOM CTA */}` section). If there are zero or two matches, something went wrong — recheck the edits.

- [ ] **Step 5: Verify the new hero copy is present**

Use the Grep tool on `web_frontend/src/pages/index/+Page.tsx` for each of:
- `We&rsquo;ll` — expected: at least one match (the hero headline)
- `Lens guides you` — expected: at least one match (the hero subhead)
- `Start with the intro` — expected: exactly one match (the hero CTA)

- [ ] **Step 6: Verify jj status shows both files modified**

Run:
```bash
jj st
```
Expected: both `web_frontend/src/components/LandingNav.tsx` and `web_frontend/src/pages/index/+Page.tsx` appear under "Working copy changes" as `M`.

---

## Task 3: Verification — lint, build, visual check

**Files:** none modified in this task.

- [ ] **Step 1: Run ESLint**

From the repo root:
```bash
cd web_frontend && npm run lint
```
Expected: exits 0 with no errors. Warnings are OK but should not be new.

- [ ] **Step 2: Run the production build**

From `web_frontend/`:
```bash
npm run build
```
Expected: TypeScript compiles cleanly and Vike/Vite finishes the build without errors. This verifies the JSX is syntactically valid and the HTML entities are well-formed.

- [ ] **Step 3: Check the running dev server (do not start a new one if one is already running)**

Run:
```bash
./scripts/list-servers
```
from repo root. If a frontend server for **this workspace** (`ws1`) is already listed on port 3100, proceed to Step 4. If no server for `ws1` is running, start one:

```bash
cd web_frontend && npm run dev
```
and wait until Vite logs `ready in Xms` before proceeding. Never kill servers from other workspaces.

- [ ] **Step 4: Visual check with Chrome DevTools MCP**

Using the Chrome DevTools MCP tools (the MCP connects to Chrome on the user's Windows device, which reaches the VPS via `dev.vps`):

1. Navigate to `http://dev.vps:3100/`.
2. Take a snapshot of the hero section. Verify:
   - Headline reads: `Some of the smartest people alive are worried about AI. We'll help you do something about it.` (the `&rsquo;` should render as a typographic apostrophe)
   - Subhead reads: `Lens guides you from first understanding why superintelligent AI could be catastrophic — to finding what you, specifically, can do about it.`
   - Primary CTA button reads: `Start with the intro`
   - Secondary CTA button still reads: `Enroll in a Course`
3. Scroll to the nav bar (top). Verify the top-right CTA reads: `Start with the intro`.
4. Scroll to the bottom of the page. Verify the `Try the intro module today` section's button still reads: `Start Learning` (this is the intentional deferral per spec).
5. Verify no console errors in the DevTools console.

- [ ] **Step 5: Mobile nav check**

Resize the Chrome DevTools page to a mobile width (e.g. 375×812) and:
1. Reload `http://dev.vps:3100/`.
2. Click the hamburger menu (top right).
3. Verify the CTA button inside the mobile menu reads: `Start with the intro`.

- [ ] **Step 6: Final jj status**

Run:
```bash
jj st
```
Expected: two files modified — `web_frontend/src/components/LandingNav.tsx` and `web_frontend/src/pages/index/+Page.tsx`. Nothing else.

---

## Post-implementation

Once all three tasks pass, the orchestrator (not the subagent) will:
1. Re-describe the current jj change from `wip: landing page repositioning implementation` to a clean commit message like `feat: reposition landing page from education to guidance`.
2. Optionally open a PR (user will decide).

Subagents should NOT run `jj commit`, `jj push`, or `gh pr create` — those are orchestrator decisions.
