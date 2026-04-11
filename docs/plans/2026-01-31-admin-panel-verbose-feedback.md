# Admin Panel Verbose Feedback Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Display detailed operation results in the admin panel after sync/realize operations complete, showing what happened (infrastructure created, permissions granted, calendar synced, etc.) instead of just "Synced X groups successfully".

**Architecture:** The backend already returns detailed structured results from `sync_group()`. We'll add TypeScript types for these results, create a collapsible `OperationDetails` component to render them, and wire it into the existing success message flow. No backend changes needed.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4

---

## Task 1: Add TypeScript Types for Sync Results

**Files:**
- Modify: `web_frontend/src/api/admin.ts`

**Step 1: Add detailed type definitions**

Add these types after the existing `SyncResult` interface (around line 45):

```typescript
// Detailed sync result types (matches backend sync_group() return structure)

export interface InfrastructureStatus {
  status: "existed" | "created" | "skipped" | "failed" | "channel_missing" | "role_missing";
  id?: string | null;
  error?: string;
}

export interface InfrastructureResult {
  category: InfrastructureStatus;
  text_channel: InfrastructureStatus;
  voice_channel: InfrastructureStatus;
  welcome_message_sent?: boolean;
  meetings: {
    created: number;
    existed: number;
    error?: string;
  };
  discord_events: {
    created: number;
    existed: number;
    skipped: number;
    failed: number;
  };
}

export interface DiscordResult {
  granted: number;
  revoked: number;
  unchanged: number;
  failed: number;
  role_status?: string;
  cohort_channel_status?: string;
  error?: string;
}

export interface CalendarResult {
  meetings: number;
  created_recurring: boolean;
  recurring_event_id?: string | null;
  patched: number;
  failed: number;
  error?: string;
  reason?: string;
}

export interface RemindersResult {
  meetings: number;
}

export interface RsvpsResult {
  synced?: number;
  rsvps_updated?: number;
  error?: string;
}

export interface NotificationsResult {
  sent: number;
  skipped: number;
  channel_announcements: number;
}

export interface GroupSyncResult {
  infrastructure?: InfrastructureResult;
  discord?: DiscordResult;
  calendar?: CalendarResult;
  reminders?: RemindersResult;
  rsvps?: RsvpsResult;
  notifications?: NotificationsResult;
  needs_infrastructure?: boolean;
  error?: string;
}

export interface CohortSyncResult {
  synced?: number;
  realized?: number;
  results: Array<{
    group_id: number;
    result: GroupSyncResult;
  }>;
}
```

**Step 2: Update function return types**

Update `syncGroup` return type (line 101):
```typescript
export async function syncGroup(groupId: number): Promise<GroupSyncResult> {
```

Update `realizeGroup` return type (line 121):
```typescript
export async function realizeGroup(groupId: number): Promise<GroupSyncResult> {
```

Update `syncCohort` return type (line 161):
```typescript
export async function syncCohort(cohortId: number): Promise<CohortSyncResult> {
```

Update `realizeCohort` return type (line 180):
```typescript
export async function realizeCohort(cohortId: number): Promise<CohortSyncResult> {
```

**Step 3: Run lint to verify types**

Run: `cd web_frontend && npm run lint`
Expected: No type errors (may have unrelated warnings)

**Step 4: Commit**

```bash
git add web_frontend/src/api/admin.ts
git commit -m "$(cat <<'EOF'
feat(admin): add TypeScript types for detailed sync results

Adds comprehensive type definitions matching the backend sync_group()
return structure. Enables type-safe rendering of operation details.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Create OperationDetails Component

**Files:**
- Create: `web_frontend/src/components/OperationDetails.tsx`

**Step 1: Create the component file**

```tsx
import { useState } from "react";
import type {
  GroupSyncResult,
  CohortSyncResult,
  InfrastructureStatus,
} from "../api/admin";

// Status icons and colors
function StatusIcon({ status }: { status: InfrastructureStatus["status"] }) {
  switch (status) {
    case "created":
      return <span className="text-green-600">✓ created</span>;
    case "existed":
      return <span className="text-gray-500">○ existed</span>;
    case "skipped":
      return <span className="text-gray-400">– skipped</span>;
    case "failed":
      return <span className="text-red-600">✗ failed</span>;
    case "channel_missing":
    case "role_missing":
      return <span className="text-yellow-600">⚠ missing</span>;
    default:
      return <span className="text-gray-400">?</span>;
  }
}

function CountBadge({
  label,
  count,
  variant = "neutral",
}: {
  label: string;
  count: number;
  variant?: "success" | "warning" | "error" | "neutral";
}) {
  if (count === 0) return null;

  const colors = {
    success: "bg-green-100 text-green-800",
    warning: "bg-yellow-100 text-yellow-800",
    error: "bg-red-100 text-red-800",
    neutral: "bg-gray-100 text-gray-800",
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colors[variant]}`}>
      {count} {label}
    </span>
  );
}

// Single group result display
function GroupResultDetails({ result }: { result: GroupSyncResult }) {
  if (result.error) {
    return (
      <div className="text-red-600 text-sm">
        Error: {result.error}
      </div>
    );
  }

  if (result.needs_infrastructure) {
    return (
      <div className="text-yellow-600 text-sm">
        Needs infrastructure (use Realize)
      </div>
    );
  }

  return (
    <div className="space-y-2 text-sm">
      {/* Infrastructure */}
      {result.infrastructure && (
        <div>
          <div className="font-medium text-gray-700">Infrastructure:</div>
          <div className="ml-4 space-y-1">
            <div className="flex gap-2">
              <span className="text-gray-500 w-24">Category:</span>
              <StatusIcon status={result.infrastructure.category.status} />
            </div>
            <div className="flex gap-2">
              <span className="text-gray-500 w-24">Text channel:</span>
              <StatusIcon status={result.infrastructure.text_channel.status} />
            </div>
            <div className="flex gap-2">
              <span className="text-gray-500 w-24">Voice channel:</span>
              <StatusIcon status={result.infrastructure.voice_channel.status} />
            </div>
            {result.infrastructure.meetings && (
              <div className="flex gap-2">
                <span className="text-gray-500 w-24">Meetings:</span>
                <span>
                  {result.infrastructure.meetings.created > 0 && (
                    <CountBadge label="created" count={result.infrastructure.meetings.created} variant="success" />
                  )}
                  {result.infrastructure.meetings.existed > 0 && (
                    <span className="text-gray-500 ml-1">{result.infrastructure.meetings.existed} existed</span>
                  )}
                </span>
              </div>
            )}
            {result.infrastructure.discord_events && (
              <div className="flex gap-2">
                <span className="text-gray-500 w-24">Discord events:</span>
                <div className="flex gap-1 flex-wrap">
                  <CountBadge label="created" count={result.infrastructure.discord_events.created} variant="success" />
                  <CountBadge label="failed" count={result.infrastructure.discord_events.failed} variant="error" />
                  {result.infrastructure.discord_events.existed > 0 && (
                    <span className="text-gray-500">{result.infrastructure.discord_events.existed} existed</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Discord permissions */}
      {result.discord && (
        <div>
          <div className="font-medium text-gray-700">Discord permissions:</div>
          <div className="ml-4 flex gap-2 flex-wrap">
            <CountBadge label="granted" count={result.discord.granted} variant="success" />
            <CountBadge label="revoked" count={result.discord.revoked} variant="warning" />
            <CountBadge label="failed" count={result.discord.failed} variant="error" />
            {result.discord.unchanged > 0 && (
              <span className="text-gray-500 text-xs">{result.discord.unchanged} unchanged</span>
            )}
            {result.discord.error && (
              <span className="text-red-600 text-xs">Error: {result.discord.error}</span>
            )}
          </div>
        </div>
      )}

      {/* Calendar */}
      {result.calendar && (
        <div>
          <div className="font-medium text-gray-700">Calendar:</div>
          <div className="ml-4 flex gap-2 flex-wrap">
            {result.calendar.created_recurring && (
              <CountBadge label="recurring event created" count={1} variant="success" />
            )}
            <CountBadge label="patched" count={result.calendar.patched} variant="success" />
            <CountBadge label="failed" count={result.calendar.failed} variant="error" />
            {result.calendar.reason && (
              <span className="text-gray-500 text-xs">{result.calendar.reason}</span>
            )}
            {result.calendar.error && (
              <span className="text-red-600 text-xs">Error: {result.calendar.error}</span>
            )}
          </div>
        </div>
      )}

      {/* Reminders */}
      {result.reminders && result.reminders.meetings > 0 && (
        <div>
          <div className="font-medium text-gray-700">Reminders:</div>
          <div className="ml-4 text-gray-600">
            {result.reminders.meetings} meetings scheduled
          </div>
        </div>
      )}

      {/* Notifications */}
      {result.notifications && (result.notifications.sent > 0 || result.notifications.skipped > 0) && (
        <div>
          <div className="font-medium text-gray-700">Notifications:</div>
          <div className="ml-4 flex gap-2 flex-wrap">
            <CountBadge label="sent" count={result.notifications.sent} variant="success" />
            {result.notifications.skipped > 0 && (
              <span className="text-gray-500 text-xs">{result.notifications.skipped} skipped (already sent)</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Cohort result with multiple groups
export function CohortOperationDetails({
  result,
  operationType,
}: {
  result: CohortSyncResult;
  operationType: "sync" | "realize";
}) {
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());

  const toggleGroup = (groupId: number) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const count = operationType === "sync" ? result.synced : result.realized;

  return (
    <div className="mt-2">
      <div className="text-sm text-gray-600 mb-2">
        {operationType === "sync" ? "Synced" : "Realized"} {count} group{count !== 1 ? "s" : ""}
      </div>

      {result.results && result.results.length > 0 && (
        <div className="space-y-2">
          {result.results.map(({ group_id, result: groupResult }) => (
            <div key={group_id} className="border rounded bg-gray-50">
              <button
                onClick={() => toggleGroup(group_id)}
                className="w-full px-3 py-2 text-left text-sm font-medium flex justify-between items-center hover:bg-gray-100"
              >
                <span>Group {group_id}</span>
                <span className="text-gray-400">{expandedGroups.has(group_id) ? "▼" : "▶"}</span>
              </button>
              {expandedGroups.has(group_id) && (
                <div className="px-3 pb-3 border-t bg-white">
                  <GroupResultDetails result={groupResult} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Single group operation details
export function GroupOperationDetails({ result }: { result: GroupSyncResult }) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Check if there's anything interesting to show
  const hasDetails =
    result.infrastructure ||
    result.discord ||
    result.calendar ||
    result.reminders ||
    result.notifications ||
    result.error ||
    result.needs_infrastructure;

  if (!hasDetails) {
    return null;
  }

  return (
    <div className="mt-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="text-sm text-blue-600 hover:text-blue-800"
      >
        {isExpanded ? "Hide details ▲" : "Show details ▼"}
      </button>
      {isExpanded && (
        <div className="mt-2 p-3 border rounded bg-gray-50">
          <GroupResultDetails result={result} />
        </div>
      )}
    </div>
  );
}
```

**Step 2: Run lint to verify component**

Run: `cd web_frontend && npm run lint`
Expected: PASS (no errors in new file)

**Step 3: Commit**

```bash
git add web_frontend/src/components/OperationDetails.tsx
git commit -m "$(cat <<'EOF'
feat(admin): add OperationDetails component for sync results

Collapsible component that renders detailed sync/realize operation
results including infrastructure status, Discord permissions, calendar,
reminders, and notifications. Supports both single group and cohort
(multi-group) operations.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Integrate OperationDetails into Admin Panel

**Files:**
- Modify: `web_frontend/src/views/Admin.tsx`

**Step 1: Add imports at top of file**

After the existing imports (around line 16), add:

```typescript
import {
  GroupOperationDetails,
  CohortOperationDetails,
} from "../components/OperationDetails";
import type { GroupSyncResult, CohortSyncResult } from "../api/admin";
```

**Step 2: Add state for storing operation results**

After the existing state declarations (around line 58), add:

```typescript
  // Operation results for detailed display
  const [lastGroupResult, setLastGroupResult] = useState<{
    groupId: number;
    result: GroupSyncResult;
    operationType: "sync" | "realize";
  } | null>(null);
  const [lastCohortResult, setLastCohortResult] = useState<{
    result: CohortSyncResult;
    operationType: "sync" | "realize";
  } | null>(null);
```

**Step 3: Update handleSyncUserGroup to capture result**

Replace the `handleSyncUserGroup` function (lines 147-161) with:

```typescript
  // Sync user's group (Users tab)
  const handleSyncUserGroup = async () => {
    if (!selectedUser?.group_id) return;

    setIsSyncing(true);
    setSyncMessage(null);
    setError(null);
    setLastGroupResult(null);
    try {
      const result = await syncGroup(selectedUser.group_id);
      setSyncMessage("Group synced successfully");
      setLastGroupResult({
        groupId: selectedUser.group_id,
        result,
        operationType: "sync",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setIsSyncing(false);
    }
  };
```

**Step 4: Update handleSyncCohort to capture result**

Replace the `handleSyncCohort` function (lines 221-235) with:

```typescript
  // Sync all groups in cohort (Groups tab)
  const handleSyncCohort = async () => {
    if (!selectedCohortId) return;

    setCohortSyncing(true);
    setSyncMessage(null);
    setError(null);
    setLastCohortResult(null);
    setLastGroupResult(null);
    try {
      const result = await syncCohort(selectedCohortId);
      setSyncMessage(`Synced ${result.synced} groups successfully`);
      setLastCohortResult({ result, operationType: "sync" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cohort sync failed");
    } finally {
      setCohortSyncing(false);
    }
  };
```

**Step 5: Update handleRealizeCohort to capture result**

Replace the `handleRealizeCohort` function (lines 238-255) with:

```typescript
  // Realize All Preview Groups in cohort (Groups tab)
  const handleRealizeCohort = async () => {
    if (!selectedCohortId) return;

    setCohortRealizing(true);
    setSyncMessage(null);
    setError(null);
    setLastCohortResult(null);
    setLastGroupResult(null);
    try {
      const result = await realizeCohort(selectedCohortId);
      setSyncMessage(`Realized ${result.realized} groups successfully`);
      setLastCohortResult({ result, operationType: "realize" });
      // Refresh groups list
      const groupsList = await getCohortGroups(selectedCohortId);
      setGroups(groupsList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cohort realize failed");
    } finally {
      setCohortRealizing(false);
    }
  };
```

**Step 6: Update handleSyncGroupById to capture result**

Replace the `handleSyncGroupById` function (lines 258-270) with:

```typescript
  // Sync a single group (Groups tab)
  const handleSyncGroupById = async (groupId: number) => {
    setGroupSyncing((prev) => ({ ...prev, [groupId]: true }));
    setSyncMessage(null);
    setError(null);
    setLastGroupResult(null);
    setLastCohortResult(null);
    try {
      const result = await syncGroup(groupId);
      setSyncMessage("Group synced successfully");
      setLastGroupResult({ groupId, result, operationType: "sync" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Group sync failed");
    } finally {
      setGroupSyncing((prev) => ({ ...prev, [groupId]: false }));
    }
  };
```

**Step 7: Update handleRealizeGroupById to capture result**

Replace the `handleRealizeGroupById` function (lines 273-290) with:

```typescript
  // Realize a single group (Groups tab)
  const handleRealizeGroupById = async (groupId: number) => {
    if (!selectedCohortId) return;

    setGroupRealizing((prev) => ({ ...prev, [groupId]: true }));
    setSyncMessage(null);
    setError(null);
    setLastGroupResult(null);
    setLastCohortResult(null);
    try {
      const result = await realizeGroup(groupId);
      setSyncMessage("Group realized successfully");
      setLastGroupResult({ groupId, result, operationType: "realize" });
      // Refresh groups list
      const groupsList = await getCohortGroups(selectedCohortId);
      setGroups(groupsList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Group realize failed");
    } finally {
      setGroupRealizing((prev) => ({ ...prev, [groupId]: false }));
    }
  };
```

**Step 8: Add OperationDetails rendering after success message**

Find the success message div (around line 330):
```tsx
{syncMessage && (
  <div className="mb-4 p-3 bg-green-100 border border-green-300 text-green-700 rounded">
    {syncMessage}
  </div>
)}
```

Replace it with:
```tsx
{/* Success message with operation details */}
{syncMessage && (
  <div className="mb-4 p-3 bg-green-100 border border-green-300 text-green-700 rounded">
    {syncMessage}
    {lastGroupResult && (
      <GroupOperationDetails result={lastGroupResult.result} />
    )}
    {lastCohortResult && (
      <CohortOperationDetails
        result={lastCohortResult.result}
        operationType={lastCohortResult.operationType}
      />
    )}
  </div>
)}
```

**Step 9: Run lint to verify changes**

Run: `cd web_frontend && npm run lint`
Expected: PASS

**Step 10: Run build to verify TypeScript**

Run: `cd web_frontend && npm run build`
Expected: PASS

**Step 11: Commit**

```bash
git add web_frontend/src/views/Admin.tsx
git commit -m "$(cat <<'EOF'
feat(admin): integrate operation details into success messages

After sync/realize operations complete, shows expandable details
panel with infrastructure status, Discord permissions granted/revoked,
calendar sync results, and notifications sent. Works for both single
group and cohort-level operations.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Manual Testing

**Step 1: Start dev servers**

```bash
# Terminal 1 - Backend
python main.py --dev

# Terminal 2 - Frontend
cd web_frontend && npm run dev
```

**Step 2: Test single group sync**

1. Navigate to http://localhost:3002/admin (adjust port as needed)
2. Go to Groups tab
3. Select a cohort with active groups
4. Click "Sync" on a group
5. Verify: Success message appears with "Show details" link
6. Click "Show details"
7. Verify: Expanded panel shows Discord permissions (granted/unchanged), Calendar, Reminders sections

**Step 3: Test cohort sync**

1. Click "Sync All Groups" button
2. Verify: Success message shows "Synced N groups successfully"
3. Verify: Below message, collapsible list of groups appears
4. Click on a group to expand
5. Verify: Shows detailed results for that group

**Step 4: Test realize (if preview groups exist)**

1. If there are preview groups, click "Realize All Preview"
2. Verify: Similar detailed output appears
3. Verify: Infrastructure section shows category/channels created

**Step 5: Commit (if any fixes needed)**

Only commit if you made fixes during testing.

---

## Summary

This implementation:
1. **Types** - Added comprehensive TypeScript types matching backend `sync_group()` return structure
2. **Component** - Created reusable `OperationDetails` component with collapsible details
3. **Integration** - Wired component into existing success message flow
4. **No backend changes** - Leverages existing rich return data

The admin will now see exactly what happened after each operation - infrastructure created, permissions granted, calendar events patched, etc.
