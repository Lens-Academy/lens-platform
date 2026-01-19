# Database Migrations

**This folder contains legacy manual SQL migrations. Do not add new files here.**

Use Alembic instead (migrations live in `alembic/versions/`).

## Workflow

**NEVER write migrations manually.** Instead:

1. Update `core/tables.py` with the desired schema changes
2. Generate migration: `alembic revision --autogenerate -m "description"`
3. Review the generated migration in `alembic/versions/`
4. Ask the user if the migration needs edits before running
5. Run: `alembic upgrade head`

Alembic compares `tables.py` against the actual database and generates the appropriate ALTER statements.

Note: Requires `DATABASE_URL` environment variable (source from `.env.local`).
