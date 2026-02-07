import { useState, useEffect } from "react";
import { useAuth } from "../../hooks/useAuth";
import { API_URL } from "../../config";
import { fetchWithRefresh } from "../../api/fetchWithRefresh";
import Layout from "@/components/Layout";
import GroupSelectionStep from "../../components/enroll/GroupSelectionStep";
import { getBrowserTimezone } from "../../types/enroll";

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

export default function GroupPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [userInfo, setUserInfo] = useState<UserGroupInfo | null>(null);
  const [timezone, setTimezone] = useState(getBrowserTimezone());
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (authLoading) return; // Wait for auth to complete
    if (isAuthenticated) {
      fetchUserGroupInfo();
    } else {
      setIsLoading(false); // Not authenticated, stop loading
    }
  }, [isAuthenticated, authLoading]);

  const fetchUserGroupInfo = async () => {
    setIsLoading(true);
    try {
      const response = await fetchWithRefresh(
        `${API_URL}/api/users/me/group-info`,
        {
          credentials: "include",
        },
      );
      if (response.ok) {
        const data = await response.json();
        setUserInfo(data);
        if (data.current_group?.group_id) {
          setSelectedGroupId(data.current_group.group_id);
        }
      }
    } catch {
      setError("Failed to load your group information");
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinGroup = async () => {
    if (!selectedGroupId) return;

    setIsSubmitting(true);
    setError(null);

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
          // Group no longer available - refresh list
          await fetchUserGroupInfo();
        }
        throw new Error(data.detail || "Failed to join group");
      }

      setSuccess(true);
      await fetchUserGroupInfo();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join group");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (authLoading || isLoading) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
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
            <p className="text-gray-600 mb-4">
              Please sign in to manage your group.
            </p>
            <a href="/enroll" className="text-blue-600 hover:underline">
              Go to enrollment
            </a>
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
            <p className="text-gray-600 mb-4">
              You need to enroll in a cohort first.
            </p>
            <a href="/enroll" className="text-blue-600 hover:underline">
              Enroll now
            </a>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="min-h-screen py-12 px-4">
        <div className="max-w-md mx-auto">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            Select Your Group
          </h1>
          <p className="text-gray-600 mb-6">
            {userInfo.cohort_start_date && userInfo.cohort_end_date ? (
              <>
                For the cohort running{" "}
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
              <>Cohort: {userInfo.cohort_name}</>
            )}
          </p>

          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg">
              {error}
            </div>
          )}

          <GroupSelectionStep
            cohortId={userInfo.cohort_id!}
            timezone={timezone}
            onTimezoneChange={setTimezone}
            selectedGroupId={selectedGroupId}
            onGroupSelect={(groupId) => {
              setSelectedGroupId(groupId);
              setSuccess(false);
            }}
            onBack={() => window.history.back()}
            onSubmit={handleJoinGroup}
            onSwitchToAvailability={() => {
              window.location.href = "/enroll";
            }}
            submitButtonLabel={
              userInfo.current_group ? "Change Group" : "Join Group"
            }
            hideHeader
            isSubmitting={isSubmitting}
            successMessage={
              success
                ? "You've joined your new group. Calendar invites and Discord access will be set up in the next few minutes."
                : undefined
            }
          />
        </div>
      </div>
    </Layout>
  );
}
