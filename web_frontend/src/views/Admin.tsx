import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../hooks/useAuth";
import { Skeleton, SkeletonText } from "../components/Skeleton";
import {
  searchUsers,
  getUserDetails,
  syncGroup,
  realizeGroup,
  getCohortGroups,
  syncCohort,
  realizeCohort,
  addMemberToGroup,
  type UserSearchResult,
  type UserDetails,
  type GroupSummary,
  type GroupSyncResult,
  type CohortSyncResult,
} from "../api/admin";
import {
  GroupOperationDetails,
  CohortOperationDetails,
} from "../components/OperationDetails";
import { API_URL } from "../config";
import { fetchWithRefresh } from "../api/fetchWithRefresh";

type TabType = "users" | "groups";

interface Cohort {
  cohort_id: number;
  cohort_name: string;
  course_name?: string;
}

export default function Admin() {
  const { isAuthenticated, isLoading: authLoading, login } = useAuth();

  const [activeTab, setActiveTab] = useState<TabType>("users");
  const [error, setError] = useState<string | null>(null);

  // Users tab state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserDetails | null>(null);
  const [isLoadingUser, setIsLoadingUser] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Add/Change group state (for Users tab)
  const [addGroupCohortId, setAddGroupCohortId] = useState<number | null>(null);
  const [addGroupId, setAddGroupId] = useState<number | null>(null);
  const [addGroupOptions, setAddGroupOptions] = useState<GroupSummary[]>([]);
  const [isAddingToGroup, setIsAddingToGroup] = useState(false);

  // Groups tab state
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [selectedCohortId, setSelectedCohortId] = useState<number | null>(null);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [cohortSyncing, setCohortSyncing] = useState(false);
  const [cohortRealizing, setCohortRealizing] = useState(false);
  const [groupSyncing, setGroupSyncing] = useState<Record<number, boolean>>({});
  const [groupRealizing, setGroupRealizing] = useState<Record<number, boolean>>(
    {},
  );

  // Operation results for detailed display
  const [lastGroupResult, setLastGroupResult] = useState<{
    groupId: number;
    result: GroupSyncResult;
    operationType: "sync" | "realize";
  } | null>(null);
  const [lastCohortResult, setLastCohortResult] = useState<{
    result: CohortSyncResult;
    operationType: "sync" | "realize";
  } | null>(null);

  // Debounced search
  const performSearch = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    setError(null);
    try {
      const results = await searchUsers(query);
      setSearchResults(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Debounce search input
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      performSearch(searchQuery);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchQuery, performSearch]);

  // Fetch cohorts on mount (admin endpoint returns all cohorts)
  useEffect(() => {
    async function fetchCohorts() {
      try {
        const res = await fetchWithRefresh(`${API_URL}/api/admin/cohorts`, {
          credentials: "include",
        });
        if (!res.ok) return;
        const data = await res.json();
        setCohorts(data.cohorts || []);
      } catch {
        // Silently fail - cohorts will be empty
      }
    }
    if (isAuthenticated) {
      fetchCohorts();
    }
  }, [isAuthenticated]);

  // Fetch groups when cohort is selected
  useEffect(() => {
    async function fetchGroups() {
      if (!selectedCohortId) {
        setGroups([]);
        return;
      }
      setLoadingGroups(true);
      setError(null);
      try {
        const groupsList = await getCohortGroups(selectedCohortId);
        setGroups(groupsList);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load groups");
        setGroups([]);
      } finally {
        setLoadingGroups(false);
      }
    }
    fetchGroups();
  }, [selectedCohortId]);

  // Load user details when selected
  const handleSelectUser = async (userId: number) => {
    setIsLoadingUser(true);
    setError(null);
    setSyncMessage(null);
    try {
      const details = await getUserDetails(userId);
      setSelectedUser(details);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load user");
      setSelectedUser(null);
    } finally {
      setIsLoadingUser(false);
    }
  };

  // Sync user's group (Users tab)
  const handleSyncUserGroup = async () => {
    if (!selectedUser?.group_id) return;

    setIsSyncing(true);
    setSyncMessage(null);
    setError(null);
    setLastGroupResult(null);
    try {
      const result = await syncGroup(selectedUser.group_id);
      setSyncMessage("Group synced successfully");
      setLastGroupResult({
        groupId: selectedUser.group_id,
        result,
        operationType: "sync",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setIsSyncing(false);
    }
  };

  // Pre-select cohort when user with a group is selected
  useEffect(() => {
    if (selectedUser?.cohort_id) {
      setAddGroupCohortId(selectedUser.cohort_id);
    } else {
      setAddGroupCohortId(null);
      setAddGroupId(null);
    }
  }, [selectedUser?.user_id, selectedUser?.cohort_id]);

  // Load groups when cohort is selected for adding user
  useEffect(() => {
    if (!addGroupCohortId) {
      setAddGroupOptions([]);
      setAddGroupId(null);
      return;
    }

    async function loadGroups() {
      try {
        const groups = await getCohortGroups(addGroupCohortId!);
        setAddGroupOptions(groups);
        setAddGroupId(null);
      } catch {
        setAddGroupOptions([]);
      }
    }
    loadGroups();
  }, [addGroupCohortId]);

  // Handle adding user to group
  const handleAddToGroup = async () => {
    if (!selectedUser || !addGroupId) return;

    setIsAddingToGroup(true);
    setSyncMessage(null);
    setError(null);
    try {
      await addMemberToGroup(addGroupId, selectedUser.user_id);
      const action = selectedUser.group_id ? "moved to" : "added to";
      const groupName =
        addGroupOptions.find((g) => g.group_id === addGroupId)?.group_name ||
        "group";
      setSyncMessage(`User ${action} ${groupName}`);
      // Refresh user details
      const updatedUser = await getUserDetails(selectedUser.user_id);
      setSelectedUser(updatedUser);
      // Reset selection
      setAddGroupCohortId(null);
      setAddGroupId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add to group");
    } finally {
      setIsAddingToGroup(false);
    }
  };

  // Sync all groups in cohort (Groups tab)
  const handleSyncCohort = async () => {
    if (!selectedCohortId) return;

    setCohortSyncing(true);
    setSyncMessage(null);
    setError(null);
    setLastCohortResult(null);
    setLastGroupResult(null);
    try {
      const result = await syncCohort(selectedCohortId);
      setSyncMessage(`Synced ${result.synced} groups successfully`);
      setLastCohortResult({ result, operationType: "sync" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cohort sync failed");
    } finally {
      setCohortSyncing(false);
    }
  };

  // Realize All Preview Groups in cohort (Groups tab)
  const handleRealizeCohort = async () => {
    if (!selectedCohortId) return;

    setCohortRealizing(true);
    setSyncMessage(null);
    setError(null);
    setLastCohortResult(null);
    setLastGroupResult(null);
    try {
      const result = await realizeCohort(selectedCohortId);
      setSyncMessage(`Realized ${result.realized} groups successfully`);
      setLastCohortResult({ result, operationType: "realize" });
      // Refresh groups list
      const groupsList = await getCohortGroups(selectedCohortId);
      setGroups(groupsList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cohort realize failed");
    } finally {
      setCohortRealizing(false);
    }
  };

  // Sync a single group (Groups tab)
  const handleSyncGroupById = async (groupId: number) => {
    setGroupSyncing((prev) => ({ ...prev, [groupId]: true }));
    setSyncMessage(null);
    setError(null);
    setLastGroupResult(null);
    setLastCohortResult(null);
    try {
      const result = await syncGroup(groupId);
      setSyncMessage("Group synced successfully");
      setLastGroupResult({ groupId, result, operationType: "sync" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Group sync failed");
    } finally {
      setGroupSyncing((prev) => ({ ...prev, [groupId]: false }));
    }
  };

  // Realize a single group (Groups tab)
  const handleRealizeGroupById = async (groupId: number) => {
    if (!selectedCohortId) return;

    setGroupRealizing((prev) => ({ ...prev, [groupId]: true }));
    setSyncMessage(null);
    setError(null);
    setLastGroupResult(null);
    setLastCohortResult(null);
    try {
      const result = await realizeGroup(groupId);
      setSyncMessage("Group realized successfully");
      setLastGroupResult({ groupId, result, operationType: "realize" });
      // Refresh groups list
      const groupsList = await getCohortGroups(selectedCohortId);
      setGroups(groupsList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Group realize failed");
    } finally {
      setGroupRealizing((prev) => ({ ...prev, [groupId]: false }));
    }
  };

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
        <h1 className="text-2xl font-bold mb-4">Admin Panel</h1>
        <p className="mb-4">Please sign in to access the admin panel.</p>
        <button
          onClick={login}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Sign in with Discord
        </button>
      </div>
    );
  }

  return (
    <div className="py-8 max-w-6xl mx-auto px-4">
      <h1 className="text-2xl font-bold mb-6">Admin Panel</h1>

      {/* Error display */}
      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-300 text-red-700 rounded">
          {error}
        </div>
      )}

      {/* Success message with operation details */}
      {syncMessage && (
        <div className="mb-4 p-3 bg-green-100 border border-green-300 text-green-700 rounded">
          {syncMessage}
          {lastGroupResult && (
            <GroupOperationDetails result={lastGroupResult.result} />
          )}
          {lastCohortResult && (
            <CohortOperationDetails
              result={lastCohortResult.result}
              operationType={lastCohortResult.operationType}
            />
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="border-b mb-6">
        <nav className="flex gap-4">
          <button
            onClick={() => setActiveTab("users")}
            className={`py-2 px-1 border-b-2 font-medium ${
              activeTab === "users"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            Users
          </button>
          <button
            onClick={() => setActiveTab("groups")}
            className={`py-2 px-1 border-b-2 font-medium ${
              activeTab === "groups"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            Groups
          </button>
        </nav>
      </div>

      {/* Users Tab */}
      {activeTab === "users" && (
        <div className="space-y-6">
          {/* Search input */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Search Users
            </label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by nickname or Discord username..."
              className="border rounded px-3 py-2 w-full max-w-md"
            />
            {searchQuery.length > 0 && searchQuery.length < 2 && (
              <p className="text-sm text-gray-500 mt-1">
                Enter at least 2 characters to search
              </p>
            )}
          </div>

          {/* Search results */}
          {isSearching ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full max-w-md" />
              <Skeleton className="h-10 w-full max-w-md" />
            </div>
          ) : searchResults.length > 0 ? (
            <div className="bg-white border rounded-lg overflow-hidden max-w-2xl">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">
                      Nickname
                    </th>
                    <th className="text-left px-4 py-3 font-medium">
                      Discord Username
                    </th>
                    <th className="text-left px-4 py-3 font-medium">User ID</th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((user) => (
                    <tr
                      key={user.user_id}
                      onClick={() => handleSelectUser(user.user_id)}
                      className={`border-t cursor-pointer hover:bg-gray-50 ${
                        selectedUser?.user_id === user.user_id
                          ? "bg-blue-50"
                          : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        {user.nickname || (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">{user.discord_username}</td>
                      <td className="px-4 py-3 text-gray-500">
                        {user.user_id}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : searchQuery.length >= 2 ? (
            <p className="text-gray-500">No users found</p>
          ) : null}

          {/* User details panel */}
          {isLoadingUser ? (
            <div className="bg-white border rounded-lg p-6 max-w-2xl">
              <Skeleton className="h-6 w-48 mb-4" />
              <SkeletonText lines={4} />
            </div>
          ) : selectedUser ? (
            <div className="bg-white border rounded-lg p-6 max-w-2xl">
              <h2 className="text-xl font-semibold mb-4">User Details</h2>

              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="font-medium text-gray-500">User ID</dt>
                  <dd>{selectedUser.user_id}</dd>
                </div>
                <div>
                  <dt className="font-medium text-gray-500">Discord ID</dt>
                  <dd className="font-mono text-xs">
                    {selectedUser.discord_id}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-gray-500">Nickname</dt>
                  <dd>
                    {selectedUser.nickname || (
                      <span className="text-gray-400">-</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-gray-500">
                    Discord Username
                  </dt>
                  <dd>{selectedUser.discord_username}</dd>
                </div>
                <div>
                  <dt className="font-medium text-gray-500">Email</dt>
                  <dd>
                    {selectedUser.email || (
                      <span className="text-gray-400">-</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-gray-500">Group</dt>
                  <dd>
                    {selectedUser.group_name ? (
                      <>
                        {selectedUser.group_name}
                        <span className="ml-2 text-xs text-gray-500">
                          ({selectedUser.group_status})
                        </span>
                      </>
                    ) : (
                      <span className="text-gray-400">No group</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-gray-500">Cohort</dt>
                  <dd>
                    {selectedUser.cohort_name || (
                      <span className="text-gray-400">-</span>
                    )}
                  </dd>
                </div>
              </dl>

              {/* Sync button */}
              {selectedUser.group_id && (
                <div className="mt-6 pt-4 border-t">
                  <button
                    onClick={handleSyncUserGroup}
                    disabled={isSyncing}
                    className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-blue-400"
                  >
                    {isSyncing ? "Syncing..." : "Sync Group"}
                  </button>
                  <p className="text-sm text-gray-500 mt-2">
                    Syncs Discord permissions, calendar, and reminders for this
                    user's group.
                  </p>
                </div>
              )}

              {/* Add/Change Group */}
              <div className="mt-6 pt-4 border-t">
                <h3 className="font-medium mb-3">
                  {selectedUser.group_id ? "Change Group" : "Add to Group"}
                </h3>

                <div className="space-y-3">
                  {/* Cohort selector */}
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">
                      Cohort
                    </label>
                    <select
                      value={addGroupCohortId || ""}
                      onChange={(e) =>
                        setAddGroupCohortId(
                          e.target.value ? Number(e.target.value) : null,
                        )
                      }
                      className="border rounded px-3 py-2 w-full"
                    >
                      <option value="">Select a cohort...</option>
                      {cohorts.map((c) => (
                        <option key={c.cohort_id} value={c.cohort_id}>
                          {c.cohort_name}
                          {c.course_name ? ` (${c.course_name})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Group selector */}
                  {addGroupCohortId && (
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">
                        Group
                      </label>
                      <select
                        value={addGroupId || ""}
                        onChange={(e) =>
                          setAddGroupId(
                            e.target.value ? Number(e.target.value) : null,
                          )
                        }
                        className="border rounded px-3 py-2 w-full"
                        disabled={addGroupOptions.length === 0}
                      >
                        <option value="">
                          {addGroupOptions.length === 0
                            ? "No groups in this cohort"
                            : "Select a group..."}
                        </option>
                        {addGroupOptions.map((g) => (
                          <option key={g.group_id} value={g.group_id}>
                            {g.group_name} ({g.member_count} members)
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Submit button */}
                  {addGroupId && (
                    <button
                      onClick={handleAddToGroup}
                      disabled={isAddingToGroup}
                      className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:bg-green-400"
                    >
                      {isAddingToGroup
                        ? "Adding..."
                        : selectedUser.group_id
                          ? "Change Group"
                          : "Add to Group"}
                    </button>
                  )}
                </div>

                {selectedUser.group_id && (
                  <p className="text-sm text-gray-500 mt-2">
                    Changing groups will remove the user from their current
                    group and add them to the new one.
                  </p>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Groups Tab */}
      {activeTab === "groups" && (
        <div className="space-y-6">
          {/* Cohort selector */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Select Cohort
            </label>
            <select
              value={selectedCohortId || ""}
              onChange={(e) =>
                setSelectedCohortId(
                  e.target.value ? Number(e.target.value) : null,
                )
              }
              className="border rounded px-3 py-2 w-full max-w-md"
            >
              <option value="">Select a cohort...</option>
              {cohorts.map((c) => (
                <option key={c.cohort_id} value={c.cohort_id}>
                  {c.cohort_name}
                  {c.course_name ? ` (${c.course_name})` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Cohort actions */}
          {selectedCohortId && (
            <div className="flex gap-2">
              <button
                onClick={handleSyncCohort}
                disabled={cohortSyncing}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-blue-400"
              >
                {cohortSyncing ? "Syncing..." : "Sync All Groups"}
              </button>
              <button
                onClick={handleRealizeCohort}
                disabled={cohortRealizing}
                className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:bg-green-400"
              >
                {cohortRealizing ? "Realizing..." : "Realize All Preview"}
              </button>
            </div>
          )}

          {/* Loading state */}
          {loadingGroups && (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}

          {/* Groups table */}
          {!loadingGroups && selectedCohortId && groups.length > 0 && (
            <div className="bg-white border rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Group</th>
                    <th className="text-left px-4 py-3 font-medium">Status</th>
                    <th className="text-left px-4 py-3 font-medium">Members</th>
                    <th className="text-left px-4 py-3 font-medium">
                      Meeting Time
                    </th>
                    <th className="text-left px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.group_id} className="border-t">
                      <td className="px-4 py-3">{g.group_name}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                            g.status === "preview"
                              ? "bg-yellow-100 text-yellow-800"
                              : g.status === "active"
                                ? "bg-green-100 text-green-800"
                                : g.status === "completed"
                                  ? "bg-gray-100 text-gray-800"
                                  : "bg-red-100 text-red-800"
                          }`}
                        >
                          {g.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">{g.member_count}</td>
                      <td className="px-4 py-3">
                        {g.meeting_time || (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleSyncGroupById(g.group_id)}
                            disabled={groupSyncing[g.group_id]}
                            className="text-blue-600 hover:text-blue-800 disabled:text-blue-400 text-sm"
                          >
                            {groupSyncing[g.group_id] ? "Syncing..." : "Sync"}
                          </button>
                          {g.status === "preview" && (
                            <button
                              onClick={() => handleRealizeGroupById(g.group_id)}
                              disabled={groupRealizing[g.group_id]}
                              className="text-green-600 hover:text-green-800 disabled:text-green-400 text-sm"
                            >
                              {groupRealizing[g.group_id]
                                ? "Realizing..."
                                : "Realize"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Empty state */}
          {!loadingGroups && selectedCohortId && groups.length === 0 && (
            <p className="text-gray-500">No groups found in this cohort.</p>
          )}
        </div>
      )}
    </div>
  );
}
