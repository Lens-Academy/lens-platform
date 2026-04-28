#!/usr/bin/env python3
"""One-shot migration: rewrite legacy chat fixtures in core/promptlab/fixtures/
to the v2 schema. Skips assessment fixtures (different format, kept as-is)
and v2 fixtures (already migrated).

Run from the repo root:
    .venv/bin/python scripts/migrate-fixtures.py

Idempotent: safe to re-run.
"""

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from core.promptlab.fixtures import (  # noqa: E402
    FIXTURES_DIR,
    SCHEMA_VERSION,
    _migrate_legacy_chat,
    save_fixture,
)


def main() -> int:
    if not FIXTURES_DIR.exists():
        print(f"No fixtures dir at {FIXTURES_DIR}, nothing to do.")
        return 0

    migrated = 0
    skipped = 0
    for path in sorted(FIXTURES_DIR.glob("*.json")):
        data = json.loads(path.read_text())
        if data.get("type") == "assessment":
            print(f"  skip (assessment): {path.name}")
            skipped += 1
            continue
        if data.get("schemaVersion") == SCHEMA_VERSION:
            print(f"  skip (already v2): {path.name}")
            skipped += 1
            continue

        new = _migrate_legacy_chat(data)
        # save_fixture requires `name` matches the filename. v2 names must be
        # slug-y (lowercase + dashes), so we use the filename as the new name
        # and preserve the human-readable original in `description`.
        save_name = path.stem
        old_display = data.get("name") or save_name
        if old_display != save_name and old_display not in (new.get("description") or ""):
            new["description"] = (
                f"{old_display}. {new.get('description', '')}".strip(". ")
            )
        new["name"] = save_name
        save_fixture(save_name, new)
        print(f"  migrated:        {path.name} → schemaVersion {SCHEMA_VERSION}")
        migrated += 1

    print(f"\nDone. Migrated {migrated}, skipped {skipped}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
