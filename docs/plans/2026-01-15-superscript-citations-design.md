# Superscript Citations Design

## Overview

Enable superscript rendering for inline Wikipedia citations in the ArticlePanel component.

**Approach**: Two changes required:

1. **Frontend**: Add `rehype-raw` plugin to ReactMarkdown to allow HTML tags in markdown content
2. **Content**: Transform inline citation links from `[[5]](URL)` to `<sup>[[5]](URL)</sup>`

**Scope**:
- One Wikipedia article: `wikipedia-existential-risk-from-ai.md`
- 98 inline citations (95 numbered, 3 lettered)
- References section at bottom: unchanged

**Files touched**:
- `web_frontend/package.json` - add dependency
- `web_frontend/src/components/unified-lesson/ArticlePanel.tsx` - add plugin
- `educational_content/articles/wikipedia-existential-risk-from-ai.md` - transform citations

## Frontend Changes

**Install dependency**:
```bash
cd web_frontend && npm install rehype-raw
```

**Update ArticlePanel.tsx**:

```tsx
// Add import
import rehypeRaw from 'rehype-raw';

// Update ReactMarkdown (around line 119)
<ReactMarkdown
  remarkPlugins={[remarkGfm]}
  rehypePlugins={[rehypeRaw]}  // Add this line
  components={{
    // ... existing components unchanged
  }}
>
```

**Why rehype-raw?**
- `remark` plugins process markdown AST
- `rehype` plugins process HTML AST
- `rehype-raw` allows raw HTML embedded in markdown to pass through to final output

**Security note**: This enables all HTML in markdown content. Acceptable here because educational content is controlled/curated, not user-generated.

## Content Transformation

**Pattern to match**: Inline citations like `[[5]](URL)` or `[[a]](URL)`

**Transform to**: `<sup>[[5]](URL)</sup>`

**Command**:
```bash
sed -i 's/\(\[\[[0-9a-zA-Z]*\]\]([^)]*)\)/<sup>\1<\/sup>/g' \
  educational_content/articles/wikipedia-existential-risk-from-ai.md
```

**What this matches**:
- `\[\[` - literal `[[`
- `[0-9a-zA-Z]*` - citation number or letter (e.g., `5`, `45`, `a`)
- `\]\]` - literal `]]`
- `([^)]*)` - the URL in parentheses

**What it won't match** (correctly excluded):
- References section entries like `1. ^ [source]` - different format
- Regular markdown links `[text](url)` - single brackets

## Verification

After implementation, verify:

1. **Frontend compiles**: `cd web_frontend && npm run build`
2. **Citations transformed**: Grep confirms `<sup>[[` pattern exists
3. **References unchanged**: Spot-check that bottom section still has `1. ^` format
4. **Visual check**: Run dev server, navigate to article, confirm citations render as superscript
