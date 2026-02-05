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

To run tests against a local PostgreSQL in GitHub Actions:

```yaml
services:
  postgres:
    image: postgres:16
    env:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: test_db
    ports:
      - 5432:5432
    options: >-
      --health-cmd pg_isready
      --health-interval 10s
      --health-timeout 5s
      --health-retries 5

steps:
  - name: Run migrations
    env:
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test_db
    run: alembic upgrade head

  - name: Run tests
    env:
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test_db
    run: pytest
```

## Migration Files

- `alembic/versions/001_baseline.py` - Current schema (all tables, indexes, views)
- `alembic/versions_old/` - Historical migrations (archived)
