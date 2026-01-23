# Coding Conventions

**Analysis Date:** 2026-01-21

## Naming Patterns

**Python Files:**
- snake_case for modules: `users.py`, `course_loader.py`, `markdown_parser.py`
- Test files: `test_*.py` prefix: `test_sessions.py`, `test_courses.py`
- Configuration files: lowercase with underscores: `conftest.py`

**TypeScript/React Files:**
- PascalCase for components: `VideoEmbed.tsx`, `CookieBanner.tsx`
- camelCase for utilities/hooks: `useAuth.ts`, `formatDuration.ts`
- Lowercase for config: `config.ts`, `analytics.ts`
- Index files for barrel exports: `index.ts`

**Python Functions/Variables:**
- snake_case: `get_user_profile()`, `save_user_profile()`, `discord_id`
- Private functions: underscore prefix: `_get_database_url()`, `_send_welcome_notification()`
- Async functions: same naming, no prefix

**TypeScript Functions/Variables:**
- camelCase: `fetchUser()`, `isAuthenticated`, `sessionId`
- Hooks: `use` prefix: `useAuth()`, `useScrollSpy()`
- Event handlers: `on` prefix: `onPlay`, `onTimeUpdate`

**Types/Interfaces (TypeScript):**
- PascalCase: `User`, `AuthState`, `VideoEmbedProps`
- Type aliases: PascalCase: `ModuleSegment`, `ChatMessage`
- Props types: `ComponentNameProps` suffix: `VideoEmbedProps`

**Constants:**
- Python: SCREAMING_SNAKE_CASE: `DEFAULT_PROVIDER`, `FIXTURES_DIR`
- TypeScript: SCREAMING_SNAKE_CASE: `API_URL`, `DEFAULT_TIMEOUT_MS`

## Code Style

**Python Formatting:**
- Tool: `ruff format`
- Line length: 88 characters (configured in `pyproject.toml`)
- Double quotes for strings
- Spaces for indentation (4 spaces)

**Python Linting:**
- Tool: `ruff check`
- Per-file ignores for E402 (imports not at top):
  - `main.py`, `alembic/env.py`, `scripts/*.py`, `*/tests/*.py`

**TypeScript/JavaScript Formatting:**
- Tool: ESLint with TypeScript and React plugins
- Config: `web_frontend/eslint.config.mjs`
- Key rules:
  - `@typescript-eslint/no-unused-vars`: error (with `^_` pattern ignored)
  - `react-hooks/rules-of-hooks`: error
  - `react-hooks/exhaustive-deps`: warn

## Import Organization

**Python Order:**
1. Standard library imports (`os`, `asyncio`, `datetime`)
2. Third-party imports (`discord`, `fastapi`, `sqlalchemy`)
3. Local application imports (`from core import ...`, `from .database import ...`)

Example from `core/users.py`:
```python
import asyncio
from datetime import datetime, timezone
from typing import Any

from .database import get_connection, get_transaction
from .queries import users as user_queries
from .tables import users as users_table
from sqlalchemy import select, update as sql_update
```

**TypeScript Order:**
1. React imports (`import { useState, useEffect } from "react"`)
2. Third-party imports
3. Absolute imports with aliases (`@/components/...`)
4. Relative imports (`../config`, `./VideoPlayer`)

Example from `web_frontend/src/components/module/VideoEmbed.tsx`:
```typescript
import { useState, useRef, useEffect } from "react";
import VideoPlayer from "@/components/module/VideoPlayer";
import { formatDuration } from "@/utils/formatDuration";
```

**Path Aliases (TypeScript):**
- `@/` maps to `src/`: `@/components/module/VideoPlayer`

## Error Handling

**Python Patterns:**
- Custom exception classes for domain errors:
  - `SessionNotFoundError`, `SessionAlreadyClaimedError`, `ModuleNotFoundError`
- HTTPException for API errors with appropriate status codes:
  ```python
  raise HTTPException(status_code=404, detail="Session not found")
  raise HTTPException(status_code=403, detail="Session already claimed")
  ```
- Try/except for external service calls with graceful degradation:
  ```python
  try:
      await some_external_call()
  except Exception as e:
      print(f"[Module] Failed: {e}")
      return False
  ```

**TypeScript Patterns:**
- Custom error classes for specific failures:
  ```typescript
  export class RequestTimeoutError extends Error {
    public readonly url: string;
    public readonly timeoutMs: number;
    constructor(url: string, timeoutMs: number) { ... }
  }
  ```
- Throw errors in API functions, catch in components:
  ```typescript
  if (!res.ok) throw new Error("Failed to fetch modules");
  ```
- Console.error for caught exceptions:
  ```typescript
  } catch (error) {
    console.error("Failed to fetch user:", error);
  }
  ```

## Logging

**Python Framework:** Print statements with module prefixes
- Pattern: `print(f"[ModuleName] Message: {details}")`
- Example: `print(f"[Notifications] Failed to send: {e}")`
- No structured logging library currently in use

**TypeScript Framework:** Console methods
- `console.error()` for errors
- `console.log()` for debugging (should be removed in production)

## Comments

**When to Comment:**
- Module-level docstrings explaining purpose
- Function docstrings with Args/Returns for public APIs
- Inline comments for non-obvious logic
- TODO/FIXME for known issues (sparingly)

**Python Docstrings:**
```python
"""
User profile management.

All functions are async and use the database.
"""

async def get_user_profile(discord_id: str) -> dict[str, Any] | None:
    """
    Get a user's full profile.

    Args:
        discord_id: Discord user ID

    Returns:
        User profile dict or None if not found
    """
```

**TypeScript JSDoc:**
```typescript
/**
 * Hook to manage authentication state.
 *
 * Checks if the user is authenticated by calling /auth/me.
 * The session is stored in an HttpOnly cookie, so we can't read it directly.
 */
export function useAuth(): UseAuthReturn { ... }
```

## Function Design

**Size:** Functions tend to be focused and moderate-sized (20-80 lines typical)

**Parameters (Python):**
- Use keyword arguments for optional parameters
- Type hints for all parameters and return values
- Default values for optional parameters:
  ```python
  async def save_user_profile(
      discord_id: str,
      nickname: str | None = None,
      timezone_str: str | None = None,
  ) -> dict[str, Any]:
  ```

**Parameters (TypeScript):**
- Props objects for React components
- Destructuring in function signatures:
  ```typescript
  export default function VideoEmbed({
    videoId,
    start,
    end,
    excerptNumber = 1,
    title,
    channel,
  }: VideoEmbedProps) { ... }
  ```

**Return Values:**
- Python: Use `| None` for optional returns, dicts for complex data
- TypeScript: Discriminated unions for different result types:
  ```typescript
  export type ModuleCompletionResult =
    | { type: "next_module"; slug: string; title: string }
    | { type: "unit_complete"; unitNumber: number }
    | null;
  ```

## Module Design

**Python Exports:**
- Public functions exposed in module `__init__.py`
- Example in `core/__init__.py` exports public API

**TypeScript Exports:**
- Named exports preferred over default exports for utilities
- Default exports for React components
- Barrel files (`index.ts`) for grouped re-exports:
  ```typescript
  // components/module/index.ts
  export { default as VideoEmbed } from './VideoEmbed';
  export { default as ArticleEmbed } from './ArticleEmbed';
  ```

## UI/UX Patterns

**Never use `cursor-not-allowed`** - Use `cursor-default` instead for non-interactive elements. The not-allowed cursor is visually aggressive.

**Tailwind CSS v4** - Uses CSS-first configuration. Classes like:
- Layout: `flex`, `items-center`, `justify-center`
- Spacing: `px-4`, `py-2`, `mx-auto`
- Colors: `bg-stone-100`, `text-stone-800`
- Responsive: `max-w-[1100px]`

## Async Patterns

**Python:**
- All database operations are async
- Use `async with` for connection management:
  ```python
  async with get_connection() as conn:
      result = await conn.execute(query)
  ```
- Fire-and-forget with `asyncio.create_task()`:
  ```python
  asyncio.create_task(_send_welcome_notification(user_id))
  ```

**TypeScript:**
- Async generators for streaming responses:
  ```typescript
  export async function* sendMessage(...): AsyncGenerator<...> {
    // ...
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield data;
    }
  }
  ```
- useCallback for memoized async functions in hooks

## Database Patterns

**Connection Management:**
- `get_connection()` for read operations
- `get_transaction()` for write operations (auto-commit/rollback)
- Always use context managers (`async with`)

**Query Patterns:**
- Raw SQL with parameterized queries via SQLAlchemy text()
- SQLAlchemy Core (not ORM) for table definitions
- Result mapping: `result.mappings().first()` or `dict(row)`

---

*Convention analysis: 2026-01-21*
