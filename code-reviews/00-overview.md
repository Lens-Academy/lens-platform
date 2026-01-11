# Consolidated Code Review Summary

**Date:** 2026-01-09
**Reviewed by:** Claude Code with 5 parallel superpowers:code-reviewer agents

## Overview

5 parallel code reviews examined the entire codebase:
- **core/** - Business logic layer (16 issues)
- **discord_bot/** - Discord adapter (24 issues)
- **web_api/** - FastAPI layer (22 issues)
- **web_frontend/** - React frontend (20 issues)
- **Architecture** - Top-level files and cross-cutting concerns (10 issues)

---

## Critical Issues (Fix Immediately)

| # | Location | Issue |
|---|----------|-------|
| 1 | `web_api/routes/auth.py:79-81` | **Memory leak**: In-memory OAuth state storage grows unbounded. Users who start OAuth but never complete it leave entries forever. |
| 2 | `web_api/routes/auth.py:242-266` | **NullPointerException**: POST `/auth/code` has `response: Response = None` default - calling `set_session_cookie()` will crash. |
| 3 | `discord_bot/test_bot_manager.py:37-39` | **Closure capture bug**: Event handler uses fragile default argument pattern for variable capture. |

---

## Important Issues (Fix Soon)

### Security
| # | Location | Issue |
|---|----------|-------|
| 4 | `web_api/auth.py:76` | Session cookie `secure=False` hardcoded - should be True in production |
| 5 | `web_api/routes/speech.py:12-35` | No authentication on `/transcribe` endpoint - API cost exposure |
| 6 | `web_api/routes/lesson.py:47-67` | No authentication on `/api/chat/lesson` - API cost exposure |
| 7 | `web_api/routes/lessons.py:92-104` | Dev fallback creates real `dev_test_user_123` in production DB |

### Code Quality - Bare `except:` Clauses
| # | Location | Issue |
|---|----------|-------|
| 8 | `core/timezone.py:25-26, 54-55` | Bare `except:` clauses hide errors |
| 9 | `core/cohorts.py:128-129, 148-149` | Bare `except:` clauses hide errors |
| 10 | `discord_bot/cogs/groups_cog.py:188-190` | Bare `except:` clause |
| 11 | `discord_bot/cogs/breakout_cog.py:188-190` | Bare `except:` clause |
| 12 | `discord_bot/cogs/stampy_cog.py:263` | Bare `except:` clause |

### Architecture
| # | Location | Issue |
|---|----------|-------|
| 13 | `core/nickname_sync.py` | Uses `sys.modules` lookup - architectural violation |
| 14 | `web_api/routes/users.py:17` | Incorrect `sys.path.insert` (2 levels instead of 3) |

### DRY Violations
| # | Location | Issue |
|---|----------|-------|
| 15 | `discord_bot/cogs/enrollment_cog.py` | Duplicate URL construction logic |
| 16 | `discord_bot/cogs/groups_cog.py:128-144, 366-378` | Duplicate channel permission code |
| 17 | `discord_bot/cogs/breakout_cog.py` | Duplicate interaction response pattern |
| 18 | `core/lesson_chat.py` vs `core/lessons/chat.py` | Duplicate/overlapping modules |
| 19 | Frontend: Multiple files | Duplicate `API_URL` definition (4 files) |
| 20 | Frontend: Multiple files | Duplicate Discord SVG icon (4 files) |

---

## Minor Issues (Address When Convenient)

### Dead Code / Unused
- `web_api/main.py` - Legacy standalone entry point
- `test_stampy_stream.py` - Test file in project root
- `core/queries/groups.py:10` - Unused `GroupUserRole` import
- `web_frontend/src/types/lesson.ts` - Unused legacy types
- `web_frontend/src/data/sampleArticle.ts` - Never imported
- `web_frontend/src/components/signup/StepIndicator.tsx` - Never used
- `web_frontend/src/components/unified-lesson/ContentPanel.tsx` - Multiple unused variables

### Style / Consistency
- Imports inside functions (`traceback`, `io`, `json`, `re`) should be at module level
- Inconsistent `sys.path` manipulation across files
- Missing version pinning in `requirements.txt`
- Repeated `DEV_MODE` check pattern should be centralized
- Frontend: Missing React Fragment keys in `ScheduleSelector.tsx`
- Frontend: Variable shadowing in `UnifiedLesson.tsx`
- Frontend: Inline CSS animations should be in global CSS

---

## Issue Count by Severity

| Area | Critical | Important | Minor |
|------|----------|-----------|-------|
| core/ | 0 | 6 | 10 |
| discord_bot/ | 1 | 7 | 15 |
| web_api/ | 2 | 6 | 6 |
| web_frontend/ | 0 | 11 | 9 |
| Architecture | 0 | 3 | 7 |
| **Total** | **3** | **33** | **47** |

---

## Top 10 Recommendations (Priority Order)

1. **Fix OAuth state memory leak** - Add TTL cleanup or move to database
2. **Fix POST /auth/code Response bug** - Will crash in production
3. **Add authentication to paid API endpoints** (`/transcribe`, `/api/chat/lesson`)
4. **Fix session cookie `secure` flag** - Environment-aware setting
5. **Replace all bare `except:` clauses** with specific exception types
6. **Centralize configuration** - `API_URL`, `DEV_MODE`, `DISCORD_INVITE_URL`
7. **Create shared Discord icon component** in frontend
8. **Refactor `nickname_sync.py`** to use proper callback pattern
9. **Remove dead code** - Legacy files and unused imports
10. **Add React Fragment keys** in `ScheduleSelector.tsx`

---

## Detailed Reports

See individual review files for complete details:
- [01-core-backend.md](./01-core-backend.md) - Core business logic review
- [02-discord-bot.md](./02-discord-bot.md) - Discord adapter review
- [03-web-api.md](./03-web-api.md) - FastAPI layer review
- [04-web-frontend.md](./04-web-frontend.md) - React frontend review
- [05-architecture.md](./05-architecture.md) - Architecture & top-level review
