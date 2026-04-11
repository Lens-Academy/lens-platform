# Implementation Plan: Fix Optional Articles Display Bug

## Overview

**Problem:** The module viewer does not show optional articles as optional. Articles marked with `optional:: true` in the markdown source are not visually distinguished in the UI.

**Root Cause:** Two bugs in the data flow:
1. Backend serialization drops the `optional` field
2. Frontend hardcodes `optional: false`

**Files to modify:**
- `core/modules/content.py` (backend serialization)
- `web_frontend/src/types/module.ts` (TypeScript types)
- `web_frontend/src/views/Module.tsx` (frontend display logic)
- `core/modules/tests/test_content.py` (backend tests)

---

## Task 1: Add `optional` field to backend serialization

**File:** `core/modules/content.py`

**Context:** The `bundle_section` function (lines 651-701) serializes section dataclasses into JSON for the API response. The `ArticleSection` and `VideoSection` dataclasses already have `optional: bool = False` (defined in `markdown_parser.py` lines 64, 74), but `bundle_section` doesn't include this field in the output.

### Change 1a: Add `optional` to ArticleSection serialization

**Location:** Line 669, inside the `elif isinstance(section, ArticleSection):` block

**Current code:**
```python
segments = [bundle_segment(s, section) for s in section.segments]
return {"type": "article", "meta": meta, "segments": segments}
```

**Replace with:**
```python
segments = [bundle_segment(s, section) for s in section.segments]
return {"type": "article", "meta": meta, "segments": segments, "optional": section.optional}
```

### Change 1b: Add `optional` to VideoSection serialization

**Location:** Lines 684-690, inside the `elif isinstance(section, VideoSection):` block

**Current code:**
```python
segments = [bundle_segment(s, section) for s in section.segments]
return {
    "type": "video",
    "videoId": video_id,
    "meta": meta,
    "segments": segments,
}
```

**Replace with:**
```python
segments = [bundle_segment(s, section) for s in section.segments]
return {
    "type": "video",
    "videoId": video_id,
    "meta": meta,
    "segments": segments,
    "optional": section.optional,
}
```

### Verification
Run existing tests to ensure no regressions:
```bash
pytest core/modules/tests/test_content.py -v
```

---

## Task 2: Add TypeScript types for `optional` field

**File:** `web_frontend/src/types/module.ts`

**Context:** The `ArticleSection` and `VideoSection` types (lines 62-73) need an `optional` field to match the updated API response. The `Stage` types already have `optional?: boolean` (lines 124, 133, 142), but the `Section` types don't.

### Change 2a: Add `optional` to ArticleSection type

**Location:** Lines 62-66

**Current code:**
```typescript
export type ArticleSection = {
  type: "article";
  meta: ArticleMeta;
  segments: ModuleSegment[];
};
```

**Replace with:**
```typescript
export type ArticleSection = {
  type: "article";
  meta: ArticleMeta;
  segments: ModuleSegment[];
  optional?: boolean;
};
```

### Change 2b: Add `optional` to VideoSection type

**Location:** Lines 68-73

**Current code:**
```typescript
export type VideoSection = {
  type: "video";
  videoId: string;
  meta: VideoMeta;
  segments: ModuleSegment[];
};
```

**Replace with:**
```typescript
export type VideoSection = {
  type: "video";
  videoId: string;
  meta: VideoMeta;
  segments: ModuleSegment[];
  optional?: boolean;
};
```

### Verification
Run TypeScript type check:
```bash
cd web_frontend && npm run build
```

---

## Task 3: Update frontend to read `optional` from section data

**File:** `web_frontend/src/views/Module.tsx`

**Context:** The `stagesForDrawer` useMemo (lines 217-229) converts module sections to `StageInfo` format for the drawer. Currently it hardcodes `optional: false` on line 227.

### Change 3: Read `optional` from section instead of hardcoding

**Location:** Lines 217-229

**Current code:**
```typescript
// Convert to StageInfo format for drawer
const stagesForDrawer: StageInfo[] = useMemo(() => {
  if (!module) return [];
  return module.sections.map((section, index) => ({
    type: section.type === "text" ? "article" : section.type,
    title:
      section.type === "text"
        ? `Section ${index + 1}`
        : section.meta?.title || `${section.type || "Section"} ${index + 1}`,
    duration: null,
    optional: false,
  }));
}, [module]);
```

**Replace with:**
```typescript
// Convert to StageInfo format for drawer
const stagesForDrawer: StageInfo[] = useMemo(() => {
  if (!module) return [];
  return module.sections.map((section, index) => ({
    type: section.type === "text" ? "article" : section.type,
    title:
      section.type === "text"
        ? `Section ${index + 1}`
        : section.meta?.title || `${section.type || "Section"} ${index + 1}`,
    duration: null,
    optional: "optional" in section && section.optional === true,
  }));
}, [module]);
```

**Note:** The `"optional" in section` check handles the union type discrimination - `TextSection` and `ChatSection` don't have the `optional` field, only `ArticleSection` and `VideoSection` do.

### Verification
Run lint and build:
```bash
cd web_frontend && npm run lint && npm run build
```

---

## Task 4: Add backend test for `optional` field serialization

**File:** `core/modules/tests/test_content.py`

**Context:** The existing tests don't cover the `bundle_narrative_module` function. Add a test to verify the `optional` field is correctly serialized.

### Change 4: Add test for optional field in bundle_narrative_module

**Location:** At end of file (after line 58)

**Add this test:**
```python
def test_bundle_narrative_module_includes_optional_field():
    """Should include optional field when bundling article and video sections."""
    from unittest.mock import patch

    from core.modules.content import bundle_narrative_module
    from core.modules.markdown_parser import (
        ArticleSection,
        VideoSection,
        TextSegment,
        ParsedModule,
    )

    class MockMetadata:
        title = "Mock Title"
        author = "Mock Author"
        source_url = "https://example.com"
        channel = "Mock Channel"
        video_id = "abc123"

    class MockResult:
        metadata = MockMetadata()
        content = "Mock content"

    # Create a module with optional and non-optional sections
    module = ParsedModule(
        slug="test-module",
        title="Test Module",
        sections=[
            ArticleSection(
                source="test-article.md",
                segments=[TextSegment(content="Test content")],
                optional=True,
            ),
            VideoSection(
                source="test-video.md",
                segments=[TextSegment(content="Test content")],
                optional=False,
            ),
        ],
    )

    with patch("core.modules.content.load_article_with_metadata", return_value=MockResult()), \
         patch("core.modules.content.load_video_transcript_with_metadata", return_value=MockResult()):
        result = bundle_narrative_module(module)

    # Verify optional field is present and correct
    assert result["sections"][0]["optional"] is True
    assert result["sections"][1]["optional"] is False
```

### Verification
Run the new test:
```bash
pytest core/modules/tests/test_content.py::test_bundle_narrative_module_includes_optional_field -v
```

---

## Final Verification

After all changes, run the full verification:

```bash
# Backend
ruff check .
ruff format --check .
pytest core/modules/tests/test_content.py -v

# Frontend
cd web_frontend
npm run lint
npm run build
```

## Summary

| Task | File | Change |
|------|------|--------|
| 1a | `core/modules/content.py:669` | Add `"optional": section.optional` to ArticleSection return |
| 1b | `core/modules/content.py:685-690` | Add `"optional": section.optional` to VideoSection return |
| 2a | `web_frontend/src/types/module.ts:62-66` | Add `optional?: boolean` to ArticleSection type |
| 2b | `web_frontend/src/types/module.ts:68-73` | Add `optional?: boolean` to VideoSection type |
| 3 | `web_frontend/src/views/Module.tsx:227` | Change `optional: false` to `optional: "optional" in section && section.optional === true` |
| 4 | `core/modules/tests/test_content.py` | Add test for optional field serialization |
