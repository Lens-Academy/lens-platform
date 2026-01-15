# Superscript Citations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable superscript rendering for Wikipedia citation links in the ArticlePanel component.

**Architecture:** Add `rehype-raw` plugin to ReactMarkdown to allow HTML pass-through, then wrap existing citation links in `<sup>` tags in the markdown file.

**Tech Stack:** React, react-markdown, rehype-raw, sed

**Design Doc:** `docs/plans/2026-01-15-superscript-citations-design.md`

---

### Task 1: Install rehype-raw dependency

**Files:**
- Modify: `web_frontend/package.json`

**Step 1: Install the package**

Run:
```bash
cd /home/penguin/code-in-WSL/ai-safety-course-platform-ws2/web_frontend && npm install rehype-raw
```

Expected: Package added to dependencies, package-lock.json updated.

**Step 2: Verify installation**

Run:
```bash
grep rehype-raw /home/penguin/code-in-WSL/ai-safety-course-platform-ws2/web_frontend/package.json
```

Expected: Line showing `"rehype-raw": "^X.X.X"` in dependencies.

**Step 3: Commit**

```bash
jj describe -m "chore: add rehype-raw dependency for HTML in markdown"
```

---

### Task 2: Add rehype-raw to ArticlePanel

**Files:**
- Modify: `web_frontend/src/components/unified-lesson/ArticlePanel.tsx:2-3` (imports)
- Modify: `web_frontend/src/components/unified-lesson/ArticlePanel.tsx:120` (plugin config)

**Step 1: Add import**

In `ArticlePanel.tsx`, add after line 3 (`import remarkGfm from "remark-gfm";`):

```tsx
import rehypeRaw from "rehype-raw";
```

**Step 2: Add plugin to ReactMarkdown**

In `ArticlePanel.tsx`, find line 120:
```tsx
remarkPlugins={[remarkGfm]}
```

Add the rehypePlugins prop after it:
```tsx
remarkPlugins={[remarkGfm]}
rehypePlugins={[rehypeRaw]}
```

**Step 3: Verify TypeScript compiles**

Run:
```bash
cd /home/penguin/code-in-WSL/ai-safety-course-platform-ws2/web_frontend && npx tsc --noEmit
```

Expected: No errors.

**Step 4: Commit**

```bash
jj describe -m "feat: enable HTML pass-through in ArticlePanel markdown"
```

---

### Task 3: Transform citations in Wikipedia article

**Files:**
- Modify: `educational_content/articles/wikipedia-existential-risk-from-ai.md`

**Step 1: Count citations before transformation**

Run:
```bash
grep -c '\[\[[0-9a-zA-Z]*\]\](' /home/penguin/code-in-WSL/ai-safety-course-platform-ws2/educational_content/articles/wikipedia-existential-risk-from-ai.md
```

Expected: `98` (95 numbered + 3 lettered citations)

**Step 2: Transform citations to superscript**

Run:
```bash
sed -i 's/\(\[\[[0-9a-zA-Z]*\]\]([^)]*)\)/<sup>\1<\/sup>/g' /home/penguin/code-in-WSL/ai-safety-course-platform-ws2/educational_content/articles/wikipedia-existential-risk-from-ai.md
```

Expected: No output (in-place edit).

**Step 3: Verify citations transformed**

Run:
```bash
grep -c '<sup>\[\[' /home/penguin/code-in-WSL/ai-safety-course-platform-ws2/educational_content/articles/wikipedia-existential-risk-from-ai.md
```

Expected: `98`

**Step 4: Verify References section unchanged**

Run:
```bash
grep '1\. *\^' /home/penguin/code-in-WSL/ai-safety-course-platform-ws2/educational_content/articles/wikipedia-existential-risk-from-ai.md | head -1
```

Expected: Line starting with `1.` and containing `^` (References format intact).

**Step 5: Commit**

```bash
jj describe -m "content: wrap Wikipedia citations in superscript tags"
```

---

### Task 4: Build and visual verification

**Step 1: Build frontend**

Run:
```bash
cd /home/penguin/code-in-WSL/ai-safety-course-platform-ws2/web_frontend && npm run build
```

Expected: Build succeeds with no errors.

**Step 2: Visual verification (manual)**

Run dev server and navigate to a lesson that displays the Wikipedia article. Confirm:
- [ ] Citations appear as superscript (smaller, raised text)
- [ ] Citations are still clickable links
- [ ] References section at bottom is unchanged

**Step 3: Final commit with all changes**

```bash
jj describe -m "feat: superscript citations in Wikipedia articles

- Add rehype-raw plugin to enable HTML in markdown
- Wrap inline citations in <sup> tags
- References section unchanged"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Install rehype-raw | package.json |
| 2 | Add plugin to ArticlePanel | ArticlePanel.tsx |
| 3 | Transform citations | wikipedia-existential-risk-from-ai.md |
| 4 | Build and verify | - |

**Total steps:** 15
**Estimated time:** 10-15 minutes
