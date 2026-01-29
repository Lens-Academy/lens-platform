---
name: select-extraction
description: Choose the better extraction between trafilatura and readability outputs
---

# Select Best Extraction

You are comparing two extractions of the same web article to determine which is better.

## Input

You will be given paths to two extraction files:
- **Extraction A** (trafilatura): Usually has better recall but may include comments/sidebars
- **Extraction B** (readability): Usually cleaner but may miss content

## Evaluation Criteria

A good extraction:
1. **Contains the complete article text** - Not truncated, no missing sections
2. **Excludes noise** - No comments, navigation, sidebars, ads, "related articles"
3. **Preserves formatting** - Headers, lists, blockquotes, bold/italic intact
4. **Includes images** - Markdown image syntax preserved with alt text

## Process

1. Read both extraction files completely
2. Compare them against these criteria
3. Make a decision:
   - **A** - Trafilatura is clearly better (more complete, less noise)
   - **B** - Readability is clearly better (more complete, less noise)
   - **MERGE** - Each has substantive content the other lacks

## Output

State your decision clearly:

```
DECISION: [A/B/MERGE]
REASON: [One sentence explaining why]
```

If MERGE, explain what content each extraction has that the other lacks.

## Example Usage

```
User: Compare extractions at /tmp/traf.md and /tmp/read.md using select-extraction skill
Agent: [Reads both files, compares, outputs decision]
```
