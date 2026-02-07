import { useState, useEffect } from "react";
import { useAuth } from "../hooks/useAuth";
import { API_URL } from "../config";
import { fetchWithRefresh } from "../api/fetchWithRefresh";
import { Skeleton, SkeletonText } from "../components/Skeleton";
import type {
  FacilitatorGroup,
  GroupMember,
  UserProgress,
  ChatSession,
} from "../types/facilitator";

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes} min`;
  }
  return `${minutes} min`;
}

function formatTimeAgo(isoString: string | null): string {
  if (!isoString) return "Never";
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) return `${diffMins} minutes ago`;
  if (diffHours < 24) return `${diffHours} hours ago`;
  return `${diffDays} days ago`;
}

export default function Facilitator() {
  const { isAuthenticated, isLoading: authLoading, user, login } = useAuth();

  const [groups, setGroups] = useState<FacilitatorGroup[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [userProgress, setUserProgress] = useState<UserProgress | null>(null);
  const [userChats, setUserChats] = useState<ChatSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load groups on mount
  useEffect(() => {
    if (!user) return;

    const fetchGroups = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetchWithRefresh(
          `${API_URL}/api/facilitator/groups`,
          {
            credentials: "include",
          },
        );
        if (!res.ok) {
          if (res.status === 403) {
            setError("Access denied. You must be an admin or facilitator.");
            return;
          }
          throw new Error("Failed to fetch groups");
        }
        const data = await res.json();
        setGroups(data.groups);
        setIsAdmin(data.is_admin);
        if (data.groups.length > 0) {
          setSelectedGroupId(data.groups[0].group_id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    };

    fetchGroups();
  }, [user]);

  // Load members when group changes
  useEffect(() => {
    if (!selectedGroupId) return;

    const fetchMembers = async () => {
      setIsLoading(true);
      try {
        const res = await fetchWithRefresh(
          `${API_URL}/api/facilitator/groups/${selectedGroupId}/members`,
          { credentials: "include" },
        );
        if (!res.ok) throw new Error("Failed to fetch members");
        const data = await res.json();
        setMembers(data.members);
        setSelectedUserId(null);
        setUserProgress(null);
        setUserChats([]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    };

    fetchMembers();
  }, [selectedGroupId]);

  // Load user details when selected
  useEffect(() => {
    if (!selectedGroupId || !selectedUserId) return;

    const fetchUserDetails = async () => {
      setIsLoading(true);
      try {
        const [progressRes, chatsRes] = await Promise.all([
          fetchWithRefresh(
            `${API_URL}/api/facilitator/groups/${selectedGroupId}/users/${selectedUserId}/progress`,
            { credentials: "include" },
          ),
          fetchWithRefresh(
            `${API_URL}/api/facilitator/groups/${selectedGroupId}/users/${selectedUserId}/chats`,
            { credentials: "include" },
          ),
        ]);

        if (!progressRes.ok || !chatsRes.ok) {
          throw new Error("Failed to fetch user details");
        }

        const progressData = await progressRes.json();
        const chatsData = await chatsRes.json();

        setUserProgress(progressData);
        setUserChats(chatsData.chats);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    };

    fetchUserDetails();
  }, [selectedGroupId, selectedUserId]);

  if (authLoading) {
    return (
      <div className="py-8 max-w-6xl mx-auto px-4">
        <div className="space-y-4">
          <Skeleton variant="rectangular" className="h-8 w-48" />
          <SkeletonText lines={3} />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="py-8 max-w-6xl mx-auto px-4">
        <h1 className="text-2xl font-bold mb-4">Facilitator Panel</h1>
        <p className="mb-4">Please sign in to access the facilitator panel.</p>
        <button
          onClick={login}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Sign in with Discord
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-8 max-w-6xl mx-auto px-4">
        <h1 className="text-2xl font-bold mb-4">Facilitator Panel</h1>
        <div className="text-red-600">{error}</div>
      </div>
    );
  }

  const selectedGroup = groups.find((g) => g.group_id === selectedGroupId);
  const selectedMember = members.find((m) => m.user_id === selectedUserId);

  return (
    <div className="py-8 max-w-6xl mx-auto px-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Facilitator Panel</h1>
        <span className="text-sm text-gray-500">
          Role: {isAdmin ? "Admin" : "Facilitator"}
        </span>
      </div>

      {/* Group Selector */}
      <div className="mb-6">
        <label className="block text-sm font-medium mb-2">Select Group</label>
        <select
          value={selectedGroupId ?? ""}
          onChange={(e) => setSelectedGroupId(Number(e.target.value))}
          className="border rounded px-3 py-2 w-full max-w-md"
        >
          {groups.map((group) => (
            <option key={group.group_id} value={group.group_id}>
              {group.group_name} ({group.cohort_name})
            </option>
          ))}
        </select>
      </div>

      {selectedGroup && (
        <div className="mb-4 text-sm text-gray-600">
          Cohort: {selectedGroup.cohort_name} | Status: {selectedGroup.status}
        </div>
      )}

      {/* Members Table */}
      <div className="bg-white border rounded-lg overflow-hidden mb-6">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-4 py-3 font-medium">User</th>
              <th className="text-left px-4 py-3 font-medium">Progress</th>
              <th className="text-left px-4 py-3 font-medium">Time Spent</th>
              <th className="text-left px-4 py-3 font-medium">Last Active</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr
                key={member.user_id}
                onClick={() => setSelectedUserId(member.user_id)}
                className={`border-t cursor-pointer hover:bg-gray-50 ${
                  selectedUserId === member.user_id ? "bg-blue-50" : ""
                }`}
              >
                <td className="px-4 py-3">{member.name}</td>
                <td className="px-4 py-3">
                  {member.lessons_completed} lessons
                </td>
                <td className="px-4 py-3">
                  {formatDuration(member.total_time_seconds)}
                </td>
                <td className="px-4 py-3">
                  {formatTimeAgo(member.last_active_at)}
                </td>
              </tr>
            ))}
            {members.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                  No members in this group
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* User Detail Panel */}
      {selectedUserId && selectedMember && (
        <div className="bg-white border rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">{selectedMember.name}</h2>

          {/* Lesson Progress with integrated Chat History */}
          <div>
            <h3 className="font-medium mb-3">Lesson Progress</h3>
            {userProgress && userProgress.lessons.length > 0 ? (
              <div className="space-y-3">
                {userProgress.lessons.map((lesson) => {
                  const chatForLesson = userChats.find(
                    (chat) => chat.lesson_slug === lesson.lesson_slug,
                  );
                  return (
                    <details
                      key={lesson.lesson_slug}
                      className="border rounded"
                    >
                      <summary className="px-4 py-3 cursor-pointer hover:bg-gray-50">
                        <div className="inline-flex justify-between items-center w-[calc(100%-1rem)]">
                          <span className="font-medium">
                            {lesson.lesson_slug}
                          </span>
                          <span className="text-sm text-gray-600">
                            {lesson.completed ? "Completed" : "In Progress"} |{" "}
                            {formatDuration(lesson.time_spent_seconds)}
                          </span>
                        </div>
                      </summary>
                      <div className="px-4 py-3 border-t bg-gray-50">
                        {/* Stage breakdown */}
                        <div className="flex gap-4 text-sm text-gray-600 mb-4">
                          {lesson.stages.map((stage) => (
                            <span key={stage.stage_index}>
                              {stage.stage_type}:{" "}
                              {formatDuration(stage.time_spent_seconds)}
                            </span>
                          ))}
                        </div>

                        {/* Chat history for this lesson */}
                        {chatForLesson && chatForLesson.messages.length > 0 ? (
                          <div>
                            <div className="text-sm font-medium text-gray-700 mb-2">
                              Chat History ({chatForLesson.messages.length}{" "}
                              messages)
                            </div>
                            <div className="max-h-64 overflow-y-auto bg-white rounded border p-3">
                              {chatForLesson.messages.map((msg, idx) => (
                                <div
                                  key={idx}
                                  className={`mb-3 last:mb-0 ${
                                    msg.role === "user"
                                      ? "text-blue-800"
                                      : "text-gray-700"
                                  }`}
                                >
                                  <span className="font-medium capitalize">
                                    {msg.role}:
                                  </span>{" "}
                                  {msg.content}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500">
                            No chat messages
                          </p>
                        )}
                      </div>
                    </details>
                  );
                })}
              </div>
            ) : (
              <p className="text-gray-500">No lesson progress recorded</p>
            )}
          </div>
        </div>
      )}

      {isLoading && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center">
          <div className="bg-white px-6 py-4 rounded shadow space-y-3">
            <Skeleton variant="text" className="h-6 w-32" />
            <SkeletonText lines={2} />
          </div>
        </div>
      )}
    </div>
  );
}
