---
name: merge-extractions
description: Merge two article extractions when each has unique content
---

# Merge Article Extractions

You are merging two extractions of the same article because each has content the other lacks.

## Input

Two markdown files containing different extractions of the same article:
- **Extraction A** (trafilatura)
- **Extraction B** (readability)

## Merging Rules

### 1. Include ALL Substantive Content
- If a paragraph appears in only one extraction, include it
- If a section appears in only one extraction, include it
- If an image appears in only one extraction, include it

### 2. Handle Duplicates
- When content appears in both, keep the better-formatted version
- Prefer the version with:
  - Proper markdown formatting
  - Complete sentences (not truncated)
  - Working links/images

### 3. Maintain Structure
- Preserve the article's logical flow
- Keep sections in the correct order
- Don't create duplicate headings

### 4. Exclude Noise
- Even when merging, exclude:
  - Comments sections
  - Navigation elements
  - Ads and sidebars
  - "Related articles" blocks

## Process

1. Read both extractions completely
2. Identify the article's structure (intro, sections, conclusion)
3. For each section, determine which extraction has it or merge content
4. Assemble the merged article maintaining logical flow
5. Write the merged result

## Output

Write the merged article to the output file. The result should read as a single coherent article, not a patchwork.

## Example Usage

```
User: Merge extractions at /tmp/traf.md and /tmp/read.md using merge-extractions skill, save to articles/merged.md
Agent: [Reads both files, merges intelligently, writes result]
```
