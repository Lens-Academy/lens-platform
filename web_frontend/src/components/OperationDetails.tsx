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
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colors[variant]}`}
    >
      {count} {label}
    </span>
  );
}

// Single group result display
function GroupResultDetails({ result }: { result: GroupSyncResult }) {
  if (result.error) {
    return <div className="text-red-600 text-sm">Error: {result.error}</div>;
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
                    <CountBadge
                      label="created"
                      count={result.infrastructure.meetings.created}
                      variant="success"
                    />
                  )}
                  {result.infrastructure.meetings.existed > 0 && (
                    <span className="text-gray-500 ml-1">
                      {result.infrastructure.meetings.existed} existed
                    </span>
                  )}
                </span>
              </div>
            )}
            {result.infrastructure.discord_events && (
              <div className="flex gap-2">
                <span className="text-gray-500 w-24">Discord events:</span>
                <div className="flex gap-1 flex-wrap">
                  <CountBadge
                    label="created"
                    count={result.infrastructure.discord_events.created}
                    variant="success"
                  />
                  <CountBadge
                    label="failed"
                    count={result.infrastructure.discord_events.failed}
                    variant="error"
                  />
                  {result.infrastructure.discord_events.existed > 0 && (
                    <span className="text-gray-500">
                      {result.infrastructure.discord_events.existed} existed
                    </span>
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
            <CountBadge
              label="granted"
              count={result.discord.granted}
              variant="success"
            />
            <CountBadge
              label="revoked"
              count={result.discord.revoked}
              variant="warning"
            />
            <CountBadge
              label="failed"
              count={result.discord.failed}
              variant="error"
            />
            {result.discord.unchanged > 0 && (
              <span className="text-gray-500 text-xs">
                {result.discord.unchanged} unchanged
              </span>
            )}
            {result.discord.error && (
              <span className="text-red-600 text-xs">
                Error: {result.discord.error}
              </span>
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
              <CountBadge
                label="recurring event created"
                count={1}
                variant="success"
              />
            )}
            <CountBadge
              label="patched"
              count={result.calendar.patched}
              variant="success"
            />
            <CountBadge
              label="failed"
              count={result.calendar.failed}
              variant="error"
            />
            {result.calendar.reason && (
              <span className="text-gray-500 text-xs">
                {result.calendar.reason}
              </span>
            )}
            {result.calendar.error && (
              <span className="text-red-600 text-xs">
                Error: {result.calendar.error}
              </span>
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
      {result.notifications &&
        (result.notifications.sent > 0 || result.notifications.skipped > 0) && (
          <div>
            <div className="font-medium text-gray-700">Notifications:</div>
            <div className="ml-4 flex gap-2 flex-wrap">
              <CountBadge
                label="sent"
                count={result.notifications.sent}
                variant="success"
              />
              {result.notifications.skipped > 0 && (
                <span className="text-gray-500 text-xs">
                  {result.notifications.skipped} skipped (already sent)
                </span>
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
        {operationType === "sync" ? "Synced" : "Realized"} {count} group
        {count !== 1 ? "s" : ""}
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
                <span className="text-gray-400">
                  {expandedGroups.has(group_id) ? "▼" : "▶"}
                </span>
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
