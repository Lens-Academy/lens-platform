# GitHub Content Fetcher Design

**Date:** 2026-01-18
**Status:** Approved

## Overview

Replace local file-based lesson loading with GitHub-based loading. Educational content (courses, lessons, articles, video transcripts) will be fetched from an external GitHub repository and cached in memory.

## Goals

- Load educational content from `lucbrinkman/lens-educational-content` GitHub repo
- Use `staging` branch for dev/staging environments, `main` branch for production
- Cache content in memory for fast responses
- Refresh cache via GitHub webhook on push
- Zero backwards compatibility with local file loading

## Architecture

```
┌─────────────────┐     webhook      ┌──────────────────┐
│  GitHub Repo    │ ───────────────► │  FastAPI Server  │
│  (main/staging) │                  │                  │
└────────┬────────┘                  │  ┌────────────┐  │
         │                           │  │ In-Memory  │  │
         │ fetch on startup          │  │   Cache    │  │
         │ + webhook trigger         │  └────────────┘  │
         │                           │        │         │
         ▼                           │        ▼         │
┌─────────────────┐                  │  ┌────────────┐  │
│ raw.github...   │ ◄────────────────┼──│  Loader    │  │
│ (content CDN)   │                  │  └────────────┘  │
└─────────────────┘                  └──────────────────┘
```

## Content Repository Structure

```
lucbrinkman/lens-educational-content/
├── courses/           # Course definitions (markdown)
├── lessons/           # Lesson definitions (markdown)
├── articles/          # Article content (markdown with frontmatter)
└── video_transcripts/ # Video transcripts (markdown with frontmatter)
```

## Cache Design

```python
@dataclass
class ContentCache:
    courses: dict[str, ParsedCourse]      # slug -> parsed course
    lessons: dict[str, ParsedLesson]      # slug -> parsed lesson
    articles: dict[str, str]              # path -> raw markdown
    video_transcripts: dict[str, str]     # path -> raw markdown
    last_refreshed: datetime              # for debugging
```

- **Eager loading:** All content fetched on startup and webhook trigger
- **In-memory:** Cache lives in server memory, lost on restart (re-fetched)
- **Fail hard:** If GitHub unavailable and cache empty, server fails to start

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | Yes | Fine-grained PAT for GitHub API (read-only, scoped to content repo) |
| `EDUCATIONAL_CONTENT_BRANCH` | Yes | Branch to fetch from (`staging` or `main`) |
| `GITHUB_WEBHOOK_SECRET` | No | For webhook signature verification (set up later) |

## New Files

### `core/content/__init__.py`
Module init, exports cache functions.

### `core/content/cache.py`
```python
@dataclass
class ContentCache:
    courses: dict[str, ParsedCourse]
    lessons: dict[str, ParsedLesson]
    articles: dict[str, str]
    video_transcripts: dict[str, str]
    last_refreshed: datetime

_cache: ContentCache | None = None

async def initialize_cache() -> None:
    """Fetch all content from GitHub, populate cache. Called on startup."""

async def refresh_cache() -> None:
    """Re-fetch all content. Called by webhook."""

def get_cache() -> ContentCache:
    """Get cache, raise if not initialized."""
```

### `core/content/github_fetcher.py`
```python
CONTENT_REPO = "lucbrinkman/lens-educational-content"

def get_content_branch() -> str:
    """Get branch from env, raise if not set."""

async def fetch_all_content() -> ContentCache:
    """Fetch all content types from GitHub."""

async def fetch_file(path: str) -> str:
    """Fetch single file from raw.githubusercontent.com."""

async def list_directory(path: str) -> list[str]:
    """List files in directory via GitHub API."""
```

### `web_api/routes/content.py`
```python
@router.post("/webhook")
async def github_webhook(request: Request):
    """Handle GitHub push webhook to refresh content cache."""
```

## Files to Modify

### `core/lessons/content.py`
Replace file reads with cache lookups:
```python
# Before
article_path = CONTENT_DIR / source_url
raw_text = article_path.read_text()

# After
from core.content.cache import get_cache
raw_text = get_cache().articles[source_url]
```

### `core/lessons/loader.py`
- Remove YAML file loading
- Use markdown parser + cache instead

### `core/lessons/markdown_parser.py`
Fix gaps identified by tests:
- Add `optional` field support for sections
- Strip outer quotes from `from`/`to` values
- Handle missing `title` field (don't extract from header)

### `main.py`
Add cache initialization on startup:
```python
from core.content.cache import initialize_cache

# In startup
await initialize_cache()
```

## Files to Rename

- `educational_content/` → `educational_content_deprecated/`

## Webhook Setup (Later)

1. GitHub repo → Settings → Webhooks → Add webhook
2. Payload URL: `https://<server>/api/content/webhook`
3. Content type: `application/json`
4. Secret: Store as `GITHUB_WEBHOOK_SECRET`
5. Events: Push only

For local development: Just restart server to refresh cache.

## Test Fixtures

Test fixtures created at:
- `core/lessons/tests/fixtures/introduction_sample.md` - Sample lesson in new markdown format
- `core/lessons/tests/fixtures/introduction_sample_expected.json` - Expected parsed output

Coverage includes:
- All 4 combinations of `showUserPreviousContent`/`showTutorPreviousContent`
- Article excerpts with `from`/`to` values
- `optional` field on sections
- Escaped headers (`!##` → `##`)
- Video excerpt variations (from only, to only, both, neither)
- Multiline content with blank lines preserved

## Migration Steps

1. Update markdown parser to match expected output
2. Create `core/content/` module with cache and fetcher
3. Modify `core/lessons/content.py` to use cache
4. Modify `core/lessons/loader.py` to use cache
5. Add cache initialization to `main.py`
6. Add webhook endpoint
7. Rename `educational_content/` to `educational_content_deprecated/`
8. Test end-to-end
9. Set up GitHub webhooks for staging/production
