/**
 * API client for guest visit endpoints.
 *
 * Guest visits allow participants to attend a different group's meeting
 * when they can't make their own.
 */

import { API_URL } from "../config";
import { fetchWithRefresh } from "./fetchWithRefresh";

export interface AlternativeMeeting {
  meeting_id: number;
  group_id: number;
  group_name: string;
  scheduled_at: string;
  meeting_number: number;
  facilitator_name: string | null;
}

export interface GuestVisit {
  attendance_id: number;
  meeting_id: number;
  meeting_number: number;
  scheduled_at: string;
  group_id: number;
  group_name: string;
  is_past: boolean;
  can_cancel: boolean;
}

/**
 * Get alternative meetings the user could attend as a guest.
 */
export async function getAlternatives(
  meetingId: number,
): Promise<AlternativeMeeting[]> {
  const res = await fetchWithRefresh(
    `${API_URL}/api/guest-visits/options?meeting_id=${meetingId}`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error("Failed to load alternatives");
  const data = await res.json();
  return data.alternatives;
}

/**
 * Create a guest visit: attend a different group's meeting.
 */
export async function createGuestVisit(
  homeMeetingId: number,
  hostMeetingId: number,
): Promise<{ success: boolean }> {
  const res = await fetchWithRefresh(`${API_URL}/api/guest-visits`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      home_meeting_id: homeMeetingId,
      host_meeting_id: hostMeetingId,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? "Failed to create guest visit");
  }
  return res.json();
}

/**
 * Cancel a guest visit.
 */
export async function cancelGuestVisit(hostMeetingId: number): Promise<void> {
  const res = await fetchWithRefresh(
    `${API_URL}/api/guest-visits/${hostMeetingId}`,
    { method: "DELETE", credentials: "include" },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? "Failed to cancel guest visit");
  }
}

/**
 * List the current user's guest visits.
 */
export async function getGuestVisits(): Promise<GuestVisit[]> {
  const res = await fetchWithRefresh(`${API_URL}/api/guest-visits`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to load guest visits");
  const data = await res.json();
  return data.visits;
}
