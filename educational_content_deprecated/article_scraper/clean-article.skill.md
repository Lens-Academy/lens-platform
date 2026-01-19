# Skill: Clean Scraped Article

Clean a markdown file that was scraped from the web. This includes:
1. Removing trailing boilerplate (references, comments, footer)
2. Removing leading boilerplate (duplicate title, metadata lines)
3. Fixing markdown formatting issues
4. Removing inline boilerplate

The file already has YAML frontmatter added by the scraper. **Do not modify the frontmatter.** Keep it exactly as-is.

## Step 1: Remove Trailing Boilerplate with truncate_after.py

Articles often end with references, comments, footers, newsletter signups, etc. Use the `truncate_after.py` script to remove everything after the last line of actual content.

**Process:**
1. Read the article and identify the last sentence/phrase of actual content (before boilerplate starts)
2. Pick the last 5-10 words from that ending that are unique to the article
3. Test with `--dry-run` first:
   ```bash
   python educational_content/article_scraper/truncate_after.py <file_path> "<ending_phrase>" --dry-run
   ```
4. Review the preview - if it looks correct, run without `--dry-run`:
   ```bash
   python educational_content/article_scraper/truncate_after.py <file_path> "<ending_phrase>"
   ```

**If the phrase appears multiple times:** The script will error with line numbers. Pick a longer or more specific phrase.

**If there's no trailing boilerplate:** Skip this step.

## Step 2: Remove Leading Boilerplate

Remove non-article content at the start of the file (after the YAML frontmatter). Jina Reader adds metadata lines that must be removed:

- **`Title: ...`** - Remove. Title is already in frontmatter.
- **`URL Source: ...`** - Remove. URL is already in frontmatter.
- **`Published Time: ...`** - Remove. Date is already in frontmatter.
- **`Markdown Content:`** - Remove. Just a label from the scraper.
- **Duplicate title with `===` underline** - Remove setext-style title headers.
- **Site name/tagline** - e.g., `The sideways view\n===============` or `Looking askance at reality\n---------`
- **Navigation elements** - `[Skip to content]`, `[Home]`, `[About]`, menu links.
- **Table of contents** - Long lists of anchor links to sections within the article.
- **Metadata badges** - Vote counts like `167\n===`, read time like `8 min read`, dates.

The article content should start with the first actual paragraph or section heading.

## Step 3: Fix Markdown Formatting

Fix these common issues from Jina extraction:

### Setext Headers → ATX Headers (or remove)
Jina often produces setext-style headers. Convert meaningful ones to ATX style, remove junk ones:
```
JUNK (remove entirely):
167
===

Ω 76
====

CONVERT:
The Road to Superintelligence
=============================
→ ## The Road to Superintelligence
```

### Bold Inside Headers
```
WRONG: ####**Header text**
RIGHT: #### Header text

WRONG: ### **Header text**
RIGHT: ### Header text
```

### List Items on Same Line
Jina sometimes puts multiple list items on one line:
```
WRONG: *[Link1](url)*   [Link2](url)*   [Link3](url)
RIGHT:
* [Link1](url)
* [Link2](url)
* [Link3](url)
```

### Bold Standalone Lines → Headers
Lines that are ONLY bold text and serve as section titles should become headers:
```
WRONG: **The Road to Superintelligence**
RIGHT: ## The Road to Superintelligence
```
**Exception:** Keep numbered items as bold: `**1) First point**`

### Missing Line Breaks
Content sometimes runs together without proper spacing:
```
WRONG: _______________
**Header Text**

RIGHT:
_______________

## Header Text
```

### Footnote Markers
Remove or clean inline footnote links that clutter the text:
- `[1](url)`, `[2](url)` inline citation links
- `text.2` or `word11` superscript-style markers
- `[![Image N: ↩](url)](url)` return arrows

## Step 4: Remove Inline Boilerplate

Remove inline junk throughout the article:
- Social media share buttons/images (Twitter, Facebook, Reddit icons)
- PDF/print version promos
- Editorial notes about the post
- Empty links like `[](url)` or `[](/path)`
- "Subscribe" / "Sign up" calls to action
- Related posts sections

Preserve:
- YAML frontmatter (unchanged)
- All body content, inline links
- Content images with alt text
- Blockquotes, code blocks

## Step 5: Write and Report

1. Write cleaned file back to the same path
2. Report what was fixed/removed (brief summary)
