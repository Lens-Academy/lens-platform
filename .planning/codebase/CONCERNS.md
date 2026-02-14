# Codebase Concerns

**Analysis Date:** 2026-02-14

## Tech Debt

**External Scheduling Algorithm Dependency:**
- Issue: Core scheduling logic depends on external GitHub package `cohort-scheduler @ git+https://github.com/cpdally/cohort-scheduler.git`
- Files: `requirements.txt`, `core/scheduling.py`
- Impact: Cannot modify scheduling algorithm without forking external repo. No version pinning (uses HEAD of main branch), creating deployment risk.
- Fix approach: Either vendor the package into the repo for control, or pin to a specific commit SHA in requirements.txt

**Dual Migration Systems:**
- Issue: Legacy manual SQL migrations in `migrations/` coexist with Alembic migrations in `alembic/versions/`
- Files: `migrations/*.sql`, `alembic/versions/*.py`, `migrations/CLAUDE.md`
- Impact: Confusion about which system to use. Risk of schema drift if someone adds a manual SQL migration instead of using Alembic.
- Fix approach: Archive `migrations/` directory, add README redirecting to Alembic. Ensure all developers know Alembic is the only migration path.

**In-Memory Rate Limiter Without Cleanup:**
- Issue: `RateLimiter` class stores timestamps in memory indefinitely, only pruning per-IP on subsequent requests
- Files: `web_api/rate_limit.py`
- Impact: Memory leak if many unique IPs hit the endpoint once and never return. Dict grows unbounded.
- Fix approach: Add periodic cleanup task or implement sliding window with TTL-based eviction

**Legacy/Deprecated Code Markers:**
- Issue: Multiple files reference deprecated paths and fields
- Files: `core/transcripts/tools.py` (references `educational_content_deprecated/`), `core/modules/loader.py` (legacy function names), `web_api/routes/progress.py` (deprecated fields)
- Impact: Code references paths that may not exist. Increases confusion for new developers.
- Fix approach: Remove deprecated code paths. If backward compatibility needed, add explicit deprecation warnings with removal timeline.

**Cache Not Thread-Safe:**
- Issue: Global `_cache` singleton in `core/content/cache.py` accessed without locks from multiple async coroutines
- Files: `core/content/cache.py`, `core/content/webhook_handler.py`
- Impact: Race conditions during cache refresh. Multiple webhooks arriving simultaneously could cause concurrent modifications.
- Fix approach: Add asyncio.Lock around cache modification operations in webhook handler (fetch lock exists but doesn't cover all cache mutations)

**Manual Cleanup Required for E2E Tests:**
- Issue: Discord E2E tests create channels/roles but cleanup is manual and fragile
- Files: `discord_bot/tests/test_discord_e2e.py`
- Impact: Failed tests leave stale Discord resources. Cleanup fixture requires manual tracking of created resources.
- Fix approach: Use Discord test guild with ephemeral channels, or implement more robust cleanup with server-side tracking

## Known Bugs

**Critical Format Mismatch (RESOLVED):**
- Fixed in 2026-01-03 per `docs/reviews/2026-01-03-availability-selector-review.md`
- Issue was in `core/scheduling.py` passing raw JSON to scheduler expecting different format
- Resolution: Created `core/availability.py` with format conversion helpers

**Availability UTC/Local Timezone Confusion (RESOLVED):**
- Fixed in 2026-01-03 per same review document
- Column renamed from `availability_utc` to `availability_local`
- UTC conversion now happens at scheduling time with proper DST handling

## Security Considerations

**JWT Secret Validation Only in Production:**
- Risk: Development environments can run without JWT_SECRET, but auth endpoints will crash at runtime
- Files: `web_api/auth.py`
- Current mitigation: Startup check only runs if `RAILWAY_ENVIRONMENT` is set
- Recommendations: Fail fast on startup in all environments if auth routes are enabled. Add `--no-auth` flag for frontend-only dev.

**Session Cookie Configuration Environment-Dependent:**
- Risk: Cookie SameSite and Secure attributes depend on environment variables that may be misconfigured
- Files: `web_api/auth.py` (lines 83-98)
- Current mitigation: Defaults to "lax" and checks `RAILWAY_ENVIRONMENT` for production mode
- Recommendations: Add startup validation that cookie settings match deployment mode. Document required env vars for staging cross-origin setup.

**GitHub Webhook Secret Not Validated at Startup:**
- Risk: Content webhook endpoint can be deployed without signature verification
- Files: `core/content/webhook_handler.py`, `web_api/routes/content.py`
- Current mitigation: Signature verification happens on first webhook, returns 500 if unconfigured
- Recommendations: Add `GITHUB_WEBHOOK_SECRET` to required env vars check at startup (in `core/config.py`)

**Database Credentials in URLs:**
- Risk: Full DATABASE_URL (including password) appears in error messages
- Files: `core/database.py` (lines 156-178 in error messages)
- Current mitigation: Error messages try to extract just the host, but full URL could leak in logs
- Recommendations: Sanitize DATABASE_URL before logging. Never log full connection string.

**No Request Rate Limiting Beyond Auth:**
- Risk: API endpoints lack rate limiting except `/auth/start` and `/auth/refresh`
- Files: `web_api/rate_limit.py` only used in `web_api/routes/auth.py`
- Current mitigation: None for content/progress/module endpoints
- Recommendations: Add per-user rate limiting for expensive operations (LLM chat, content processing)

## Performance Bottlenecks

**Synchronous Content Processing:**
- Problem: TypeScript content processor runs as subprocess and blocks
- Files: `core/content/typescript_processor.py`, `core/content/github_fetcher.py`
- Cause: `subprocess.run()` blocks event loop during incremental refresh
- Improvement path: Use `asyncio.create_subprocess_exec()` to avoid blocking. Content processing can take several seconds for large diffs.

**Large File Detection (2355 lines):**
- Files: `core/tests/test_sync.py` (2355 lines), `core/sync.py` (1965 lines)
- Why slow: `core/sync.py` handles Discord permissions, calendar events, and reminders in one module. Test file has extensive mocking.
- Test coverage: Good - complex logic is well tested
- Improvement path: Split `core/sync.py` into `sync/discord.py`, `sync/calendar.py`, `sync/reminders.py`

**No Database Query Optimization:**
- Problem: No query analysis, indexing strategy, or N+1 detection
- Files: Multiple in `core/queries/`, `web_api/routes/`
- Cause: Early-stage development prioritizing features
- Improvement path: Add SQLAlchemy query logging (`SQL_ECHO=true`), identify slow queries, add indexes. Especially important for scheduling queries across all users.

**Google Calendar Rate Limits:**
- Problem: Calendar API operations have quotas and can fail with rate limit errors
- Files: `core/calendar/client.py` (has detection but limited retry logic)
- Cause: Batch operations on group scheduling can hit quota
- Improvement path: Implement exponential backoff with jitter (partially exists in `core/notifications/scheduler.py`), batch calendar operations where possible

**No Caching for Course/Module Content:**
- Problem: Every module request re-loads from in-memory cache dict, but cache itself is never stale-checked
- Files: `core/modules/loader.py`, `core/content/cache.py`
- Cause: Content is GitHub-sourced and cache refreshes on webhook, so assumed fresh
- Improvement path: Add cache staleness detection and background refresh. Current webhook system can miss updates if webhook delivery fails.

## Fragile Areas

**Discord Bot Availability Assumption:**
- Files: `core/sync.py`, `core/nickname_sync.py`, `core/discord_outbound/messages.py`
- Why fragile: Many `core/` functions check `if not get_bot(): return {"status": "failed"}` but callers don't always handle this gracefully
- Test coverage: Limited - most tests mock Discord bot as always available
- Safe modification: Always check return status from sync operations. Add tests with bot unavailable.
- Specific example: In `core/sync.py` line 51-53, returns error dict but caller in `sync_group()` may not check status

**Content Cache Race Conditions:**
- Files: `core/content/webhook_handler.py`, `core/content/cache.py`
- Why fragile: Global cache modified during webhook processing with fetch lock, but cache reads are unlocked
- Test coverage: `core/content/tests/test_webhook_handler.py` has concurrency tests but limited scenarios
- Safe modification: Never read cache.validation_errors or cache.last_diff without checking if cache refresh is in progress
- Specific example: `handle_content_update()` sets `cache.known_sha` outside the fetch lock (line 85-87)

**Breakout Room Management:**
- Files: `discord_bot/cogs/breakout_cog.py` (1062 lines)
- Why fragile: Complex state machine for voice channel management with manual user tracking
- Test coverage: No tests for `breakout_cog.py` in `discord_bot/tests/`
- Safe modification: Always test with real Discord server. Avoid editing role/permission logic without E2E verification.
- Specific concern: Channel name editing rate-limited by Discord to ~2 per 10 minutes (line 916 comment)

**Database Schema Synchronization:**
- Files: `core/tables.py`, `alembic/versions/*.py`
- Why fragile: Tables defined in SQLAlchemy Core (not ORM), autogenerate may miss some changes
- Test coverage: No integration tests verifying tables.py matches actual database schema
- Safe modification: Always run `alembic revision --autogenerate` after editing `tables.py`. Manually verify generated migration before applying.

**APScheduler Persistence:**
- Files: `core/notifications/scheduler.py`
- Why fragile: Jobs stored in PostgreSQL table `apscheduler_jobs` with pickled Python objects
- Test coverage: `core/notifications/tests/test_scheduler.py` has tests but doesn't cover job serialization failures
- Safe modification: Never change function signatures of scheduled job functions. Old pickled jobs will fail to deserialize.
- Specific risk: If `send_meeting_reminder()` signature changes, existing scheduled jobs will crash

## Scaling Limits

**In-Memory Content Cache:**
- Current capacity: All courses/modules loaded into single Python process memory
- Limit: ~100MB of educational content (estimated from current usage)
- Scaling path: Currently sufficient for single course. If multiple large courses added, implement Redis or disk-backed cache with LRU eviction.

**Single Discord Bot Instance:**
- Current capacity: One bot process handles all guilds (currently 1 production guild)
- Limit: Discord API rate limits per bot token (~50 requests/second global, stricter per-guild)
- Scaling path: Add rate limiting middleware. If serving multiple guilds, implement bot sharding.

**PostgreSQL Connection Pool:**
- Current settings: `pool_size=5`, `max_overflow=10` in `core/database.py`
- Limit: 15 concurrent database operations maximum
- Scaling path: Increase pool size as concurrent users grow. Monitor with connection pool metrics.

**Synchronous Background Jobs:**
- Current: APScheduler runs in same event loop as FastAPI/Discord bot
- Limit: Long-running jobs block event loop, degrading API response time
- Scaling path: Move heavy jobs (email sends, calendar operations) to separate worker process with task queue (Celery/Redis)

## Dependencies at Risk

**cohort-scheduler (Unpinned Git Dependency):**
- Risk: Pulling from GitHub HEAD, no version control
- Impact: Deployment can break if upstream changes algorithm or API
- Migration plan: Fork to `Lens-Academy/cohort-scheduler` and pin to commit SHA, or vendor into this repo

**discord.py (Major Version Risk):**
- Current: `>=2.3.0` allows automatic minor/patch upgrades
- Risk: Discord.py 3.0 may have breaking changes
- Impact: Bot commands/events could break on upgrade
- Migration plan: Pin to `~=2.3.0` (allow patches only) until testing against 3.0

**LiteLLM (Rapid API Changes):**
- Current: `>=1.40.0` allows automatic upgrades
- Risk: LLM provider APIs change frequently, LiteLLM interface may shift
- Impact: Chat/lesson LLM features could break
- Migration plan: Test upgrades in staging before production. Consider pinning major version.

## Missing Critical Features

**No User Data Export:**
- Problem: Users cannot export their progress/transcript data
- Blocks: GDPR compliance, user trust
- Priority: High - legal requirement in some jurisdictions

**No Database Backup Verification:**
- Problem: Database backups exist (in `backups/` dir) but no automated restore testing
- Blocks: Disaster recovery confidence
- Priority: Medium - manual backups exist but restoration untested

**No Monitoring/Alerting:**
- Problem: Sentry captures errors but no alerting on error rate spikes or service degradation
- Blocks: Proactive incident response
- Priority: Medium - Sentry provides visibility but requires manual checking

**No Content Rollback:**
- Problem: If bad content deployed via webhook, no quick rollback mechanism
- Blocks: Fast recovery from content errors
- Priority: Medium - can manually revert GitHub commit but no one-click rollback

## Test Coverage Gaps

**Discord Cog Integration:**
- What's not tested: Most Discord cogs lack dedicated tests
- Files: `discord_bot/cogs/breakout_cog.py`, `discord_bot/cogs/stampy_cog.py`, `discord_bot/cogs/groups_cog.py`
- Risk: Breaking changes to Discord commands go undetected until production
- Priority: High

**Content Processing Edge Cases:**
- What's not tested: TypeScript processor error handling, malformed content recovery
- Files: `core/content/typescript_processor.py`
- Risk: Content updates could crash server if processor returns unexpected format
- Priority: Medium

**Database Migration Rollbacks:**
- What's not tested: Alembic migration `downgrade` operations
- Files: `alembic/versions/*.py`
- Risk: Cannot safely rollback schema changes in production
- Priority: Medium - migrations rarely need rollback but critical when needed

**Rate Limiter Memory Behavior:**
- What's not tested: Rate limiter behavior under sustained load from many IPs
- Files: `web_api/rate_limit.py`
- Risk: Memory leak or incorrect limiting under production traffic
- Priority: Low - auth endpoints are low traffic

**Sync Operation Failures:**
- What's not tested: Discord/Calendar/Scheduler sync when external services are unavailable
- Files: `core/sync.py`, `core/calendar/events.py`
- Risk: Cascading failures if one sync operation blocks others
- Priority: Medium

**APScheduler Job Persistence:**
- What's not tested: Recovery from corrupted job store, job deserialization failures
- Files: `core/notifications/scheduler.py`
- Risk: Scheduler fails to start if job store is corrupted
- Priority: Low - rare failure mode but hard to debug

---

*Concerns audit: 2026-02-14*
