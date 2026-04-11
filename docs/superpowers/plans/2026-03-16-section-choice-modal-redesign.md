# Section Choice Modal Redesign + TLDR Truncation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the SectionChoiceModal with brand gold colors and optional-first ordering, and add TLDR truncation to the ModuleOverview sidebar.

**Architecture:** Two independent changes to existing components. Change 1 rewrites SectionChoiceModal styling/layout in-place. Change 2 adds a collapsible TLDR wrapper inside ModuleOverview's `renderStageRow`.

**Tech Stack:** React, Tailwind CSS v4, lucide-react icons

**Spec:** `docs/superpowers/specs/2026-03-16-section-choice-modal-redesign.md`

---

## Chunk 1: SectionChoiceModal Redesign

### Task 1: Restyle SectionChoiceModal with gold colors and optional-first ordering

**Files:**
- Modify: `web_frontend/src/components/module/SectionChoiceModal.tsx`

This is a pure styling/layout rewrite of an existing component. No new files, no API changes, no prop changes. The component already receives `choices` with `optional` field and splits them into `requiredChoice`/`optionalChoices` — we just reorder and restyle.

- [ ] **Step 1: Rewrite SectionChoiceModal**

Replace the full component body. Key changes from current code:
- Remove the "What's Next?" `<h2>` heading
- Render optional sections FIRST (currently they render second)
- Count-sensitive label: "Want to explore this optional lens?" (1) vs "Want to explore an optional lens?" (2+)
- Optional cards: gold warm styling — `bg-[#fdf8f0]` background, `border-[#f9eedb]` border, hover to `border-[#dea96c]`, dashed circle icon wrapper (24px), title in `text-[#7a470c]`, metadata in `text-[#b87018]`
- Gold-styled optional badge: `bg-[#f9eedb] text-[#9a5c10]` instead of default `OptionalBadge`
- TLDR always shown expanded in modal (existing `choice.tldr` field)
- "Or continue with the core material:" label before required section
- Required card: stronger gold — `border-[#dea96c]` (hover `border-[#d08838]`), 28px solid circle with `border-[#d08838]` and `bg-[#f9eedb]` fill, title `font-semibold text-[#7a470c]`, right chevron arrow in `text-[#d08838]`
- Skip button restyled to gold tones when no required section
- All choices remain `<button>` elements

```tsx
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

  const requiredChoice = choices.find((c) => !c.optional);
  const optionalChoices = choices.filter((c) => c.optional);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onDismiss();
  };

  const optionalLabel =
    optionalChoices.length === 1
      ? "Want to explore this optional lens?"
      : "Want to explore an optional lens?";

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-lg p-6 max-w-lg w-full mx-4 shadow-xl animate-[modalIn_250ms_ease-out]">
        {completedTitle && (
          <div className="flex items-center gap-2 mb-4">
            <svg
              className="w-5 h-5 text-green-500 flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p className="text-gray-500 text-sm">
              Completed &ldquo;{completedTitle}&rdquo;
            </p>
          </div>
        )}

        {/* Optional sections first */}
        {optionalChoices.length > 0 && (
          <div>
            <p className="text-sm font-medium text-[#7a470c] mb-3">
              {optionalLabel}
            </p>
            <div className="flex flex-col gap-2">
              {optionalChoices.map((choice) => (
                <button
                  key={choice.index}
                  onClick={() => onChoose(choice.index)}
                  className="w-full flex items-start gap-3 p-3 rounded-[10px] border-[1.5px] border-[#f9eedb] bg-[#fdf8f0] hover:border-[#dea96c] hover:bg-[#f9eedb] transition-colors text-left"
                >
                  <div className="w-6 h-6 rounded-full border-2 border-dashed border-[#dea96c] bg-white flex items-center justify-center flex-shrink-0 mt-0.5">
                    <StageIcon type={choice.type} small />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-[#7a470c]">
                        {choice.title}
                      </span>
                      <span className="text-[10px] font-medium bg-[#f9eedb] text-[#9a5c10] px-1.5 py-0.5 rounded">
                        Optional
                      </span>
                    </div>
                    <div className="text-xs text-[#b87018] mt-0.5">
                      {choice.type === "lens-video"
                        ? "Video"
                        : choice.type === "lens-article"
                          ? "Article"
                          : choice.type === "test"
                            ? "Test"
                            : "Page"}
                      {choice.duration != null &&
                        choice.duration > 0 &&
                        ` · ${formatDurationMinutes(choice.duration)}`}
                    </div>
                    {choice.tldr && (
                      <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                        {choice.tldr}
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Required section */}
        {requiredChoice && (
          <div className={optionalChoices.length > 0 ? "mt-4" : ""}>
            {optionalChoices.length > 0 && (
              <p className="text-sm font-medium text-[#7a470c] mb-3">
                Or continue with the core material:
              </p>
            )}
            <button
              onClick={() => onChoose(requiredChoice.index)}
              className="w-full flex items-center gap-3 p-3.5 rounded-[10px] border-[1.5px] border-[#dea96c] bg-[#fdf8f0] hover:border-[#d08838] hover:bg-[#f9eedb] transition-colors text-left"
            >
              <div className="w-7 h-7 rounded-full border-2 border-[#d08838] bg-[#f9eedb] flex items-center justify-center flex-shrink-0">
                <StageIcon type={requiredChoice.type} small />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-semibold text-[#7a470c]">
                  {requiredChoice.title}
                </div>
                <div className="text-xs text-[#9a5c10] mt-0.5">
                  {requiredChoice.type === "lens-video"
                    ? "Video"
                    : requiredChoice.type === "lens-article"
                      ? "Article"
                      : requiredChoice.type === "test"
                        ? "Test"
                        : "Page"}
                  {requiredChoice.duration != null &&
                    requiredChoice.duration > 0 &&
                    ` · ${formatDurationMinutes(requiredChoice.duration)}`}
                </div>
                {requiredChoice.tldr && (
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                    {requiredChoice.tldr}
                  </p>
                )}
              </div>
              <svg
                className="w-[18px] h-[18px] text-[#d08838] flex-shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>
          </div>
        )}

        {/* Skip — only when no required section */}
        {!requiredChoice && optionalChoices.length > 0 && (
          <button
            onClick={onDismiss}
            className="w-full text-[#9a5c10] py-2 px-4 hover:text-[#7a470c] transition-colors text-sm mt-3"
          >
            Skip
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Remove unused OptionalBadge import**

The old code imported `OptionalBadge` from `../OptionalBadge`. The new code uses an inline styled badge instead. Verify the import is removed (it's not in the code above).

- [ ] **Step 3: Lint and build**

Run: `cd web_frontend && npm run lint && npm run build`
Expected: No new errors. Build succeeds.

- [ ] **Step 4: Commit**

```bash
jj describe -m "feat: restyle SectionChoiceModal with brand gold colors and optional-first ordering"
jj new
```

---

## Chunk 2: TLDR Truncation in ModuleOverview

### Task 2: Add collapsible TLDR text in ModuleOverview sidebar

**Files:**
- Modify: `web_frontend/src/components/course/ModuleOverview.tsx`

The current TLDR rendering is a single line at `ModuleOverview.tsx:205-206`:
```tsx
{stage.tldr && (
  <p className="text-sm text-slate-500 mt-1 max-w-xl">{stage.tldr}</p>
)}
```

We need to wrap this in a truncation container with expand/collapse toggle.

- [ ] **Step 1: Add expanded state tracking**

At the top of the `ModuleOverview` component (inside the function body, before any return), add:

```tsx
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
// (merge with existing react import)

// Inside component:
const [expandedTldrs, setExpandedTldrs] = useState<Set<number>>(new Set());

const toggleTldr = useCallback((index: number) => {
  setExpandedTldrs((prev) => {
    const next = new Set(prev);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    return next;
  });
}, []);
```

- [ ] **Step 2: Create TruncatedTldr inline sub-component**

Add this **outside** `ModuleOverview` (before the component function). It must be a top-level component — defining it inside `ModuleOverview` would cause re-mounting on every render since hooks are used. It handles measuring whether text is actually truncated and showing the chevron only when needed:

```tsx
function TruncatedTldr({
  text,
  isExpanded,
  onToggle,
}: {
  text: string;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const textRef = useRef<HTMLParagraphElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    // Check if content overflows 2-line clamp
    setIsTruncated(el.scrollHeight > el.clientHeight + 1);
  }, [text]);

  return (
    <div className="mt-1 max-w-xl">
      <p
        ref={textRef}
        className={`text-sm text-slate-500 ${!isExpanded ? "line-clamp-2" : ""}`}
      >
        {text}
      </p>
      {isTruncated && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="text-xs text-slate-400 hover:text-slate-600 transition-colors mt-0.5 flex items-center gap-0.5"
        >
          <svg
            className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
          {isExpanded ? "Less" : "More"}
        </button>
      )}
    </div>
  );
}
```

**Important detail about `isTruncated` measurement:** The `useEffect` runs after first render when `line-clamp-2` is applied. At that point `scrollHeight > clientHeight` correctly detects overflow. Once expanded (`line-clamp-2` removed), the check would no longer detect overflow — but we don't re-run the effect because `text` hasn't changed, so `isTruncated` retains its value. This is the correct behavior.

- [ ] **Step 3: Replace TLDR rendering in renderStageRow**

Replace the current TLDR block (around line 205-206):

```tsx
// BEFORE:
{stage.tldr && (
  <p className="text-sm text-slate-500 mt-1 max-w-xl">{stage.tldr}</p>
)}

// AFTER:
{stage.tldr && (
  <TruncatedTldr
    text={stage.tldr}
    isExpanded={expandedTldrs.has(index)}
    onToggle={() => toggleTldr(index)}
  />
)}
```

The `index` variable is already available in `renderStageRow(stage, index)`.

- [ ] **Step 4: Lint and build**

Run: `cd web_frontend && npm run lint && npm run build`
Expected: No new errors. Build succeeds.

- [ ] **Step 5: Commit**

```bash
jj describe -m "feat: truncate TLDRs in ModuleOverview sidebar with expand/collapse toggle"
jj new
```

---

## Verification

After both tasks, manually verify in browser:

1. Navigate to a module with optional sections
2. Complete a section that triggers the choice modal
3. Confirm: optional lenses appear first with warm gold cards, TLDRs shown
4. Confirm: singular/plural label is correct
5. Confirm: core section below with stronger gold card + chevron arrow
6. Confirm: clicking any option navigates and dismisses modal
7. Open module drawer sidebar
8. Confirm: TLDRs are truncated to 2 lines with "More" button
9. Click "More" — confirms TLDR expands with "Less" button
10. Short TLDRs (fitting in 2 lines) should have no toggle button
