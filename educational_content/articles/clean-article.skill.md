# Skill: Clean Scraped Article

Clean a markdown file that was scraped from the web, removing boilerplate and keeping only the article content.

## Instructions

Given a markdown file path, perform these steps:

1. **Read the file** and identify the main article content

2. **Remove these elements:**
   - Site navigation, menus, header links
   - Sidebar content (related posts, categories, tags lists)
   - Comments section and comment forms
   - Footer content (copyright, site links, social media)
   - Newsletter signup forms
   - Share buttons / social links
   - "Read more" / "Related articles" sections
   - Cookie notices, popups
   - Empty links like `[](/path)` or `[ ](/path)`
   - Excessive blank lines (more than 2 consecutive)

3. **Preserve these elements:**
   - Article title (as H1)
   - Author name and date (add as metadata block if present)
   - All article body content
   - Inline links within the article
   - Images with captions
   - Blockquotes
   - Code blocks
   - Footnotes/endnotes

4. **Format the output as:**
   ```markdown
   # [Article Title]

   **Author:** [Name] | **Date:** [Date] | **Source:** [URL]

   ---

   [Article content...]
   ```

5. **Write the cleaned file** back to the same path (overwrite)

6. **Report** what was removed (brief summary)

## Example deletions

Before:
```markdown
[Skip to content](#content)

[ Cold Takes ](https://www.cold-takes.com)

  * [About](https://www.cold-takes.com/about/)
  * [Most Important Century](https://www.cold-takes.com/most-important-century/)

# The Article Title

Article content here...

### 47 comments

**John** says: Great article!
```

After:
```markdown
# The Article Title

**Author:** Holden Karnofsky | **Source:** https://www.cold-takes.com/...

---

Article content here...
```
