/**
 * One-time migration to clean up legacy localStorage keys.
 *
 * Removes old progress tracking keys that are no longer used:
 * - module-completed-* (replaced by server-side progress tracking)
 * - module_session_* (replaced by anonymous_token)
 *
 * Call this once on app initialization (e.g., in Module.tsx).
 */
export function cleanupLegacyProgress(): void {
  // Skip if already done
  if (localStorage.getItem("progress_migration_v2")) {
    return;
  }

  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (
      key?.startsWith("module-completed-") ||
      key?.startsWith("module_session_")
    ) {
      keysToRemove.push(key);
    }
  }

  // Remove collected keys (can't remove during iteration)
  keysToRemove.forEach((key) => localStorage.removeItem(key));

  // Mark cleanup as done
  localStorage.setItem("progress_migration_v2", "done");

  if (keysToRemove.length > 0) {
    console.debug(
      `[progressMigration] Cleaned up ${keysToRemove.length} legacy keys`,
    );
  }
}
