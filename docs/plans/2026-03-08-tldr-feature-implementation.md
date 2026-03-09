# TLDR Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `tldr` frontmatter field to lenses, pipe it through the content processor to the API, and surface it in the course overview and a new section-navigation modal.

**Architecture:** The `tldr` field is added to lens frontmatter, validated by the content processor (<=80 words), carried through `ParsedLens` → flattened `Section` → API response → frontend types. Two new UI surfaces consume it: a TLDR line in the course overview stage list, and a "What's Next" modal that appears when completing a section with optional content following.

**Tech Stack:** TypeScript (content processor, vitest), Python (FastAPI backend), React + Tailwind (frontend)

---

### Task 1: Add `tldr` to Content Schema

**Files:**
- Modify: `content_processor/src/content-schema.ts:34`

**Step 1: Update the lens schema**

In `content-schema.ts`, line 34, add `'tldr'` to the lens optional fields:

```typescript
// Before:
'lens': contentSchema(['id'], ['tags']),

// After:
'lens': contentSchema(['id'], ['tldr', 'tags']),
```

**Step 2: Run content processor tests**

Run: `cd content_processor && npx vitest run`
Expected: All existing tests pass (no tests reference `tldr` yet).

**Step 3: Commit**

```
feat(content): add tldr to lens schema optional fields
```

---

### Task 2: Parse and Validate `tldr` in Lens Parser

**Files:**
- Modify: `content_processor/src/parser/lens.ts:84-87` (ParsedLens interface)
- Modify: `content_processor/src/parser/lens.ts:748` (lens construction)
- Test: `content_processor/src/parser/lens.test.ts`

**Step 1: Write the failing tests**

Add these tests to `content_processor/src/parser/lens.test.ts`:

```typescript
it('parses tldr from frontmatter', () => {
  const content = `---
id: 550e8400-e29b-41d4-a716-446655440002
tldr: How cognitive biases affect our ability to evaluate AI risk
---

### Page: Introduction

#### Text
content:: Some content.
`;
  const result = parseLens(content, 'Lenses/lens1.md');
  expect(result.lens?.tldr).toBe('How cognitive biases affect our ability to evaluate AI risk');
  expect(result.errors).toHaveLength(0);
});

it('sets tldr to undefined when not present', () => {
  const content = `---
id: 550e8400-e29b-41d4-a716-446655440002
---

### Page: Introduction

#### Text
content:: Some content.
`;
  const result = parseLens(content, 'Lenses/lens1.md');
  expect(result.lens?.tldr).toBeUndefined();
});

it('emits error when tldr exceeds 80 words', () => {
  const longTldr = Array(81).fill('word').join(' ');
  const content = `---
id: 550e8400-e29b-41d4-a716-446655440002
tldr: ${longTldr}
---

### Page: Introduction

#### Text
content:: Some content.
`;
  const result = parseLens(content, 'Lenses/lens1.md');
  expect(result.errors).toContainEqual(
    expect.objectContaining({
      message: expect.stringContaining('tldr'),
      severity: 'error',
    })
  );
});

it('accepts tldr at exactly 80 words', () => {
  const exactTldr = Array(80).fill('word').join(' ');
  const content = `---
id: 550e8400-e29b-41d4-a716-446655440002
tldr: ${exactTldr}
---

### Page: Introduction

#### Text
content:: Some content.
`;
  const result = parseLens(content, 'Lenses/lens1.md');
  expect(result.errors.filter(e => e.message.includes('tldr'))).toHaveLength(0);
});
```

**Step 2: Run tests to verify they fail**

Run: `cd content_processor && npx vitest run src/parser/lens.test.ts`
Expected: FAIL — `tldr` property doesn't exist on `ParsedLens`.

**Step 3: Add `tldr` to ParsedLens interface and construction**

In `content_processor/src/parser/lens.ts`, update the `ParsedLens` interface (line ~84):

```typescript
export interface ParsedLens {
  id: string;
  tldr?: string;
  sections: ParsedLensSection[];
}
```

In the `parseLens` function (line ~748), update the lens construction to include `tldr` and add validation:

```typescript
  // After frontmatter validation, before section parsing, add tldr validation:
  const tldr = typeof frontmatter.tldr === 'string' ? frontmatter.tldr : undefined;
  if (tldr) {
    const wordCount = tldr.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount > 80) {
      errors.push({
        file,
        line: 2,
        message: `tldr exceeds 80 words (has ${wordCount})`,
        suggestion: 'Shorten the tldr to 80 words or fewer',
        severity: 'error',
      });
    }
  }

  // ... existing section parsing code ...

  // In the lens construction at the end:
  const lens: ParsedLens = {
    id: frontmatter.id as string,
    tldr,
    sections: parsedSections,
  };
```

The `tldr` extraction and validation should go after the frontmatter validation block (after line ~596, the `id` type check), and the `tldr` field goes into the lens construction at line ~748.

**Step 4: Run tests to verify they pass**

Run: `cd content_processor && npx vitest run src/parser/lens.test.ts`
Expected: All tests pass.

**Step 5: Commit**

```
feat(content): parse and validate tldr in lens frontmatter
```

---

### Task 3: Carry `tldr` Through to Flattened Section Output

**Files:**
- Modify: `content_processor/src/index.ts:33-45` (Section interface)
- Modify: `content_processor/src/flattener/index.ts` (4 places where lens sections are built)
- Test: `content_processor/src/flattener/index.test.ts`

**Step 1: Add `tldr` to the Section interface**

In `content_processor/src/index.ts`, add `tldr` to the `Section` interface (after line 44):

```typescript
export interface Section {
  type: 'page' | 'lens-video' | 'lens-article' | 'test';
  meta: SectionMeta;
  segments: Segment[];
  optional?: boolean;
  feedback?: boolean;
  contentId: string | null;
  learningOutcomeId: string | null;
  learningOutcomeName: string | null;
  videoId: string | null;
  wordCount?: number;
  videoDurationSeconds?: number;
  tldr?: string;  // <-- add this
}
```

**Step 2: Write a failing flattener test**

Add to `content_processor/src/flattener/index.test.ts`. Use the existing test helpers (`buildFiles`, `simpleLO`, `pageLens`) from `test-helpers.ts`. Modules reference lenses through Learning Outcomes, not directly:

```typescript
it('carries tldr from lens frontmatter into flattened section', () => {
  const files = buildFiles({
    'modules/test-module.md': `---
slug: test-module
title: Test Module
contentId: 550e8400-e29b-41d4-a716-446655440000
---

# Learning Outcome: Topic
source:: [[../Learning Outcomes/lo1.md|LO1]]
`,
    'Learning Outcomes/lo1.md': simpleLO('550e8400-e29b-41d4-a716-446655440010', [
      { path: '../Lenses/my-lens.md' },
    ]),
    'Lenses/my-lens.md': `---
id: 550e8400-e29b-41d4-a716-446655440001
tldr: This is a short summary of the lens content
---

### Page: Intro

#### Text
content:: Hello world.
`,
  });

  const result = processContent(files);
  const mod = result.modules.find(m => m.slug === 'test-module');
  expect(mod).toBeDefined();
  const lensSection = mod!.sections.find(s => s.contentId === '550e8400-e29b-41d4-a716-446655440001');
  expect(lensSection?.tldr).toBe('This is a short summary of the lens content');
});
```

**Step 3: Run test to verify it fails**

Run: `cd content_processor && npx vitest run src/flattener/index.test.ts -t "carries tldr"`
Expected: FAIL — `tldr` is not set on flattened sections.

**Step 4: Add `tldr` to all section construction sites in the flattener**

There are 4 **Section** construction sites in `content_processor/src/flattener/index.ts` where `tldr: lens.tldr,` must be added right after the `contentId: lens.id ?? null,` line:

1. **Line ~552** (LO with submodules — `items.push({...} as Section)`)
2. **Line ~852** (LO without submodules — `const resultSection: Section = {...}`)
3. **Line ~1062** (uncategorized lenses — `const resultSection: Section = {...}`)
4. **Line ~1688** (standalone `flattenLens` — `const section: Section = {...}`)

**Important:** Do NOT modify line ~1696 which is a `FlattenedModule` object (`contentId: lens.id ?? null` for the module itself), not a `Section`.

**Step 5: Run tests to verify they pass**

Run: `cd content_processor && npx vitest run src/flattener/index.test.ts`
Expected: All tests pass.

**Step 6: Run all content processor tests**

Run: `cd content_processor && npx vitest run`
Expected: All tests pass.

**Step 7: Commit**

```
feat(content): carry tldr through flattened section output
```

---

### Task 4: Pass `tldr` Through the Backend API

**Files:**
- Modify: `web_api/routes/courses.py:229-238` (stage building)

The backend passes sections through as dicts, so `tldr` already flows through to the module endpoint automatically (it's just a key in the dict). But the course overview endpoint builds stage dicts manually and needs to include `tldr`.

**Step 1: Add `tldr` to the stage dict in the course progress endpoint**

In `web_api/routes/courses.py`, in the stage-building loop (around line 229-238), add `tldr`:

```python
stages.append(
    {
        "type": section_type,
        "title": title,
        "duration": section_dur or None,
        "optional": section.get("optional", False),
        "contentId": content_id_str,
        "completed": lens_completed,
        "tldr": section.get("tldr"),  # <-- add this
    }
)
```

**Step 2: Commit**

```
feat(api): include tldr in course progress stage info
```

---

### Task 5: Update Frontend Types

**Files:**
- Modify: `web_frontend/src/types/module.ts:136-145` (LensVideoSection)
- Modify: `web_frontend/src/types/module.ts:151-164` (LensArticleSection)
- Modify: `web_frontend/src/types/course.ts:5-20` (StageInfo)

**Step 1: Add `tldr` to LensVideoSection, LensArticleSection, and PageSection**

In `web_frontend/src/types/module.ts`, add `tldr?: string;` after `optional: boolean;` in all three types:

- `LensVideoSection` (line ~145)
- `LensArticleSection` (line ~164)
- `PageSection` (line ~130) — lenses with `### Page:` sections produce page-type sections that can also have TLDRs

**Step 3: Add `tldr` to StageInfo**

In `web_frontend/src/types/course.ts`, add to `StageInfo`:

```typescript
export type StageInfo = {
  type: /* existing types */;
  title: string;
  duration: number | null;
  optional: boolean;
  contentId?: string | null;
  completed?: boolean;
  tldr?: string;  // <-- add this
};
```

**Step 4: Run lint**

Run: `cd web_frontend && npm run lint`
Expected: No errors.

**Step 5: Commit**

```
feat(frontend): add tldr to lens section and stage types
```

---

### Task 6: Show TLDRs in Course Overview

**Files:**
- Modify: `web_frontend/src/components/course/ModuleOverview.tsx:120-135` (renderStageRow)

**Step 1: Add TLDR text below the stage title/duration block**

In `ModuleOverview.tsx`, in the `renderStageRow` function, after the existing subtitle `<div>` (the duration line, around line 136-190), add a TLDR line:

```tsx
{/* Content */}
<div className="relative z-[5] flex-1 min-w-0">
  <div className="flex items-center gap-2">
    <span className={`font-medium ${isCompleted || isViewing ? "text-slate-900" : "text-slate-400"}`}>
      {stage.title}
    </span>
    {stage.optional && (
      <span className="text-xs text-slate-400 border border-slate-200 rounded px-1">
        Optional
      </span>
    )}
  </div>
  {/* existing duration subtitle */}
  <div className="text-sm text-slate-500 mt-0.5">
    {/* ... existing duration rendering ... */}
  </div>
  {/* NEW: TLDR line */}
  {stage.tldr && (
    <p className="text-sm text-slate-400 mt-1 line-clamp-2">{stage.tldr}</p>
  )}
</div>
```

The key additions:
- Conditionally render `stage.tldr` as a `<p>` with `text-sm text-slate-400 mt-1 line-clamp-2`
- `line-clamp-2` prevents very long TLDRs from dominating the layout

**Step 2: Run lint and build**

Run: `cd web_frontend && npm run lint && npm run build`
Expected: No errors.

**Step 3: Commit**

```
feat(frontend): show tldr in course overview stage list
```

---

### Task 7: Build the Section Navigation Modal

**Files:**
- Create: `web_frontend/src/components/module/SectionChoiceModal.tsx`

**Step 1: Create the modal component**

This modal is shown when a user completes a section and optional content follows. It shows the upcoming sections with TLDRs to help the user decide what to read next.

```tsx
// web_frontend/src/components/module/SectionChoiceModal.tsx

import { StageIcon } from "./StageProgressBar";
import { formatDurationMinutes } from "../../utils/duration";

export interface SectionChoice {
  index: number;
  type: "lens-video" | "lens-article" | "page" | "test";
  title: string;
  tldr?: string;
  optional: boolean;
  duration?: number | null;
}

interface Props {
  isOpen: boolean;
  completedTitle?: string;
  choices: SectionChoice[];
  onChoose: (sectionIndex: number) => void;
  onDismiss: () => void;
}

export default function SectionChoiceModal({
  isOpen,
  completedTitle,
  choices,
  onChoose,
  onDismiss,
}: Props) {
  if (!isOpen || choices.length === 0) return null;

  // Find the first required section (skip target)
  const requiredChoice = choices.find((c) => !c.optional);
  const optionalChoices = choices.filter((c) => c.optional);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onDismiss();
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-lg p-8 max-w-lg w-full mx-4 shadow-xl">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          What&rsquo;s Next?
        </h2>
        {completedTitle && (
          <p className="text-gray-500 text-sm mb-5">
            You&rsquo;ve completed &ldquo;{completedTitle}&rdquo;
          </p>
        )}

        <div className="flex flex-col gap-3">
          {optionalChoices.map((choice) => (
            <button
              key={choice.index}
              onClick={() => onChoose(choice.index)}
              className="flex items-start gap-3 p-4 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50/50 transition-colors text-left"
            >
              <div className="flex-shrink-0 mt-0.5 text-gray-400">
                <StageIcon type={choice.type} small />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">
                    {choice.title}
                  </span>
                  <span className="text-xs text-gray-400 border border-gray-200 rounded px-1">
                    Optional
                  </span>
                </div>
                {choice.tldr && (
                  <p className="text-sm text-gray-500 mt-1">{choice.tldr}</p>
                )}
                {choice.duration && (
                  <span className="text-xs text-gray-400 mt-1 inline-block">
                    {formatDurationMinutes(choice.duration)}
                  </span>
                )}
              </div>
            </button>
          ))}

          {requiredChoice && (
            <button
              onClick={() => onChoose(requiredChoice.index)}
              className="w-full py-3 px-4 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors mt-1"
            >
              Continue: {requiredChoice.title}
            </button>
          )}

          {!requiredChoice && optionalChoices.length > 0 && (
            <button
              onClick={onDismiss}
              className="w-full text-gray-500 py-2 px-4 hover:text-gray-700 transition-colors text-sm"
            >
              Skip
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Run lint and build**

Run: `cd web_frontend && npm run lint && npm run build`
Expected: No errors.

**Step 3: Commit**

```
feat(frontend): add SectionChoiceModal component
```

---

### Task 8: Integrate SectionChoiceModal into Module View

**Files:**
- Modify: `web_frontend/src/views/Module.tsx`

**Step 1: Add state and import for the modal**

At the top of `Module.tsx`, add the import:

```typescript
import SectionChoiceModal from "@/components/module/SectionChoiceModal";
import type { SectionChoice } from "@/components/module/SectionChoiceModal";
```

Add state inside the `Module` component:

```typescript
const [sectionChoiceOpen, setSectionChoiceOpen] = useState(false);
const [sectionChoices, setSectionChoices] = useState<SectionChoice[]>([]);
const [completedSectionTitle, setCompletedSectionTitle] = useState<string>();
```

**Step 2: Add logic to detect optional-content-ahead after completion**

Find the completion handler in `Module.tsx` — this is where `markComplete` is called and progress state is updated. After a successful completion, check if the next section(s) are optional. If so, build the choices and show the modal instead of auto-advancing.

The detection logic:

```typescript
function buildSectionChoices(
  sections: ModuleSection[],
  completedIndex: number,
): SectionChoice[] {
  const choices: SectionChoice[] = [];
  for (let i = completedIndex + 1; i < sections.length; i++) {
    const section = sections[i];
    if (!("meta" in section) || !("optional" in section)) continue;
    const sectionType = section.type as SectionChoice["type"];
    if (!["lens-video", "lens-article", "page", "test"].includes(sectionType))
      continue;

    choices.push({
      index: i,
      type: sectionType,
      title: section.meta?.title ?? section.type,
      tldr: "tldr" in section ? (section.tldr as string | undefined) : undefined,
      optional: section.optional ?? false,
      duration: null,
    });

    // Stop after first required section (that's the "continue" target)
    if (!section.optional) break;
  }
  return choices;
}
```

In the completion handler, after marking complete succeeds:

```typescript
// Check if next sections include optional content
const choices = buildSectionChoices(module.sections, currentSectionIndex);
const hasOptionalAhead = choices.some((c) => c.optional);

if (hasOptionalAhead && choices.length > 1) {
  // Show choice modal instead of auto-advancing
  setCompletedSectionTitle(
    module.sections[currentSectionIndex]?.meta?.title ?? undefined,
  );
  setSectionChoices(choices);
  setSectionChoiceOpen(true);
} else {
  // Normal flow: advance to next section
  // ... existing auto-advance code ...
}
```

**Step 3: Add the modal to the render**

Near the existing `ModuleCompleteModal`, add:

```tsx
<SectionChoiceModal
  isOpen={sectionChoiceOpen}
  completedTitle={completedSectionTitle}
  choices={sectionChoices}
  onChoose={(index) => {
    setSectionChoiceOpen(false);
    setCurrentSectionIndex(index);
  }}
  onDismiss={() => {
    setSectionChoiceOpen(false);
    // Advance past all optional sections to next required, or just advance by 1
    const nextRequired = sectionChoices.find((c) => !c.optional);
    setCurrentSectionIndex(
      nextRequired ? nextRequired.index : currentSectionIndex + 1,
    );
  }}
/>
```

**Step 4: Run lint and build**

Run: `cd web_frontend && npm run lint && npm run build`
Expected: No errors.

**Step 5: Commit**

```
feat(frontend): integrate section choice modal into module view
```

---

### Task 9: Manual Testing & Verification

**Step 1: Add a `tldr` to a test lens**

If there's a test/fixture lens available in the content, add a `tldr` field to verify the full pipeline. Otherwise, verify via the content processor CLI.

**Step 2: Start dev servers and verify**

Run: `./scripts/list-servers` to check if servers are running, then restart the backend.

**Step 3: Verify course overview**

Navigate to the course overview page and check that TLDRs appear below stage titles.

**Step 4: Verify section choice modal**

Navigate to a module with optional sections. Complete the section before the optional one and verify the modal appears with TLDRs.

**Step 5: Verify validation**

Create a lens with a >80 word `tldr` and run the content processor to confirm the error is emitted.

---

### Summary of All Files Changed

**Content Processor (TypeScript):**
- `content_processor/src/content-schema.ts` — add `tldr` to lens optional fields
- `content_processor/src/parser/lens.ts` — parse `tldr` from frontmatter, validate <=80 words
- `content_processor/src/parser/lens.test.ts` — tests for tldr parsing/validation
- `content_processor/src/index.ts` — add `tldr` to `Section` interface
- `content_processor/src/flattener/index.ts` — carry `tldr` through in 4 section construction sites
- `content_processor/src/flattener/index.test.ts` — test tldr passthrough

**Backend (Python):**
- `web_api/routes/courses.py` — include `tldr` in course progress stage dict

**Frontend (React/TypeScript):**
- `web_frontend/src/types/module.ts` — add `tldr` to PageSection, LensVideoSection, LensArticleSection
- `web_frontend/src/types/course.ts` — add `tldr` to StageInfo
- `web_frontend/src/components/course/ModuleOverview.tsx` — render TLDR in stage list
- `web_frontend/src/components/module/SectionChoiceModal.tsx` — new modal component
- `web_frontend/src/views/Module.tsx` — integrate SectionChoiceModal
