import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../hooks/useAuth";
import { API_URL } from "../../config";
import { fetchWithRefresh } from "../../api/fetchWithRefresh";
import Layout from "@/components/Layout";
import {
  getAlternatives,
  createGuestVisit,
  cancelGuestVisit,
  getGuestVisits,
  type AlternativeMeeting,
  type GuestVisit,
} from "../../api/guestVisits";

interface Meeting {
  meeting_id: number;
  meeting_number: number;
  scheduled_at: string;
  group_name: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDateTime(iso: string): string {
  return `${formatDate(iso)} at ${formatTime(iso)}`;
}

export default function ReschedulePage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [guestVisits, setGuestVisits] = useState<GuestVisit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Which meeting the user clicked "Can't attend" on
  const [selectedMeetingId, setSelectedMeetingId] = useState<number | null>(
    null,
  );
  const [alternatives, setAlternatives] = useState<AlternativeMeeting[]>([]);
  const [alternativesLoading, setAlternativesLoading] = useState(false);
  const [alternativesError, setAlternativesError] = useState<string | null>(
    null,
  );

  // Action in progress (creating or cancelling)
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [meetingsRes, visitsData] = await Promise.all([
        fetchWithRefresh(`${API_URL}/api/users/me/meetings`, {
          credentials: "include",
        }),
        getGuestVisits(),
      ]);

      if (!meetingsRes.ok) throw new Error("Failed to load meetings");
      const meetingsData = await meetingsRes.json();
      setMeetings(meetingsData.meetings);
      setGuestVisits(visitsData);
    } catch {
      setError("Failed to load your meetings. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (isAuthenticated) {
      loadData();
    } else {
      setIsLoading(false);
    }
  }, [isAuthenticated, authLoading, loadData]);

  const handleCantAttend = async (meetingId: number) => {
    setSelectedMeetingId(meetingId);
    setAlternatives([]);
    setAlternativesError(null);
    setAlternativesLoading(true);
    setSuccessMessage(null);

    try {
      const alts = await getAlternatives(meetingId);
      setAlternatives(alts);
    } catch {
      setAlternativesError("Failed to load alternative meetings.");
    } finally {
      setAlternativesLoading(false);
    }
  };

  const handleJoinAlternative = async (hostMeetingId: number) => {
    if (!selectedMeetingId) return;

    setActionLoading(hostMeetingId);
    setError(null);
    setSuccessMessage(null);

    try {
      await createGuestVisit(selectedMeetingId, hostMeetingId);
      setSuccessMessage(
        "Guest visit created! You'll get Discord access to the host group before the meeting.",
      );
      setSelectedMeetingId(null);
      setAlternatives([]);
      await loadData();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create guest visit",
      );
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancelVisit = async (hostMeetingId: number) => {
    setActionLoading(hostMeetingId);
    setError(null);
    setSuccessMessage(null);

    try {
      await cancelGuestVisit(hostMeetingId);
      setSuccessMessage("Guest visit cancelled.");
      await loadData();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to cancel guest visit",
      );
    } finally {
      setActionLoading(null);
    }
  };

  // Loading state
  if (authLoading || isLoading) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      </Layout>
    );
  }

  // Not authenticated
  if (!isAuthenticated) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-4">Sign In Required</h1>
            <p className="text-gray-600 mb-4">
              Please sign in to manage your meeting schedule.
            </p>
            <a href="/enroll" className="text-blue-600 hover:underline">
              Go to enrollment
            </a>
          </div>
        </div>
      </Layout>
    );
  }

  const activeVisits = guestVisits.filter((v) => !v.is_past);
  const pastVisits = guestVisits.filter((v) => v.is_past);

  // Set of meeting IDs the user already has a guest visit for
  const meetingsWithVisits = new Set(
    activeVisits.map((v) => v.meeting_id),
  );

  return (
    <Layout>
      <div className="min-h-screen py-12 px-4">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            Reschedule a Meeting
          </h1>
          <p className="text-gray-600 mb-8">
            Can't make one of your group meetings? Join another group's meeting
            that week as a guest.
          </p>

          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg">
              {error}
            </div>
          )}

          {successMessage && (
            <div className="mb-4 p-3 bg-green-50 text-green-700 rounded-lg">
              {successMessage}
            </div>
          )}

          {/* Active Guest Visits */}
          {activeVisits.length > 0 && (
            <section className="mb-8">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">
                Your Guest Visits
              </h2>
              <div className="space-y-3">
                {activeVisits.map((visit) => (
                  <div
                    key={visit.attendance_id}
                    className="border border-blue-200 bg-blue-50 rounded-lg p-4 flex items-center justify-between"
                  >
                    <div>
                      <p className="font-medium text-gray-900">
                        Meeting {visit.meeting_number} with {visit.group_name}
                      </p>
                      <p className="text-sm text-gray-600">
                        {formatDateTime(visit.scheduled_at)}
                      </p>
                    </div>
                    {visit.can_cancel && (
                      <button
                        onClick={() => handleCancelVisit(visit.meeting_id)}
                        disabled={actionLoading === visit.meeting_id}
                        className="px-3 py-1.5 text-sm text-red-600 hover:text-red-800 hover:bg-red-50 rounded-md transition-colors disabled:opacity-50"
                      >
                        {actionLoading === visit.meeting_id
                          ? "Cancelling..."
                          : "Cancel"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Upcoming Meetings */}
          <section className="mb-8">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">
              Upcoming Meetings
            </h2>
            {meetings.length === 0 ? (
              <p className="text-gray-500">No upcoming meetings found.</p>
            ) : (
              <div className="space-y-3">
                {meetings.map((meeting) => {
                  const hasVisit = meetingsWithVisits.has(meeting.meeting_id);
                  const isSelected =
                    selectedMeetingId === meeting.meeting_id;
                  return (
                    <div
                      key={meeting.meeting_id}
                      className={`border rounded-lg p-4 transition-colors ${
                        isSelected
                          ? "border-blue-400 bg-blue-50"
                          : "border-gray-200"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-gray-900">
                            Meeting {meeting.meeting_number}
                          </p>
                          <p className="text-sm text-gray-600">
                            {formatDateTime(meeting.scheduled_at)} &middot;{" "}
                            {meeting.group_name}
                          </p>
                        </div>
                        {hasVisit ? (
                          <span className="text-sm text-blue-600 font-medium">
                            Rescheduled
                          </span>
                        ) : (
                          <button
                            onClick={() =>
                              isSelected
                                ? setSelectedMeetingId(null)
                                : handleCantAttend(meeting.meeting_id)
                            }
                            className="px-3 py-1.5 text-sm border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-md transition-colors"
                          >
                            {isSelected ? "Never mind" : "Can't attend"}
                          </button>
                        )}
                      </div>

                      {/* Alternatives Panel */}
                      {isSelected && (
                        <div className="mt-4 pt-4 border-t border-gray-200">
                          {alternativesLoading ? (
                            <div className="flex items-center gap-2 text-sm text-gray-500">
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                              Finding alternative meetings...
                            </div>
                          ) : alternativesError ? (
                            <p className="text-sm text-red-600">
                              {alternativesError}
                            </p>
                          ) : alternatives.length === 0 ? (
                            <p className="text-sm text-gray-500">
                              No alternative meetings available for this week.
                            </p>
                          ) : (
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
                                        {alt.group_name} &middot; Meeting{" "}
                                        {alt.meeting_number}
                                      </p>
                                      <p className="text-xs text-gray-500">
                                        {formatDateTime(alt.scheduled_at)}
                                        {alt.facilitator_name &&
                                          ` \u00b7 Led by ${alt.facilitator_name}`}
                                      </p>
                                    </div>
                                    <button
                                      onClick={() =>
                                        handleJoinAlternative(alt.meeting_id)
                                      }
                                      disabled={
                                        actionLoading === alt.meeting_id
                                      }
                                      className="px-3 py-1.5 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50"
                                    >
                                      {actionLoading === alt.meeting_id
                                        ? "Joining..."
                                        : "Join this meeting"}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Past Guest Visits */}
          {pastVisits.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">
                Past Guest Visits
              </h2>
              <div className="space-y-2">
                {pastVisits.map((visit) => (
                  <div
                    key={visit.attendance_id}
                    className="border border-gray-200 rounded-lg p-4 opacity-60"
                  >
                    <p className="font-medium text-gray-900">
                      Meeting {visit.meeting_number} with {visit.group_name}
                    </p>
                    <p className="text-sm text-gray-500">
                      {formatDateTime(visit.scheduled_at)}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </Layout>
  );
}
