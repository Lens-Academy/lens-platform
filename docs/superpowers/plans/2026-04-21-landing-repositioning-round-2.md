# Landing Page Repositioning Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebalance the landing page toward the program/guidance framing by reframing one differentiator card, tweaking one paragraph, and adding one new Lens Coach section — all in a single TSX file.

**Architecture:** Three isolated copy/layout edits in `web_frontend/src/pages/index/+Page.tsx`. No new files, no new imports, no new assets. The Coach section reuses existing styling tokens (`var(--landing-bg-alt)`, `var(--landing-accent)`, `fontDisplay`, `RevealSection`) and patterns borrowed from the Course cards and the Superintelligence 101 badge.

**Tech Stack:** React 19 + Vike + TypeScript + Tailwind CSS v4. Lucide-react icons (no new icon needed — `MessageSquare` stays).

**Spec:** `docs/superpowers/specs/2026-04-21-landing-repositioning-round-2-design.md`

**VCS:** This repo uses `jj` (not git). The working copy is already on an empty change with description `docs: spec for landing repositioning round 2`. Before starting the first code task, the orchestrator will create a fresh implementation change. Subagents should NOT run `jj commit`, `jj push`, `git add`, `git commit`, or any PR command. They may run read-only jj commands (`jj st`, `jj diff --git`).

**Important jj note:** `jj diff` default output uses inline word-diff formatting that can be confusing without colors (e.g. a change from "foo" to "bar" may render as "foobar"). **Always use `jj diff --git`** when inspecting diffs.

---

## File Structure

**One file modified, three edits:**

- **Modify:** `web_frontend/src/pages/index/+Page.tsx`
  - Change 1: Middle card in the 3-card section (currently lines ~273-277: `title: "AI Tutoring"`, `body: "..."`)
  - Change 2: Paragraph under "A tailor-made program" (currently lines ~247-251)
  - Change 3: Insert a new `<RevealSection>` for Lens Coach, between the 3-card `</section>` (currently line ~315) and the `{/* OUR COURSES */}` comment (currently line ~317)

No new files. No deletions. No tests added — these are copy/layout additions with no logic.

---

## Task 1: Replace the middle card (AI Tutoring → AI Guidance)

**Files:**
- Modify: `web_frontend/src/pages/index/+Page.tsx` (the card object literal with `icon: MessageSquare`, around lines 273-277)

**Context:** The 3-card differentiator section builds cards by mapping over an inline array literal. Each object has `icon`, `title`, and `body` fields. The `body` is a JavaScript string, so HTML entities (`&mdash;`, `&thinsp;`, `&rsquo;`) do NOT work — use Unicode characters (e.g. `—` for em-dash, `’` for typographic apostrophe) or plain ASCII. The existing cards already use this pattern (card #3 uses the Unicode escape `’` in a string literal).

- [ ] **Step 1: Confirm the middle card exists in the expected form**

Use the Grep tool with `output_mode: "content"` to search for `title: "AI Tutoring"` in `/home/penguin/code/lens-platform/ws1/web_frontend/src/pages/index/+Page.tsx`. Expected: exactly one match (currently around line 275).

- [ ] **Step 2: Edit the card's title and body**

Use the Edit tool on `/home/penguin/code/lens-platform/ws1/web_frontend/src/pages/index/+Page.tsx`.

old_string (exact, including indentation):
```
              {
                icon: MessageSquare,
                title: "AI Tutoring",
                body: "Your AI tutor meets you where you are, challenges your reasoning, and stays with you until things actually click.",
              },
```

new_string (exact):
```
              {
                icon: MessageSquare,
                title: "AI Guidance",
                body: "In courses, our AI tutor meets you where you are. Lens Coach, coming soon, stays with you beyond courses too — from first curiosity through meaningful action.",
              },
```

Notes:
- The em-dash `—` is Unicode U+2014; it is a single character, not the HTML entity `&mdash;`. This is a JS string literal, so entities do not work here.
- Do NOT change cards #1 (`title: "Focused, Not Broad"`) or #3 (`title: "Group Discussions"`).
- Do NOT change the import of `MessageSquare` — the icon stays the same.

- [ ] **Step 3: Verify the edit**

Use Grep in the file:
- Search `title: "AI Tutoring"` → expected: 0 matches
- Search `title: "AI Guidance"` → expected: 1 match
- Search `Lens Coach, coming soon, stays with you beyond courses too` → expected: 1 match

- [ ] **Step 4: Verify via jj diff**

Run:
```bash
jj diff --git web_frontend/src/pages/index/+Page.tsx
```
Expected: a hunk around lines 273-277 with two `-`/`+` pairs (title line and body line). No other hunks should appear yet (Changes 2 and 3 are separate tasks).

- [ ] **Step 5: Verify jj status**

Run: `jj st`
Expected: `M web_frontend/src/pages/index/+Page.tsx` in working copy changes.

---

## Task 2: Update paragraph under "A tailor-made program"

**Files:**
- Modify: `web_frontend/src/pages/index/+Page.tsx` (the right-column paragraph of the screenshot section, currently lines ~247-251)

**Context:** This is a JSX text node (not a JS string), so HTML entities like `&rsquo;`, `&thinsp;`, and `&mdash;` are used. The paragraph currently uses the phrase `building a learning experience grounded in evidence-based principles`. Change `learning experience` → `program` and re-flow the text to match the original's ~65-column wrap.

- [ ] **Step 1: Confirm the paragraph exists in the expected form**

Use Grep to search `building a learning` in `/home/penguin/code/lens-platform/ws1/web_frontend/src/pages/index/+Page.tsx`. Expected: 1 match (currently around line 248).

- [ ] **Step 2: Edit the paragraph**

Use the Edit tool.

old_string (exact, including leading whitespace):
```
                Designed by a team with years of AI Safety experience and formal
                training in education. We&rsquo;re building a learning
                experience grounded in evidence-based
                principles&thinsp;&mdash;&thinsp;from the course design to the
                AI tutor.
```

new_string (exact):
```
                Designed by a team with years of AI Safety experience and formal
                training in education. We&rsquo;re building a program grounded
                in evidence-based principles&thinsp;&mdash;&thinsp;from the
                course design to the AI tutor.
```

Notes:
- Preserve `&rsquo;`, `&thinsp;`, and `&mdash;` entities — they're JSX text.
- The wrap is re-flowed so each line stays ~65 columns like neighboring JSX.
- The paragraph is shorter by two words (`learning experience` → `program`) so one line is eliminated.

- [ ] **Step 3: Verify the edit**

Use Grep in the file:
- Search `building a learning` → expected: 0 matches
- Search `building a program grounded` → expected: 1 match
- Search `experience grounded` → expected: 0 matches (old middle-of-paragraph text is gone)

- [ ] **Step 4: Verify via jj diff**

Run: `jj diff --git web_frontend/src/pages/index/+Page.tsx`
Expected: two hunks now — the Task 1 hunk (middle card) and the new Task 2 hunk (paragraph re-flow). The Task 2 hunk should be clean: only the paragraph's 5-line block is changed to a 4-line block, nothing else near it.

---

## Task 3: Insert the Lens Coach section

**Files:**
- Modify: `web_frontend/src/pages/index/+Page.tsx` (insert a new `<RevealSection>` between the 3-card `</section>` and the `{/* OUR COURSES */}` comment — currently around line 316)

**Context:** The existing page alternates `<section>` (for full-bleed colored bands) and `<RevealSection>` (for animated-on-scroll blocks on the default background). The new Coach section fits the latter pattern. It is a single card (not a grid), centered in `max-w-3xl`, styled like the Course cards with a `Coming soon` badge modeled on the `STARTING 20 APRIL 2026` badge. Surrounding JSX uses 6-space indentation for top-level page children.

- [ ] **Step 1: Confirm the insertion point exists in the expected form**

Use Grep with `output_mode: "content"` and `-n: true` to search `/\* OUR COURSES` in `/home/penguin/code/lens-platform/ws1/web_frontend/src/pages/index/+Page.tsx`. Expected: 1 match (currently at line 318). The insertion goes BEFORE the comment block that contains `OUR COURSES`.

Also use Grep to search `</section>` in the file. The 3-card section's closing `</section>` is the one immediately preceding the `OUR COURSES` comment (currently line ~315). That closing tag and the blank line after it are where the new section inserts.

- [ ] **Step 2: Insert the new section**

Use the Edit tool on `/home/penguin/code/lens-platform/ws1/web_frontend/src/pages/index/+Page.tsx`.

old_string (exact — this is the closing of the 3-card section followed by the blank line and the `OUR COURSES` comment header):
```
      </section>

      {/* ================================================================= */}
      {/* OUR COURSES                                                       */}
      {/* ================================================================= */}
```

new_string (exact — inserts the Coach section between `</section>` and the `OUR COURSES` comment):
```
      </section>

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

      {/* ================================================================= */}
      {/* OUR COURSES                                                       */}
      {/* ================================================================= */}
```

Notes:
- The body paragraph uses HTML entities because it's JSX text (not a JS string): `&thinsp;&mdash;&thinsp;` for em-dashes, `&rsquo;` for apostrophes.
- No new imports are required. `RevealSection` is defined in the same file; `fontDisplay` is a local `const`; no new icons are used.
- Indentation: top-level page children use 6 spaces for the opening tag. Nested contents follow the existing file's 2-space nesting.

- [ ] **Step 3: Verify the insertion**

Use Grep in the file (case-sensitive by default):
- Search `LENS COACH` (uppercase) → expected: 1 match (the new section comment)
- Search `Coming soon` (capitalized) → expected: 1 match (the new badge text). The lowercase `coming soon` appears in the comment and the Task 1 card body — that's fine; just confirm the capitalized badge literal is present exactly once.
- Search `Lens Coach` → expected: at least 2 matches (one in the Task 1 card body `Lens Coach, coming soon, stays with you`, one in the new `<h3>Lens Coach</h3>`)
- Search `MATS&rsquo;s research project database` → expected: 1 match
- Search `aisafety.com&rsquo;s directory` → expected: 1 match

- [ ] **Step 4: Verify via jj diff**

Run: `jj diff --git web_frontend/src/pages/index/+Page.tsx`
Expected: three hunks (Task 1 middle card, Task 2 paragraph, Task 3 new section insertion). The Task 3 hunk should be a pure insertion — no deleted lines between the `</section>` and the `OUR COURSES` comment.

- [ ] **Step 5: Verify jj status**

Run: `jj st`
Expected: `M web_frontend/src/pages/index/+Page.tsx` is the only file in working copy changes. No other files modified.

---

## Task 4: Verification — lint, build, Chrome DevTools visual check

**Files:** none modified in this task.

**Context:** A frontend dev server is already running on port 3100 (ws1) with HMR, and a backend on 8100. Changes from Tasks 1-3 should already be reflected in the browser. This task verifies build correctness and visual rendering.

- [ ] **Step 1: Run ESLint**

From `/home/penguin/code/lens-platform/ws1/web_frontend/`:
```bash
npm run lint
```
Expected: exits 0 with 0 errors. Pre-existing warnings in `useTutorChat.ts`, `UnitNavigationPanel.tsx`, `Module.tsx`, and `overview/+Page.tsx` are allowed; no new warnings on `+Page.tsx`.

- [ ] **Step 2: Run production build**

From `/home/penguin/code/lens-platform/ws1/web_frontend/`:
```bash
npm run build
```
Expected: TypeScript + Vike/Vite build finishes cleanly. Output includes `✓ 21 HTML documents pre-rendered.` Any TypeScript error = a JSX or entity mistake; stop and fix.

- [ ] **Step 3: Chrome DevTools — desktop visual check**

Using the Chrome DevTools MCP tools, ensure the page at `http://dev.vps:3100/` is selected (use `list_pages` if needed), then reload it. Take a snapshot and verify:

- The middle card of the 3-card section now shows:
  - Heading: `AI Guidance`
  - Body: `In courses, our AI tutor meets you where you are. Lens Coach, coming soon, stays with you beyond courses too — from first curiosity through meaningful action.`
- Card #1 (`Focused, Not Broad`) and card #3 (`Group Discussions`) are unchanged.
- The paragraph under `A tailor-made program` now reads: `Designed by a team with years of AI Safety experience and formal training in education. We're building a program grounded in evidence-based principles — from the course design to the AI tutor.`
- Between the 3-card section and the `Our Courses` heading, a new block renders with:
  - A `Coming soon` badge (accent-colored pill)
  - An `<h3>` heading: `Lens Coach`
  - A single paragraph containing `alignment research dataset`, `MATS`, and `aisafety.com`
- No console errors introduced by these changes. (Pre-existing Sentry dev-mode warning and 500s on API calls are OK.)

- [ ] **Step 4: Chrome DevTools — mobile visual check**

Resize the page to 375×812 and reload. Take a snapshot and verify:

- The Lens Coach card is full-width minus `px-4`, readable, with the badge stacked above the heading.
- The body paragraph wraps correctly with no overflow.

- [ ] **Step 5: Final jj status**

Run: `jj st`
Expected: exactly one file modified — `web_frontend/src/pages/index/+Page.tsx`. Nothing else.

---

## Post-implementation

Once all four tasks pass verification, the orchestrator (not the subagent) will:

1. Confirm the jj change description is appropriate (e.g. `feat: landing round 2 — AI Guidance card + Lens Coach section`).
2. Consult the user before pushing to any shared branch.

Subagents should NOT run `jj commit`, `jj push`, `gh pr create`, or touch any file outside `web_frontend/src/pages/index/+Page.tsx`.
