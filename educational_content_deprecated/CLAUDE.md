# Educational Content

This folder contains all educational materials: articles, video transcripts, lessons, and courses.

## Structure

```
educational_content/
├── articles/           # Markdown articles (local copies)
├── article_scraper/    # Tools for extracting articles from web
├── video_transcripts/  # Video transcripts with timestamps
├── lessons/            # Lesson definitions (YAML)
└── courses/            # Course manifests (YAML)
```

## Adding Content

**All content must be stored locally.** Lessons should never contain external URLs.

### Adding Articles

**Step 1: Extract with images**
```bash
python educational_content/article_scraper/extract_article.py "URL" educational_content/articles/{author}-{short-title}.md
```

This script uses trafilatura for text + custom HTML parsing for images.

**Step 2: Clean with subagent**

Spawn a subagent to clean formatting issues:
```
Task: "Clean the article at educational_content/articles/{filename}.md using the article_scraper/clean-article.skill.md skill"
```

The subagent fixes `*text *` → `*text*`, converts bold lines to headers, removes boilerplate.

**Step 3: Reference in lesson**
```yaml
- type: article
  source: articles/author-short-title.md
  from: "Starting text..."
  to: "Ending text..."
```

**Naming:** `{author-lastname}-{short-title}.md` (e.g., `urban-ai-revolution-superintelligence.md`)

### Adding Video Transcripts

Transcripts go in `video_transcripts/` with naming:
```
{video_id}_{Title_With_Underscores}.md
```

### Missing Content

If content isn't in storage yet, ask the user:

> "The [article/video] '[title]' by [author] isn't in our storage yet. How would you like me to add it?
> 1. Fetch and parse the article/transcript now
> 2. Skip this for now and use different content
> 3. Other instructions"

## Skills

- `article_scraper/clean-article.skill.md` - Clean scraped article formatting
