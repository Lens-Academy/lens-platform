import { useState, useEffect, useCallback } from "react";
import { navigate } from "vike/client/router";
import { useAuth } from "../../hooks/useAuth";
import { API_URL } from "../../config";
import { fetchWithRefresh } from "../../api/fetchWithRefresh";
import { getBrowserTimezone } from "../../types/enroll";
import Layout from "@/components/Layout";
import GroupSelectionStep from "../enroll/GroupSelectionStep";
import MeetingCard from "./MeetingCard";
import type { Meeting } from "./MeetingCard";
import CurrentGroupBanner from "./CurrentGroupBanner";
import ChangeGroupSection from "./ChangeGroupSection";
import { formatDateTime } from "./utils";
import {
  getAlternatives,
  createGuestVisit,
  cancelGuestVisit,
  getGuestVisits,
  type AlternativeMeeting,
  type GuestVisit,
} from "../../api/guestVisits";

interface UserGroupInfo {
  is_enrolled: boolean;
  cohort_id?: number;
  cohort_name?: string;
  cohort_start_date?: string;
  cohort_end_date?: string;
  current_group?: {
    group_id: number;
    group_name: string;
    recurring_meeting_time_utc: string;
  } | null;
}

export default function MeetingsPage() {
  const { isAuthenticated, isLoading: authLoading, login } = useAuth();

  // Group info state
  const [userInfo, setUserInfo] = useState<UserGroupInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Meetings state (only used when user has a group)
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [guestVisits, setGuestVisits] = useState<GuestVisit[]>([]);

  // Group selection state (only used when user has no group)
  const [timezone, setTimezone] = useState(getBrowserTimezone());
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [groupSuccess, setGroupSuccess] = useState(false);

  // Meeting reschedule state
  const [selectedMeetingId, setSelectedMeetingId] = useState<number | null>(
    null,
  );
  const [alternatives, setAlternatives] = useState<AlternativeMeeting[]>([]);
  const [alternativesLoading, setAlternativesLoading] = useState(false);
  const [alternativesError, setAlternativesError] = useState<string | null>(
    null,
  );
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadGroupInfo = useCallback(async () => {
    try {
      const response = await fetchWithRefresh(
        `${API_URL}/api/users/me/group-info`,
        { credentials: "include" },
      );
      if (response.ok) {
        const data = await response.json();
        setUserInfo(data);
        if (data.current_group?.group_id) {
          setSelectedGroupId(data.current_group.group_id);
        }
        return data as UserGroupInfo;
      }
    } catch {
      setError("Failed to load your group information");
    }
    return null;
  }, []);

  const loadMeetingsData = useCallback(async () => {
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
      setError("Failed to load your meetings.");
    }
  }, []);

  const loadAllData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const info = await loadGroupInfo();
    if (info?.current_group) {
      await loadMeetingsData();
    }
    setIsLoading(false);
  }, [loadGroupInfo, loadMeetingsData]);

  useEffect(() => {
    if (authLoading) return;
    if (isAuthenticated) {
      loadAllData();
    } else {
      setIsLoading(false);
    }
  }, [isAuthenticated, authLoading, loadAllData]);

  // Redirect to the correct URL based on group state
  useEffect(() => {
    if (isLoading || !userInfo?.is_enrolled) return;
    const path = window.location.pathname;
    if (userInfo.current_group && path === "/group") {
      navigate("/meetings", { overwriteLastHistoryEntry: true });
    } else if (!userInfo.current_group && path === "/meetings") {
      navigate("/group", { overwriteLastHistoryEntry: true });
    }
  }, [isLoading, userInfo]);

  // --- Meeting reschedule handlers ---

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
      await loadMeetingsData();
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
      await loadMeetingsData();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to cancel guest visit",
      );
    } finally {
      setActionLoading(null);
    }
  };

  // --- Group selection handler (no-group state) ---

  const handleJoinGroup = async () => {
    if (!selectedGroupId) return;

    setIsSubmitting(true);
    setGroupError(null);

    try {
      const response = await fetchWithRefresh(`${API_URL}/api/groups/join`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: selectedGroupId }),
      });

      if (!response.ok) {
        const data = await response.json();
        if (response.status === 400) {
          await loadGroupInfo();
        }
        throw new Error(data.detail || "Failed to join group");
      }

      setGroupSuccess(true);
      await loadAllData();
    } catch (err) {
      setGroupError(
        err instanceof Error ? err.message : "Failed to join group",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- Render ---

  if (authLoading || isLoading) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-lens-orange-500"></div>
        </div>
      </Layout>
    );
  }

  if (!isAuthenticated) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-4">Sign In Required</h1>
            <p className="text-[var(--brand-text-muted)] mb-4">
              Please sign in to manage your meetings.
            </p>
            <button
              onClick={login}
              className="text-lens-orange-600 hover:underline"
            >
              Sign in
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  if (!userInfo?.is_enrolled) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-4">Not Enrolled</h1>
            <p className="text-[var(--brand-text-muted)] mb-4">
              You need to enroll in a course first.
            </p>
            <a href="/enroll" className="text-lens-orange-600 hover:underline">
              Enroll now
            </a>
          </div>
        </div>
      </Layout>
    );
  }

  // User enrolled but no group — show group selection prominently
  if (!userInfo.current_group) {
    return (
      <Layout>
        <div className="min-h-screen py-12 px-4">
          <div className="max-w-md mx-auto">
            <h1 className="text-2xl font-bold text-[var(--brand-text)] mb-2">
              Select Your Group
            </h1>
            <p className="text-[var(--brand-text-muted)] mb-6">
              {userInfo.cohort_start_date && userInfo.cohort_end_date ? (
                <>
                  For the course running{" "}
                  {new Date(userInfo.cohort_start_date).toLocaleDateString(
                    "en-US",
                    { month: "short", day: "numeric" },
                  )}
                  {" - "}
                  {new Date(userInfo.cohort_end_date).toLocaleDateString(
                    "en-US",
                    { month: "short", day: "numeric" },
                  )}
                </>
              ) : (
                <>{userInfo.cohort_name}</>
              )}
            </p>

            {groupError && (
              <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg">
                {groupError}
              </div>
            )}

            <GroupSelectionStep
              cohortId={userInfo.cohort_id!}
              timezone={timezone}
              onTimezoneChange={setTimezone}
              selectedGroupId={selectedGroupId}
              onGroupSelect={(groupId) => {
                setSelectedGroupId(groupId);
                setGroupSuccess(false);
              }}
              onBack={() => window.history.back()}
              onSubmit={handleJoinGroup}
              onSwitchToAvailability={() => {
                window.location.href = "/enroll";
              }}
              submitButtonLabel="Join Group"
              hideHeader
              isSubmitting={isSubmitting}
              successMessage={
                groupSuccess
                  ? "You've joined your group. Calendar invites and Discord access will be set up in the next few minutes."
                  : undefined
              }
            />
          </div>
        </div>
      </Layout>
    );
  }

  // User has a group — show full meetings view
  const activeVisits = guestVisits.filter((v) => !v.is_past);
  const pastVisits = guestVisits.filter((v) => v.is_past);
  const rescheduledMeetingNumbers = new Set(
    guestVisits.map((v) => v.meeting_number),
  );
  const pastMeetings = meetings.filter((m) => m.is_past).reverse();
  const upcomingMeetings = meetings.filter((m) => !m.is_past);

  return (
    <Layout>
      <div className="min-h-screen py-12 px-4">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-2xl font-bold text-[var(--brand-text)] mb-2">
            Your Meetings
          </h1>
          <p className="text-[var(--brand-text-muted)] mb-6">
            View your schedule, reschedule meetings, or change your group.
          </p>

          <CurrentGroupBanner
            groupName={userInfo.current_group.group_name}
            meetingTime={userInfo.current_group.recurring_meeting_time_utc}
            cohortName={userInfo.cohort_name}
          />

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
              <h2 className="text-lg font-semibold text-[var(--brand-text)] mb-3">
                Your Guest Visits
              </h2>
              <div className="space-y-3">
                {activeVisits.map((visit) => (
                  <div
                    key={visit.attendance_id}
                    className="border border-lens-orange-300 bg-lens-orange-50 rounded-lg p-4 flex items-center justify-between"
                  >
                    <div>
                      <p className="font-medium text-[var(--brand-text)]">
                        Meeting {visit.meeting_number} with {visit.group_name}
                      </p>
                      <p className="text-sm text-[var(--brand-text-muted)]">
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
            <h2 className="text-lg font-semibold text-[var(--brand-text)] mb-3">
              Upcoming Meetings
            </h2>
            {upcomingMeetings.length === 0 ? (
              <p className="text-[var(--brand-text-muted)]">
                No upcoming meetings found.
              </p>
            ) : (
              <div className="space-y-3">
                {upcomingMeetings.map((meeting) => (
                  <MeetingCard
                    key={meeting.meeting_id}
                    meeting={meeting}
                    hasVisit={rescheduledMeetingNumbers.has(
                      meeting.meeting_number,
                    )}
                    isSelected={selectedMeetingId === meeting.meeting_id}
                    onToggle={() =>
                      selectedMeetingId === meeting.meeting_id
                        ? setSelectedMeetingId(null)
                        : handleCantAttend(meeting.meeting_id)
                    }
                    alternatives={alternatives}
                    alternativesLoading={alternativesLoading}
                    alternativesError={alternativesError}
                    actionLoading={actionLoading}
                    onJoinAlternative={handleJoinAlternative}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Recent Meetings */}
          {pastMeetings.length > 0 && (
            <section className="mb-8">
              <h2 className="text-lg font-semibold text-[var(--brand-text)] mb-3">
                Recent Meetings
              </h2>
              <div className="space-y-3">
                {pastMeetings.map((meeting) => (
                  <MeetingCard
                    key={meeting.meeting_id}
                    meeting={meeting}
                    hasVisit={rescheduledMeetingNumbers.has(
                      meeting.meeting_number,
                    )}
                    isSelected={selectedMeetingId === meeting.meeting_id}
                    onToggle={() =>
                      selectedMeetingId === meeting.meeting_id
                        ? setSelectedMeetingId(null)
                        : handleCantAttend(meeting.meeting_id)
                    }
                    alternatives={alternatives}
                    alternativesLoading={alternativesLoading}
                    alternativesError={alternativesError}
                    actionLoading={actionLoading}
                    onJoinAlternative={handleJoinAlternative}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Past Guest Visits */}
          {pastVisits.length > 0 && (
            <section className="mb-8">
              <h2 className="text-lg font-semibold text-[var(--brand-text)] mb-3">
                Past Guest Visits
              </h2>
              <div className="space-y-2">
                {pastVisits.map((visit) => (
                  <div
                    key={visit.attendance_id}
                    className="border border-[var(--brand-border)] rounded-lg p-4 opacity-60"
                  >
                    <p className="font-medium text-[var(--brand-text)]">
                      Meeting {visit.meeting_number} with {visit.group_name}
                    </p>
                    <p className="text-sm text-[var(--brand-text-muted)]">
                      {formatDateTime(visit.scheduled_at)}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Change Group */}
          <ChangeGroupSection
            cohortId={userInfo.cohort_id!}
            currentGroupId={userInfo.current_group.group_id}
            onGroupChanged={loadAllData}
          />
        </div>
      </div>
    </Layout>
  );
}
