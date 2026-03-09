import type { AlternativeMeeting } from "../../api/guestVisits";
import { formatDateTime } from "./utils";

interface AlternativesPanelProps {
  alternatives: AlternativeMeeting[];
  isLoading: boolean;
  error: string | null;
  actionLoading: number | null;
  onJoin: (hostMeetingId: number) => void;
}

export default function AlternativesPanel({
  alternatives,
  isLoading,
  error,
  actionLoading,
  onJoin,
}: AlternativesPanelProps) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
        Finding alternative meetings...
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  if (alternatives.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No alternative meetings available for this week.
      </p>
    );
  }

  return (
    <div>
      <p className="text-sm text-gray-600 mb-3">
        Choose a meeting to attend as a guest:
      </p>
      <div className="space-y-2">
        {alternatives.map((alt) => (
          <div
            key={alt.meeting_id}
            className="flex items-center justify-between bg-white border border-gray-200 rounded-md p-3"
          >
            <div>
              <p className="text-sm font-medium text-gray-900">
                {alt.group_name} &middot; Meeting {alt.meeting_number}
              </p>
              <p className="text-xs text-gray-500">
                {formatDateTime(alt.scheduled_at)}
                {alt.facilitator_name &&
                  ` \u00b7 Led by ${alt.facilitator_name}`}
              </p>
            </div>
            <button
              onClick={() => onJoin(alt.meeting_id)}
              disabled={actionLoading === alt.meeting_id}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50"
            >
              {actionLoading === alt.meeting_id ? "Joining..." : "Join this meeting"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
