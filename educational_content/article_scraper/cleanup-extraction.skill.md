---
name: cleanup-extraction
description: Clean up formatting issues in an extracted article
---

# Clean Up Article Extraction

You are cleaning up an article that was extracted from a webpage. The content is correct but has formatting issues.

## Input

A markdown file containing an extracted article that needs cleanup.

## What to Fix

### 1. Formatting Issues
- **Asterisk spacing**: `* text*` → `*text*`, `** text**` → `**text**`
- **Broken bold/italic**: `**text` without closing → fix or remove
- **Excessive blank lines**: 3+ consecutive blank lines → 2 blank lines
- **Trailing whitespace**: Remove from all lines

### 2. Header Conversion
- **ALL CAPS lines** that are clearly section titles → Convert to `## Header`
- **Standalone bold lines** that are clearly section titles → Convert to `## Header`
- Only convert if it's genuinely a section heading, not emphasis within text

### 3. Boilerplate Removal
- "Subscribe to our newsletter" prompts
- "Share on Twitter/Facebook" buttons
- "Related articles" sections at the end
- Excessive author bios (keep brief attribution)
- Navigation breadcrumbs
- Cookie consent text

### 4. Image Cleanup
- Ensure images have descriptive alt text if context makes it clear what they show
- Remove tracking pixels (1x1 images, data URIs)
- Remove social media share button images

## What NOT to Do

- **Never rewrite content** - Only fix formatting, don't paraphrase
- **Never remove substantive paragraphs** - Even if they seem tangential
- **Never add content** - Don't add information that wasn't there
- **Never change meaning** - Preserve the author's exact words
- **Never remove footnotes/citations** - These are important

## Output

Write the cleaned article directly to the output file. Do not include any commentary or explanation - just the cleaned markdown.

## Example Usage

```
User: Clean up the article at /tmp/extracted.md using cleanup-extraction skill, save to articles/output.md
Agent: [Reads file, fixes issues, writes cleaned version]
```
