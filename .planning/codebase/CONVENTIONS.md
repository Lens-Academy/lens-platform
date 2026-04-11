# Coding Conventions

**Analysis Date:** 2026-02-14

## Naming Patterns

**Files:**
- Python: `snake_case.py` for modules (e.g., `scheduling.py`, `discord_outbound/bot.py`)
- Python tests: `test_*.py` (e.g., `test_scheduler.py`, `test_dispatcher.py`)
- TypeScript/TSX: `PascalCase.tsx` for components (e.g., `ModuleHeader.tsx`, `CourseOverview.tsx`)
- TypeScript/TSX: `camelCase.ts` for utilities (e.g., `branchLayout.ts`, `sectionSlug.ts`)
- TypeScript tests: `*.test.ts` or `*.test.tsx` co-located with source (e.g., `branchLayout.test.ts`)
- Discord cogs: `*_cog.py` (e.g., `enrollment_cog.py`, `scheduler_cog.py`)
- API routes: `*.py` in `web_api/routes/` (e.g., `auth.py`, `courses.py`)

**Functions:**
- Python: `snake_case` (e.g., `get_user_profile()`, `schedule_cohort()`)
- Python async: `async def snake_case()` (e.g., `async def send_notification()`)
- TypeScript: `camelCase` (e.g., `buildBranchLayout()`, `formatLocalTime()`)
- React components: `PascalCase` (e.g., `ModuleHeader`, `CourseOverview`)

**Variables:**
- Python: `snake_case` (e.g., `user_id`, `cohort_name`, `meeting_time`)
- TypeScript/React: `camelCase` (e.g., `moduleTitle`, `completedStages`, `currentSectionIndex`)
- Constants: `UPPER_SNAKE_CASE` in Python (e.g., `DAY_MAP`, `DISCORD_CLIENT_ID`)

**Types:**
- Python: `PascalCase` for classes and dataclasses (e.g., `Person`, `UngroupableDetail`, `CohortSchedulingResult`)
- TypeScript: `PascalCase` for interfaces and types (e.g., `ModuleHeaderProps`, `StageInfo`, `Stage`)
- Enums: `PascalCase` class with `snake_case` members in Python (e.g., `CohortRole.participant`)

## Code Style

**Formatting:**
- Python: Ruff formatter (black-compatible)
  - Line length: 88 characters
  - Double quotes for strings
  - Spaces for indentation
  - Config: `pyproject.toml` at `/home/penguin/code/lens-platform/ws3/pyproject.toml`
- TypeScript/React: ESLint v9 (flat config)
  - Config: `/home/penguin/code/lens-platform/ws3/web_frontend/eslint.config.mjs`
  - No explicit Prettier config (using defaults)

**Linting:**
- Python: Ruff
  - Target: Python 3.11
  - Per-file ignores: E402 (imports after code) allowed in `main.py`, `alembic/env.py`, `scripts/*.py`, test files
  - Run: `ruff check .` and `ruff format --check .`
- TypeScript: ESLint with TypeScript, React, React Hooks plugins
  - Key rules:
    - `react-hooks/rules-of-hooks`: error
    - `react-hooks/exhaustive-deps`: warn
    - `@typescript-eslint/no-unused-vars`: error (allow `_` prefix for unused args)
  - Run: `npm run lint` (from `web_frontend/`)

## Import Organization

**Python:**
1. Standard library imports
2. Third-party imports (alphabetical)
3. Blank line
4. Local imports from `core/`
5. Relative imports

Example from `web_api/routes/auth.py`:
```python
import os
import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core import get_or_create_user, get_user_profile
from core.database import get_connection
from web_api.auth import create_jwt
```

**TypeScript:**
1. External packages (React, libraries)
2. Internal absolute imports (via `@/` alias)
3. Relative imports

Example from `web_frontend/src/components/ModuleHeader.tsx`:
```typescript
import { useMedia } from "react-use";
import { useScrollDirection } from "../hooks/useScrollDirection";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { UserMenu } from "./nav/UserMenu";
import StageProgressBar from "./module/StageProgressBar";
import type { Stage } from "../types/module";
```

**Path Aliases:**
- TypeScript: `@/` maps to `src/` (configured in `tsconfig.json` and `vitest.config.ts`)

## Error Handling

**Python Patterns:**
- Use `try`/`except` with specific exception types
- Return `None` or error dicts for graceful degradation
- FastAPI: Raise `HTTPException` with status codes
```python
from fastapi import HTTPException

async def get_item(id: int):
    item = await fetch_item(id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item
```

- Discord: Catch `discord.Forbidden`, `discord.NotFound`, `discord.HTTPException`
```python
try:
    await member.edit(nick=new_nickname)
except discord.Forbidden:
    await interaction.followup.send("I don't have permission...")
except discord.HTTPException as e:
    await interaction.followup.send(f"Failed: {e}")
```

**TypeScript Patterns:**
- Check response status before parsing JSON
```typescript
const res = await fetch('/api/...');
if (!res.ok) throw new Error('Failed to fetch');
return res.json();
```

## Logging

**Framework:** Python uses standard library `logging` (imported but not heavily used); TypeScript uses `console` methods

**Patterns:**
- Minimal logging in production code
- Error tracking via Sentry (`core/config.py` initializes Sentry, `web_frontend/src/errorTracking.ts`)
- No structured logging framework currently in use

## Comments

**When to Comment:**
- Module/file docstrings explaining purpose (especially in Python)
- Function docstrings for public APIs
- Inline comments for non-obvious logic (DST warnings, scheduling algorithm quirks)
- Type annotations serve as documentation (TypeScript)

**Python Docstrings:**
```python
"""
Test Cog - For testing nickname changes.
"""

def calculate_total_available_time(person: Person) -> int:
    """Calculate total minutes of availability for a person."""
```

**TypeScript JSDoc:**
```typescript
/**
 * Contract tests for CourseOverview component.
 *
 * These tests verify the frontend can render the shared fixture.
 * The same fixture is used by backend tests to verify API output.
 */
```

## Function Design

**Size:** No strict limit, but prefer focused functions. Scheduling algorithm has longer functions (~100 lines) due to complexity.

**Parameters:**
- Python: Use type hints (e.g., `user_id: int`, `conn: AsyncConnection`)
- TypeScript: Use interface for complex props (e.g., `ModuleHeaderProps`)
- Use dataclasses for structured data (Python) or interfaces (TypeScript)

**Return Values:**
- Python: Explicit return types in type hints (e.g., `-> dict`, `-> CohortSchedulingResult`)
- TypeScript: Inferred or explicit return types
- Async functions: `async def` in Python, `async function` in TypeScript

## Module Design

**Exports:**
- Python: Public functions exported via `core/__init__.py`
```python
# core/__init__.py
from .scheduling import schedule_cohort
from .users import get_user_profile
```

- TypeScript: Named exports preferred over default
```typescript
export function buildBranchLayout(stages: StageInfo[]) { ... }
export { UserMenu } from "./nav/UserMenu";
```

**Barrel Files:**
- Used in `core/__init__.py` to expose core functionality to adapters
- Minimal use in TypeScript (direct imports preferred)

## Layer Separation

**Critical:** Discord bot (`discord_bot/`) and Web API (`web_api/`) must never import from each other. Both delegate to `core/`.

**Imports:**
- `discord_bot/` → imports from `core/`
- `web_api/` → imports from `core/`
- `core/` → never imports from `discord_bot/` or `web_api/`
- `web_frontend/` → makes HTTP calls to `web_api/`, no direct imports

**Path manipulation for core imports:**
```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from core import get_user_profile
```

## TypeScript Specific

**Strict Mode:** Enabled in `tsconfig.json`
```json
{
  "strict": true,
  "noEmit": true,
  "isolatedModules": true
}
```

**Type Imports:**
```typescript
import type { Stage } from "../types/module";
```

**React Patterns:**
- Functional components with TypeScript interfaces for props
- Hooks: `useState`, `useEffect`, `useMemo`, custom hooks (e.g., `useScrollDirection`)
- Conditional rendering with ternary or `&&`

## Python Specific

**Async/Await:**
- Database operations: `async with get_connection()` or `async with get_transaction()`
- Discord operations: `await interaction.response.defer()`
- External APIs: `await httpx.AsyncClient().get(...)`

**Dataclasses:**
```python
from dataclasses import dataclass, field

@dataclass
class Person:
    id: str
    name: str
    intervals: list
    if_needed_intervals: list = field(default_factory=list)
    timezone: str = "UTC"
```

**Type Hints:**
- Use `str | None` (Python 3.10+ union syntax) instead of `Optional[str]`
- Use `list`, `dict` for simple generics

## UI/UX Patterns

**Never use `cursor-not-allowed`** - use `cursor-default` instead for non-interactive elements.

**Tailwind CSS v4:**
- Utility-first CSS classes
- Mobile-first responsive design (`md:`, `lg:` breakpoints)
- Safe area support: `paddingTop: "var(--safe-top)"`

---

*Convention analysis: 2026-02-14*
