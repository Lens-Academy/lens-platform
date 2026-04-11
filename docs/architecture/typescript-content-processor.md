# TypeScript Content Processor Architecture

## Overview

A unified TypeScript package that handles all content processing: parsing, flattening, bundling, and validation. Replaces the current Python parser  and validator while keeping Python for API/caching concerns.

## Why TypeScript?

1. **Obsidian plugin** - Need to validate content inside of Obsidian for quick course developer feedback. That requires Typescript. The easiest is then to have a single source of truth script, thus only have Typescript, no python.
2. **CI validation** - Run in GitHub Actions
3. **Validation by processing** - The most reliable way to validate is to try to fully process it. If parsing, flattening, or bundling fails at any stage, the content is invalid. This eliminates bugs where validator and parser drift apart.

## Separation of Concerns

```
┌─────────────────────────────────────────────────────────┐
│                      PYTHON                             │
│                                                         │
│  • GitHub API (fetch files)                             │
│  • Compare commits → fetch only changed files           │
│  • Store raw markdown in cache                          │
│  • Store processed JSON in cache                        │
│  • Serve API requests from cache                        │
└─────────────────────────────────────────────────────────┘
                          │
                          │ subprocess (async, non-blocking)
                          │ pass all cached markdown
                          ▼
┌─────────────────────────────────────────────────────────┐
│                    TYPESCRIPT                           │
│                                                         │
│  • Pure function: markdown files → JSON                 │
│  • Parse → Flatten → Bundle                             │
│  • No state, no caching, no API calls                   │
│  • Same code runs in Node, Obsidian, and CI             │
└─────────────────────────────────────────────────────────┘
```

TypeScript knows nothing about GitHub, webhooks, or caching. It receives markdown, returns JSON.

## Processing Pipeline

```
Markdown files
      ↓
   PARSE         Extract structure, frontmatter, fields, wiki-links
      ↓
  FLATTEN        Resolve references (Learning Outcomes → Lenses → sections)
      ↓
   BUNDLE        Load article excerpts, video transcripts, compute collapsed content
      ↓
JSON output (FlattenedModules, courses, errors)
```

Each phase can fail. Failure = validation error with location and context.

## Validation Philosophy

**Validation = attempting full processing.**

- Schema validator says "fields exist" ✓ but bundling reveals "those text anchors don't exist in the article" ✗
- Separate validators drift from parsers over time
- If it processes successfully, it's valid. If any phase fails, it's invalid.

### Two Modes: Parse vs Validate

A single script with two modes:

- **Parse mode** - Used by backend. Extracts content, tolerates minor issues.
- **Validate mode** - Used by CI/Obsidian. Runs full parsing *plus* additional strict checks.

The validator is a superset of parsing. This ensures the validator never drifts from the parser—if parsing fails, validation fails. But validation can catch additional issues (e.g., style guidelines, deprecated patterns) that don't block content from being served.

## Cache Structure (Python)

```python
cache = {
    "raw": {
        "files": {
            "modules/intro.md": "---\nslug: intro\n...",
            "Learning Outcomes/foo.md": "...",
            "Lenses/bar.md": "...",
            "articles/baz.md": "...",
            "video_transcripts/qux.md": "...",
        },
        "last_commit_sha": "abc123",
    },
    "processed": {
        "modules": {"intro": {FlattenedModule JSON}},
        "courses": {"course-1": {Course JSON}},
        "last_commit_sha": "abc123",
    },
}
```

Raw markdown enables incremental fetching. Processed JSON is served to clients.

## Incremental Updates

```
Webhook arrives
      ↓
Python: compare commits → list of changed files
      ↓
Python: fetch only changed .md files from GitHub
      ↓
Python: update raw markdown in cache
      ↓
Python: pass ALL raw files to TypeScript subprocess
      ↓
TypeScript: full processing → JSON
      ↓
Python: replace processed cache
```

We do full processing because it avoids complexity of tracking "which modules reference which articles."

## Subprocess Performance

- ~50-100ms Node startup overhead (CPU-bound)
- Acceptable because processing only happens at:
  - Server startup (blocking is fine, not serving yet)
  - Webhook (async subprocess, doesn't block requests)
- Not on the hot path (client requests just read from cache)

## Where It Runs

| Context | How | Purpose |
|---------|-----|---------|
| Backend | Python subprocess | Startup + webhook processing |
| CI | `node process.js validate` | PR checks, fail on errors |
| Obsidian | Import as library | Real-time validation while editing |

Same TypeScript code, three contexts.
