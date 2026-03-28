/**
 * API client for referral link endpoints.
 */

import { API_URL } from "../config";
import { fetchWithRefresh } from "./fetchWithRefresh";

export interface ReferralLink {
  link_id: number;
  name: string;
  slug: string;
  is_default: boolean;
  clicks: number;
  signups: number;
  enrolled: number;
  completed: number;
}

export async function getMyLinks(): Promise<{ links: ReferralLink[] }> {
  const res = await fetchWithRefresh(`${API_URL}/api/referrals/links`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch referral links");
  return res.json();
}

export async function createLink(
  name: string,
  slug?: string,
): Promise<ReferralLink> {
  const res = await fetchWithRefresh(`${API_URL}/api/referrals/links`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, slug: slug || undefined }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to create link");
  }
  return res.json();
}

export async function updateLink(
  linkId: number,
  data: { name?: string; slug?: string },
): Promise<ReferralLink> {
  const res = await fetchWithRefresh(
    `${API_URL}/api/referrals/links/${linkId}`,
    {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
  );
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to update link");
  }
  return res.json();
}

export async function deleteLink(linkId: number): Promise<void> {
  const res = await fetchWithRefresh(
    `${API_URL}/api/referrals/links/${linkId}`,
    {
      method: "DELETE",
      credentials: "include",
    },
  );
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to delete link");
  }
}
