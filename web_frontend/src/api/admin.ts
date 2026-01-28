/**
 * API client for admin panel endpoints.
 *
 * All endpoints require admin authentication.
 */

import { API_URL } from "../config";

// Interfaces for API responses

export interface UserSearchResult {
  user_id: number;
  discord_id: string;
  nickname: string | null;
  discord_username: string;
}

export interface UserDetails {
  user_id: number;
  discord_id: string;
  nickname: string | null;
  discord_username: string;
  email: string | null;
  group_id: number | null;
  group_name: string | null;
  cohort_id: number | null;
  cohort_name: string | null;
  group_status: string | null;
}

export interface GroupSummary {
  group_id: number;
  group_name: string;
  status: string;
  member_count: number;
  meeting_time: string | null;
}

export interface SyncResult {
  group_id?: number;
  synced?: number;
  realized?: number;
  results?: Array<{ group_id: number; result: Record<string, unknown> }>;
  [key: string]: unknown;
}

// API functions

/**
 * Search users by nickname or discord_username.
 */
export async function searchUsers(
  query: string,
  limit: number = 20,
): Promise<UserSearchResult[]> {
  const res = await fetch(`${API_URL}/api/admin/users/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ query, limit }),
  });

  if (!res.ok) {
    if (res.status === 403) {
      throw new Error("Access denied. Admin privileges required.");
    }
    throw new Error("Failed to search users");
  }

  const data = await res.json();
  return data.users;
}

/**
 * Get detailed user information including group membership.
 */
export async function getUserDetails(
  userId: number,
): Promise<UserDetails | null> {
  const res = await fetch(`${API_URL}/api/admin/users/${userId}`, {
    credentials: "include",
  });

  if (!res.ok) {
    if (res.status === 404) {
      return null;
    }
    if (res.status === 403) {
      throw new Error("Access denied. Admin privileges required.");
    }
    throw new Error("Failed to fetch user details");
  }

  return res.json();
}

/**
 * Sync a group's Discord permissions, calendar, and reminders.
 * Does NOT create infrastructure - use realizeGroup for that.
 */
export async function syncGroup(groupId: number): Promise<SyncResult> {
  const res = await fetch(`${API_URL}/api/admin/groups/${groupId}/sync`, {
    method: "POST",
    credentials: "include",
  });

  if (!res.ok) {
    if (res.status === 403) {
      throw new Error("Access denied. Admin privileges required.");
    }
    throw new Error("Failed to sync group");
  }

  return res.json();
}

/**
 * Realize a group - create Discord infrastructure and sync.
 * Creates category, channels, calendar events, then syncs permissions.
 */
export async function realizeGroup(groupId: number): Promise<SyncResult> {
  const res = await fetch(`${API_URL}/api/admin/groups/${groupId}/realize`, {
    method: "POST",
    credentials: "include",
  });

  if (!res.ok) {
    if (res.status === 403) {
      throw new Error("Access denied. Admin privileges required.");
    }
    throw new Error("Failed to realize group");
  }

  return res.json();
}

/**
 * Get all groups in a cohort.
 */
export async function getCohortGroups(
  cohortId: number,
): Promise<GroupSummary[]> {
  const res = await fetch(`${API_URL}/api/admin/cohorts/${cohortId}/groups`, {
    credentials: "include",
  });

  if (!res.ok) {
    if (res.status === 403) {
      throw new Error("Access denied. Admin privileges required.");
    }
    throw new Error("Failed to fetch cohort groups");
  }

  const data = await res.json();
  return data.groups;
}

/**
 * Sync all groups in a cohort.
 */
export async function syncCohort(cohortId: number): Promise<SyncResult> {
  const res = await fetch(`${API_URL}/api/admin/cohorts/${cohortId}/sync`, {
    method: "POST",
    credentials: "include",
  });

  if (!res.ok) {
    if (res.status === 403) {
      throw new Error("Access denied. Admin privileges required.");
    }
    throw new Error("Failed to sync cohort");
  }

  return res.json();
}

/**
 * Realize all preview groups in a cohort.
 */
export async function realizeCohort(cohortId: number): Promise<SyncResult> {
  const res = await fetch(`${API_URL}/api/admin/cohorts/${cohortId}/realize`, {
    method: "POST",
    credentials: "include",
  });

  if (!res.ok) {
    if (res.status === 403) {
      throw new Error("Access denied. Admin privileges required.");
    }
    throw new Error("Failed to realize cohort");
  }

  return res.json();
}

/**
 * Add a user to a group.
 */
export async function addMemberToGroup(
  groupId: number,
  userId: number,
): Promise<{ status: string; group_user_id: number }> {
  const res = await fetch(
    `${API_URL}/api/admin/groups/${groupId}/members/add`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ user_id: userId }),
    },
  );

  if (!res.ok) {
    if (res.status === 403) {
      throw new Error("Access denied. Admin privileges required.");
    }
    throw new Error("Failed to add member to group");
  }

  return res.json();
}

/**
 * Remove a user from a group.
 */
export async function removeMemberFromGroup(
  groupId: number,
  userId: number,
): Promise<{ status: string }> {
  const res = await fetch(
    `${API_URL}/api/admin/groups/${groupId}/members/remove`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ user_id: userId }),
    },
  );

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error("User not in group");
    }
    if (res.status === 403) {
      throw new Error("Access denied. Admin privileges required.");
    }
    throw new Error("Failed to remove member from group");
  }

  return res.json();
}

/**
 * Create a new group in a cohort.
 * Group starts in 'preview' status. Use realizeGroup to create Discord infrastructure.
 */
export async function createGroup(
  cohortId: number,
  groupName: string,
  meetingTime: string,
): Promise<{ group_id: number; group_name: string; status: string }> {
  const res = await fetch(`${API_URL}/api/admin/groups/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      cohort_id: cohortId,
      group_name: groupName,
      meeting_time: meetingTime,
    }),
  });

  if (!res.ok) {
    if (res.status === 403) {
      throw new Error("Access denied. Admin privileges required.");
    }
    throw new Error("Failed to create group");
  }

  return res.json();
}
