import type { AlternativeMeeting } from "../../api/guestVisits";
import AlternativesPanel from "./AlternativesPanel";
import { formatDateTime } from "./utils";

interface Meeting {
  meeting_id: number;
  meeting_number: number;
  scheduled_at: string;
  group_name: string;
  is_past: boolean;
  attended: boolean;
}

interface MeetingCardProps {
  meeting: Meeting;
  hasVisit: boolean;
  isSelected: boolean;
  onToggle: () => void;
  alternatives: AlternativeMeeting[];
  alternativesLoading: boolean;
  alternativesError: string | null;
  actionLoading: number | null;
  onJoinAlternative: (hostMeetingId: number) => void;
}

export default function MeetingCard({
  meeting,
  hasVisit,
  isSelected,
  onToggle,
  alternatives,
  alternativesLoading,
  alternativesError,
  actionLoading,
  onJoinAlternative,
}: MeetingCardProps) {
  const showRescheduleButton = meeting.is_past
    ? !meeting.attended && !hasVisit
    : !hasVisit;
  const buttonLabel = meeting.is_past
    ? isSelected
      ? "Never mind"
      : "Reschedule"
    : isSelected
      ? "Never mind"
      : "Can't attend";

  return (
    <div
      className={`border rounded-lg p-4 transition-colors ${
        isSelected ? "border-blue-400 bg-blue-50" : "border-gray-200"
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-gray-900">
            Meeting {meeting.meeting_number}
            {meeting.is_past &&
              (meeting.attended ? (
                <span className="ml-2 text-xs font-normal text-green-600">
                  Attended
                </span>
              ) : (
                <span className="ml-2 text-xs font-normal text-amber-600">
                  Missed
                </span>
              ))}
          </p>
          <p className="text-sm text-gray-600">
            {formatDateTime(meeting.scheduled_at)} &middot; {meeting.group_name}
          </p>
        </div>
        {hasVisit ? (
          <span className="text-sm text-blue-600 font-medium">Rescheduled</span>
        ) : showRescheduleButton ? (
          <button
            onClick={onToggle}
            className="px-3 py-1.5 text-sm border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-md transition-colors"
          >
            {buttonLabel}
          </button>
        ) : null}
      </div>

      {isSelected && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <AlternativesPanel
            alternatives={alternatives}
            isLoading={alternativesLoading}
            error={alternativesError}
            actionLoading={actionLoading}
            onJoin={onJoinAlternative}
          />
        </div>
      )}
    </div>
  );
}

export type { Meeting };
