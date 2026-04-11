# Collapsible Article Sections

When displaying article excerpts, show omitted sections as collapsed blocks that users can expand.

## Problem

Currently, when we show partial articles (excerpts), the omitted content is invisible. Users can't see what was skipped or read it if curious.

## Solution

Extend `article-excerpt` segments to include collapsed content before/after:

```json
{
  "type": "article-excerpt",
  "content": "The main excerpt content shown by default",
  "collapsed_before": "Content from article that precedes this excerpt",
  "collapsed_after": "Content from article that follows this excerpt"
}
```

### Placement Rules

- Gaps between excerpts go on `collapsed_before` of the following excerpt
- Only the last excerpt gets `collapsed_after` (for trailing article content)
- Both fields are `string | null`
- Adjacent excerpts (no gap) → `null`, not empty string
- Whitespace-only gaps → `null`

### Example

Given an article with sections A through L, and we want to show B-C, then G-H, then K-L:

```json
{
  "type": "article",
  "meta": { "title": "Alphabet", "author": "Someone" },
  "segments": [
    {
      "type": "article-excerpt",
      "content": "B\nC",
      "collapsed_before": "A",
      "collapsed_after": null
    },
    { "type": "text", "content": "Commentary here" },
    {
      "type": "article-excerpt",
      "content": "G\nH",
      "collapsed_before": "D\nE\nF",
      "collapsed_after": null
    },
    { "type": "chat", "instructions": "Discuss..." },
    {
      "type": "article-excerpt",
      "content": "K\nL",
      "collapsed_before": "I\nJ",
      "collapsed_after": null
    }
  ]
}
```

Note: In this example there's no content after L, so `collapsed_after` is null on the last excerpt. If there were sections M-Z, the last excerpt would have `"collapsed_after": "M\nN\n...Z"`.

### Frontend Rendering

For each `article-excerpt`:
1. If `collapsed_before` exists → render `<details>` (collapsed by default)
2. Render `content` (current behavior)
3. If `collapsed_after` exists → render `<details>` (collapsed by default)

The collapsed sections use the same article styling (amber background, markdown rendering) but are wrapped in a collapsible element.

## Algorithm

Process all `article-excerpt` segments in a section together, tracking positions in the full document.

### Steps

1. **Load full article once** for the section

2. **Find positions for each excerpt:**
   - For each `article-excerpt` segment, find `(start_idx, end_idx)` in full content
   - Use anchor-finding logic: `from_text` → start, `to_text` → end

3. **Sort excerpts by position** (defensive - should already be in order)

4. **Compute collapsed content:**
   ```
   For excerpt[0]:
     collapsed_before = full_content[0 : excerpt[0].start].strip() or null

   For excerpt[i] where i > 0:
     collapsed_before = full_content[excerpt[i-1].end : excerpt[i].start].strip() or null

   For last excerpt only:
     collapsed_after = full_content[last.end : end_of_doc].strip() or null
   ```

5. **Build bundled segments**, attaching `collapsed_before`/`collapsed_after` to each excerpt

### Position Tracking vs Display Content

**Important clarification:** The `start` and `end` positions mark where anchors were found in the raw document, including any surrounding whitespace. The `.strip()` calls only affect the *display content* (what gets shown to the user), not the position tracking for gap calculation.

This means:
- If excerpt 1 ends at position 100 (including trailing newlines)
- And excerpt 2 starts at position 105
- The gap `full_content[100:105]` is calculated from raw positions
- If that gap is only whitespace, `.strip()` makes it empty → `null`

This is correct behavior: we track positions in raw document space, but clean up content for display.

### Type Definitions

This implementation uses `ArticleExcerptSegment` from `core/modules/markdown_parser.py`, where `from_text` and `to_text` are `str | None`. (Note: `core/modules/types.py` has a different definition where they are non-optional `str` - that's for a different module format.)

### New Helper Function

Create `find_excerpt_bounds()` to find anchor positions without extracting content:

```python
def find_excerpt_bounds(
    content: str,
    from_text: str | None,
    to_text: str | None,
) -> tuple[int, int]:
    """
    Find the start and end positions of an excerpt in the content.

    Args:
        content: Full article content
        from_text: Starting anchor (None = start of document)
        to_text: Ending anchor (None = end of document)

    Returns:
        (start_idx, end_idx) positions in content

    Raises:
        AnchorNotFoundError: If anchor text not found
        AnchorNotUniqueError: If anchor appears multiple times
    """
```

This reuses the existing anchor-finding logic from `extract_article_section()` but returns positions instead of content.

### Refactored Bundling

Create or refactor `bundle_article_section()` to process all segments together:

```python
def bundle_article_section(section: ArticleSection) -> dict:
    # 1. Load full article once
    full_result = load_article_with_metadata(section.source)
    full_content = full_result.content

    # 2. Find positions for all article-excerpt segments
    excerpt_data = []
    for seg in section.segments:
        if isinstance(seg, ArticleExcerptSegment):
            start, end = find_excerpt_bounds(full_content, seg.from_text, seg.to_text)
            excerpt_data.append({
                'segment': seg,
                'start': start,
                'end': end,
                'content': full_content[start:end].strip(),
            })

    # 3. Sort by position (defensive)
    excerpt_data.sort(key=lambda x: x['start'])

    # 4. Compute collapsed content
    for i, ep in enumerate(excerpt_data):
        prev_end = 0 if i == 0 else excerpt_data[i - 1]['end']
        collapsed = full_content[prev_end:ep['start']].strip()
        ep['collapsed_before'] = collapsed if collapsed else None

        if i == len(excerpt_data) - 1:
            trailing = full_content[ep['end']:].strip()
            ep['collapsed_after'] = trailing if trailing else None
        else:
            ep['collapsed_after'] = None

    # 5. Build bundled segments (preserving original order with non-excerpt segments)
    excerpt_map = {id(ep['segment']): ep for ep in excerpt_data}
    bundled_segments = []

    for seg in section.segments:
        if isinstance(seg, ArticleExcerptSegment):
            ep = excerpt_map[id(seg)]
            bundled_segments.append({
                'type': 'article-excerpt',
                'content': ep['content'],
                'collapsed_before': ep['collapsed_before'],
                'collapsed_after': ep['collapsed_after'],
            })
        else:
            # Handle other segment types (text, chat, etc.)
            bundled_segments.append(bundle_segment(seg, section))

    return {
        'type': 'article',
        'meta': {
            'title': full_result.metadata.title,
            'author': full_result.metadata.author,
            'sourceUrl': full_result.metadata.source_url,
        },
        'segments': bundled_segments,
        'optional': section.optional,
    }
```

## Edge Cases

| Case | Behavior |
|------|----------|
| Adjacent excerpts (no gap) | `collapsed_before: null` |
| Whitespace-only gap | `collapsed_before: null` |
| Full article (no from/to on single excerpt) | Both fields `null` |
| Excerpt at document start (`from_text` matches first line) | `collapsed_before: null` |
| Excerpt at document end (`to_text` matches last line) | `collapsed_after: null` |
| Overlapping excerpts (excerpt 1 ends after excerpt 2 starts) | Raise error - invalid module definition |
| Anchor not found | Raise `AnchorNotFoundError` (existing behavior) |
| Anchor not unique | Raise `AnchorNotUniqueError` (existing behavior) |

## Testing Strategy

### Unit Tests for `find_excerpt_bounds()`

- Both anchors provided → returns correct positions
- `from_text` is None → start position is 0
- `to_text` is None → end position is len(content)
- Both anchors None → returns (0, len(content))
- Anchor not found → raises `AnchorNotFoundError`
- Anchor appears multiple times → raises `AnchorNotUniqueError`
- Case-insensitive matching (matches existing behavior)

### Unit Tests for `bundle_article_section()`

- Single excerpt with content before and after → correct collapsed fields
- Multiple excerpts with gaps → gaps assigned to `collapsed_before` of following excerpt
- Adjacent excerpts (no gap) → `collapsed_before: null`
- Whitespace-only gap → `collapsed_before: null`
- Interleaved with text/chat segments → correct ordering preserved
- Last excerpt gets `collapsed_after` if trailing content exists

### Integration Tests

- Full module bundling with real article content
- API response includes new fields

## Changes Required

### Backend (`core/modules/content.py`)

1. Add `find_excerpt_bounds()` helper function
2. Create `bundle_article_section()` function with the algorithm above
3. Update `bundle_narrative_module()` to use `bundle_article_section()` for article sections

### Frontend Types (`web_frontend/src/types/module.ts`)

```typescript
type ArticleExcerptSegment = {
  type: "article-excerpt";
  content: string;
  collapsed_before: string | null;
  collapsed_after: string | null;
};
```

### Frontend Component (`web_frontend/src/components/module/ArticleEmbed.tsx`)

Add rendering for collapsed sections using `<details>`/`<summary>` elements with appropriate styling.

## Backwards Compatibility

The new `collapsed_before` and `collapsed_after` fields are optional (`string | null`). Existing frontend code will receive these as `undefined` until updated, which is falsy in JS and won't break rendering.

## Out of Scope

- Collapsed sections in the TOC (they won't have headings tracked)
- Reading time calculation changes (still based on shown content only)
- Any changes to the module definition format (just the bundled output changes)
- Collapsible content for video excerpts (video transcripts)
