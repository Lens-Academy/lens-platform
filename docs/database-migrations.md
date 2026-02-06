# Database Migrations

## Current State

All environments (local, staging, production) are at migration `001` - a squashed baseline with explicit DDL.

### Running Migrations

**New database (CI, new dev setup):**
```bash
alembic upgrade head
```

**Existing database (already has tables):**
```bash
alembic stamp 001
```

## CI with Local PostgreSQL

CI uses a `postgres:17` service container (matching our Supabase version). The schema is created from scratch via `alembic upgrade head` on every run. See `.github/workflows/ci.yml`.

## Migration Files

- `alembic/versions/001_baseline.py` - Current schema (all tables, indexes, views)
- `alembic/versions_old/` - Historical migrations (archived)
