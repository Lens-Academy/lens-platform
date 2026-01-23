# Codebase Concerns

**Analysis Date:** 2026-01-21

## Tech Debt

**Unimplemented TODO: Module Progress Check**
- Issue: Conditional reminder sending for module progress is stubbed out - always returns True
- Files: `core/notifications/scheduler.py` (lines 223-229)
- Impact: Module progress nudge reminders fire regardless of user completion status, reducing their effectiveness
- Fix approach: Implement `_check_condition()` to query user progress from database before sending reminders

**Unimplemented TODO: Admin Authentication for Manual Cache Refresh**
- Issue: `/api/content/refresh` endpoint has no authentication - anyone can trigger cache refresh
- Files: `web_api/routes/content.py` (lines 88-104)
- Impact: Potential for abuse/DoS by repeatedly triggering cache refreshes
- Fix approach: Add `Depends(get_current_user)` with admin role check

**Unimplemented TODO: Local Time Conversion in Welcome Messages**
- Issue: Group welcome messages show meeting times in UTC only, not converted to each member's timezone
- Files: `discord_bot/cogs/groups_cog.py` (lines 399-409)
- Impact: Poor UX for users in non-UTC timezones; they must mentally convert times
- Fix approach: Use member timezone from database to format local time string

**Legacy JSON Storage Still Present**
- Issue: Old file-based JSON storage (`user_data.json`, `courses.json`) remains alongside PostgreSQL database
- Files: `core/data.py` (entire file)
- Impact: Confusion about data source of truth; potential for data inconsistency
- Fix approach: Remove `core/data.py` after confirming all consumers migrated to database queries

**Deprecated Discord Command**
- Issue: `/toggle-facilitator` command is marked for removal - uses Discord roles instead of database
- Files: `discord_bot/cogs/enrollment_cog.py` (lines 66-122)
- Impact: Confusion about facilitator management; inconsistent with web-based approach
- Fix approach: Remove command or refactor to update database facilitator status

**ContentPreviewModal Not Implemented**
- Issue: Modal shows placeholder text - not functional for new module system
- Files: `web_frontend/src/components/course/ContentPreviewModal.tsx` (entire file)
- Impact: Users cannot preview content from course overview; broken feature
- Fix approach: Reimplement using narrative module sections format

## Known Bugs

**No known critical bugs documented in code.**

Potential issues found:
- Debug logging statements left in production code paths (see Fragile Areas section)

## Security Considerations

**Unauthenticated Cache Refresh Endpoint**
- Risk: Anyone can trigger content cache refresh via POST to `/api/content/refresh`
- Files: `web_api/routes/content.py` (line 88)
- Current mitigation: None
- Recommendations: Add authentication requirement; rate limiting

**Broad Exception Catching**
- Risk: 130+ instances of `except Exception` catch all errors, potentially masking security issues or unexpected behavior
- Files: Throughout codebase (see grep results)
- Current mitigation: Most log the error before handling
- Recommendations: Narrow exception types where possible; ensure errors are logged

**Secrets Accessed via Environment Variables (Correct)**
- Risk: Low - secrets properly accessed via `os.environ`/`os.getenv`
- Files: `web_api/auth.py`, `core/content/github_fetcher.py`, etc.
- Current mitigation: No hardcoded secrets found; `.env` files gitignored
- Recommendations: Document required secrets in onboarding; use secrets manager in production

**Path Traversal Protection**
- Risk: SPA catchall route could expose files outside web root
- Files: `main.py` (lines 320-325)
- Current mitigation: `is_safe_path()` function validates paths stay within `client_path`
- Recommendations: Current implementation appears secure; maintain this pattern

## Performance Bottlenecks

**Stampy Cog Debug Logging**
- Problem: Extensive timing instrumentation with print statements on every chunk
- Files: `discord_bot/cogs/stampy_cog.py` (multiple lines around 317-461)
- Cause: Debug code left enabled in production
- Improvement path: Wrap in conditional `if STAMPY_DEBUG:` or use proper logging levels

**Content Module Debug Logging**
- Problem: Print statements in content loading path for every article load
- Files: `core/modules/content.py` (lines 208-217, 597-607)
- Cause: Debug code for h2 header tracing left enabled
- Improvement path: Remove debug prints or wrap in debug flag

**Large Discord Cog Files**
- Problem: `ping_cog.py` is 694 lines, mostly test commands
- Files: `discord_bot/cogs/ping_cog.py`
- Cause: Test/debug commands mixed with production code
- Improvement path: Move test commands to separate `test_cog.py` or admin-only module

## Fragile Areas

**Stampy Streaming Response Logic**
- Files: `discord_bot/cogs/stampy_cog.py` (lines 271-606)
- Why fragile: Complex state management across thinking/streaming/citations phases; multiple Discord API calls with rate limiting; fire-and-forget tasks for thinking finalization
- Safe modification: Test with slow responses and rapid message edits; verify rate limit handling
- Test coverage: No unit tests found for StampyCog streaming logic

**Groups Realization Flow**
- Files: `discord_bot/cogs/groups_cog.py` (lines 88-291)
- Why fragile: Many side effects: creates Discord channels/events, database records, calendar invites, notification schedules; uses fire-and-forget `asyncio.create_task`
- Safe modification: Test in staging Discord server first; have rollback plan for Discord resources
- Test coverage: Limited - relies on E2E testing

**Content Cache Initialization**
- Files: `core/content/github_fetcher.py`, `core/content/cache.py`
- Why fragile: App startup depends on successful GitHub fetch; failures cause startup abort
- Safe modification: Ensure GitHub API availability; test with rate limits
- Test coverage: Good unit test coverage in `core/content/tests/`

## Scaling Limits

**In-Memory Content Cache**
- Current capacity: All courses, modules, articles, video transcripts held in memory
- Limit: Will grow linearly with content; no eviction policy
- Scaling path: Add LRU eviction or move to Redis/external cache

**APScheduler Job Store**
- Current capacity: Jobs stored in PostgreSQL `apscheduler_jobs` table
- Limit: Falls back to memory-only mode on DB connection timeout
- Scaling path: Current design supports scaling; monitor job table size

## Dependencies at Risk

**No critically deprecated dependencies identified.**

Note: Check periodically for:
- `discord.py` - Active development; API changes possible
- `vike` - Relatively new framework; breaking changes in v0.4→v1.0

## Missing Critical Features

**No Module Progress Tracking in Notifications**
- Problem: `_check_condition()` for module progress always returns True
- Blocks: Intelligent module progress nudges
- Files: `core/notifications/scheduler.py` (lines 223-229)

**No Rate Limiting on API Endpoints**
- Problem: No rate limiting middleware configured
- Blocks: Production-grade API security
- Files: `main.py` (FastAPI setup)

## Test Coverage Gaps

**Discord Bot Cogs**
- What's not tested: `stampy_cog.py` streaming logic, `groups_cog.py` realization flow, most cog command handlers
- Files: `discord_bot/cogs/*.py`
- Risk: Complex Discord API interactions could break silently
- Priority: High - these are user-facing features

**Frontend Components**
- What's not tested: No test files found in `web_frontend/src/`
- Files: `web_frontend/src/components/**/*.tsx`, `web_frontend/src/views/**/*.tsx`
- Risk: UI regressions not caught before deployment
- Priority: Medium - lint/TypeScript catches some issues

**API Route Error Paths**
- What's not tested: Many exception handlers in `web_api/routes/` not covered
- Files: `web_api/routes/modules.py` has 20+ except blocks
- Risk: Error responses may not match API contracts
- Priority: Medium - integration tests provide some coverage

---

*Concerns audit: 2026-01-21*
