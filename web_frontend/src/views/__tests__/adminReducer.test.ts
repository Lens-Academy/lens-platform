import { describe, it, expect } from "vitest";
import {
  adminReducer,
  initialAdminState,
  type AdminState,
  type AdminAction,
  type Cohort,
} from "../adminReducer";
import type {
  UserSearchResult,
  UserDetails,
  GroupSummary,
  GroupSyncResult,
  CohortSyncResult,
} from "../../api/admin";

// Helper: freeze state so mutations throw
function frozen(overrides: Partial<AdminState> = {}): AdminState {
  return Object.freeze({ ...initialAdminState, ...overrides }) as AdminState;
}

// ─── 1. Initial state ───────────────────────────────────────────────

describe("initial state", () => {
  it("has correct default values for all 23 fields", () => {
    const s = initialAdminState;
    expect(s.activeTab).toBe("users");
    expect(s.error).toBeNull();
    expect(s.searchQuery).toBe("");
    expect(s.searchResults).toEqual([]);
    expect(s.isSearching).toBe(false);
    expect(s.selectedUser).toBeNull();
    expect(s.isLoadingUser).toBe(false);
    expect(s.isSyncing).toBe(false);
    expect(s.syncMessage).toBeNull();
    expect(s.addGroupCohortId).toBeNull();
    expect(s.addGroupId).toBeNull();
    expect(s.addGroupOptions).toEqual([]);
    expect(s.isAddingToGroup).toBe(false);
    expect(s.cohorts).toEqual([]);
    expect(s.selectedCohortId).toBeNull();
    expect(s.groups).toEqual([]);
    expect(s.loadingGroups).toBe(false);
    expect(s.cohortSyncing).toBe(false);
    expect(s.cohortRealizing).toBe(false);
    expect(s.groupSyncing).toEqual({});
    expect(s.groupRealizing).toEqual({});
    expect(s.lastGroupResult).toBeNull();
    expect(s.lastCohortResult).toBeNull();
  });

  it("returns same reference for unknown action", () => {
    const state = frozen();
    const result = adminReducer(state, { type: "UNKNOWN_ACTION" } as unknown as AdminAction);
    expect(result).toBe(state);
  });
});

// ─── 2. Simple setters ─────────────────────────────────────────────

describe("simple setters", () => {
  it("SET_ACTIVE_TAB changes tab", () => {
    const result = adminReducer(frozen(), { type: "SET_ACTIVE_TAB", tab: "groups" });
    expect(result.activeTab).toBe("groups");
  });

  it("SET_COHORTS sets cohorts array", () => {
    const cohorts: Cohort[] = [{ cohort_id: 1, cohort_name: "C1" }];
    const result = adminReducer(frozen(), { type: "SET_COHORTS", cohorts });
    expect(result.cohorts).toEqual(cohorts);
  });

  it("SET_SEARCH_QUERY updates query", () => {
    const result = adminReducer(frozen(), { type: "SET_SEARCH_QUERY", query: "alice" });
    expect(result.searchQuery).toBe("alice");
  });

  it("SET_SELECTED_COHORT_ID updates cohort id", () => {
    const result = adminReducer(frozen(), { type: "SET_SELECTED_COHORT_ID", cohortId: 42 });
    expect(result.selectedCohortId).toBe(42);
  });

  it("SET_SELECTED_COHORT_ID accepts null", () => {
    const result = adminReducer(frozen({ selectedCohortId: 42 }), {
      type: "SET_SELECTED_COHORT_ID",
      cohortId: null,
    });
    expect(result.selectedCohortId).toBeNull();
  });

  it("SET_ADD_GROUP_COHORT_ID updates add group cohort id", () => {
    const result = adminReducer(frozen(), { type: "SET_ADD_GROUP_COHORT_ID", cohortId: 5 });
    expect(result.addGroupCohortId).toBe(5);
  });

  it("SET_ADD_GROUP_ID updates add group id", () => {
    const result = adminReducer(frozen(), { type: "SET_ADD_GROUP_ID", groupId: 10 });
    expect(result.addGroupId).toBe(10);
  });

  it("SET_ADD_GROUP_OPTIONS updates options", () => {
    const options: GroupSummary[] = [
      { group_id: 1, group_name: "G1", status: "active", member_count: 3, meeting_time: null },
    ];
    const result = adminReducer(frozen(), { type: "SET_ADD_GROUP_OPTIONS", options });
    expect(result.addGroupOptions).toEqual(options);
  });
});

// ─── 3. Search lifecycle ────────────────────────────────────────────

describe("search lifecycle", () => {
  it("SEARCH_START sets isSearching true and clears error", () => {
    const state = frozen({ error: "old error" });
    const result = adminReducer(state, { type: "SEARCH_START" });
    expect(result.isSearching).toBe(true);
    expect(result.error).toBeNull();
  });

  it("SEARCH_SUCCESS sets results and clears isSearching", () => {
    const results: UserSearchResult[] = [
      { user_id: 1, discord_id: "123", nickname: "Alice", discord_username: "alice#0" },
    ];
    const state = frozen({ isSearching: true });
    const result = adminReducer(state, { type: "SEARCH_SUCCESS", results });
    expect(result.isSearching).toBe(false);
    expect(result.searchResults).toEqual(results);
  });

  it("SEARCH_ERROR sets error, clears results and isSearching", () => {
    const state = frozen({ isSearching: true, searchResults: [{ user_id: 1, discord_id: "1", nickname: null, discord_username: "a" }] });
    const result = adminReducer(state, { type: "SEARCH_ERROR", error: "Network error" });
    expect(result.isSearching).toBe(false);
    expect(result.error).toBe("Network error");
    expect(result.searchResults).toEqual([]);
  });

  it("SEARCH_CLEAR empties results and clears isSearching", () => {
    const state = frozen({ isSearching: true, searchResults: [{ user_id: 1, discord_id: "1", nickname: null, discord_username: "a" }] });
    const result = adminReducer(state, { type: "SEARCH_CLEAR" });
    expect(result.searchResults).toEqual([]);
    expect(result.isSearching).toBe(false);
  });
});

// ─── 4. Select user lifecycle ───────────────────────────────────────

describe("select user lifecycle", () => {
  it("SELECT_USER_START sets loading, clears error and syncMessage", () => {
    const state = frozen({ error: "err", syncMessage: "synced!" });
    const result = adminReducer(state, { type: "SELECT_USER_START" });
    expect(result.isLoadingUser).toBe(true);
    expect(result.error).toBeNull();
    expect(result.syncMessage).toBeNull();
  });

  it("SELECT_USER_SUCCESS sets user and clears loading", () => {
    const user: UserDetails = {
      user_id: 1, discord_id: "123", nickname: "Bob", discord_username: "bob#0",
      email: "bob@test.com", group_id: null, group_name: null, cohort_id: null,
      cohort_name: null, group_status: null,
    };
    const state = frozen({ isLoadingUser: true });
    const result = adminReducer(state, { type: "SELECT_USER_SUCCESS", user });
    expect(result.isLoadingUser).toBe(false);
    expect(result.selectedUser).toEqual(user);
  });

  it("SELECT_USER_ERROR sets error, clears user and loading", () => {
    const state = frozen({ isLoadingUser: true, selectedUser: { user_id: 1 } as UserDetails });
    const result = adminReducer(state, { type: "SELECT_USER_ERROR", error: "Not found" });
    expect(result.isLoadingUser).toBe(false);
    expect(result.selectedUser).toBeNull();
    expect(result.error).toBe("Not found");
  });
});

// ─── 5. Sync user group lifecycle ───────────────────────────────────

describe("sync user group lifecycle", () => {
  it("SYNC_USER_GROUP_START sets syncing, clears syncMessage/error/lastGroupResult but NOT lastCohortResult", () => {
    const cohortResult = { result: { results: [] } as CohortSyncResult, operationType: "sync" as const };
    const state = frozen({
      syncMessage: "old",
      error: "old",
      lastGroupResult: { groupId: 1, result: {} as GroupSyncResult, operationType: "sync" as const },
      lastCohortResult: cohortResult,
    });
    const result = adminReducer(state, { type: "SYNC_USER_GROUP_START" });
    expect(result.isSyncing).toBe(true);
    expect(result.syncMessage).toBeNull();
    expect(result.error).toBeNull();
    expect(result.lastGroupResult).toBeNull();
    expect(result.lastCohortResult).toBe(cohortResult);
  });

  it("SYNC_USER_GROUP_SUCCESS sets message and result, clears syncing", () => {
    const syncResult: GroupSyncResult = { discord: { granted: 1, revoked: 0, unchanged: 2, failed: 0 } };
    const state = frozen({ isSyncing: true });
    const result = adminReducer(state, {
      type: "SYNC_USER_GROUP_SUCCESS",
      groupId: 5,
      result: syncResult,
      message: "Group synced successfully",
    });
    expect(result.isSyncing).toBe(false);
    expect(result.syncMessage).toBe("Group synced successfully");
    expect(result.lastGroupResult).toEqual({
      groupId: 5,
      result: syncResult,
      operationType: "sync",
    });
  });

  it("SYNC_USER_GROUP_ERROR sets error, clears syncing", () => {
    const state = frozen({ isSyncing: true });
    const result = adminReducer(state, { type: "SYNC_USER_GROUP_ERROR", error: "Sync failed" });
    expect(result.isSyncing).toBe(false);
    expect(result.error).toBe("Sync failed");
  });
});

// ─── 6. Add to group lifecycle ──────────────────────────────────────

describe("add to group lifecycle", () => {
  it("ADD_TO_GROUP_START sets adding, clears syncMessage and error", () => {
    const state = frozen({ syncMessage: "old", error: "old" });
    const result = adminReducer(state, { type: "ADD_TO_GROUP_START" });
    expect(result.isAddingToGroup).toBe(true);
    expect(result.syncMessage).toBeNull();
    expect(result.error).toBeNull();
  });

  it("ADD_TO_GROUP_SUCCESS updates user, sets message, clears cohortId/groupId/adding", () => {
    const updatedUser: UserDetails = {
      user_id: 1, discord_id: "123", nickname: "Bob", discord_username: "bob#0",
      email: null, group_id: 10, group_name: "G10", cohort_id: 2,
      cohort_name: "C2", group_status: "active",
    };
    const state = frozen({ isAddingToGroup: true, addGroupCohortId: 2, addGroupId: 10 });
    const result = adminReducer(state, {
      type: "ADD_TO_GROUP_SUCCESS",
      user: updatedUser,
      message: "User added to G10",
    });
    expect(result.isAddingToGroup).toBe(false);
    expect(result.selectedUser).toEqual(updatedUser);
    expect(result.syncMessage).toBe("User added to G10");
    expect(result.addGroupCohortId).toBeNull();
    expect(result.addGroupId).toBeNull();
  });

  it("ADD_TO_GROUP_ERROR sets error, clears adding", () => {
    const state = frozen({ isAddingToGroup: true });
    const result = adminReducer(state, { type: "ADD_TO_GROUP_ERROR", error: "Failed" });
    expect(result.isAddingToGroup).toBe(false);
    expect(result.error).toBe("Failed");
  });
});

// ─── 7. Load groups lifecycle ───────────────────────────────────────

describe("load groups lifecycle", () => {
  it("LOAD_GROUPS_START sets loadingGroups, clears error", () => {
    const state = frozen({ error: "old" });
    const result = adminReducer(state, { type: "LOAD_GROUPS_START" });
    expect(result.loadingGroups).toBe(true);
    expect(result.error).toBeNull();
  });

  it("LOAD_GROUPS_SUCCESS sets groups, clears loading", () => {
    const groups: GroupSummary[] = [
      { group_id: 1, group_name: "G1", status: "active", member_count: 5, meeting_time: "Mon 6pm" },
    ];
    const state = frozen({ loadingGroups: true });
    const result = adminReducer(state, { type: "LOAD_GROUPS_SUCCESS", groups });
    expect(result.loadingGroups).toBe(false);
    expect(result.groups).toEqual(groups);
  });

  it("LOAD_GROUPS_ERROR sets error, clears groups and loading", () => {
    const state = frozen({ loadingGroups: true, groups: [{ group_id: 1, group_name: "G1", status: "active", member_count: 5, meeting_time: null }] });
    const result = adminReducer(state, { type: "LOAD_GROUPS_ERROR", error: "Network fail" });
    expect(result.loadingGroups).toBe(false);
    expect(result.groups).toEqual([]);
    expect(result.error).toBe("Network fail");
  });
});

// ─── 8. Cohort sync/realize ─────────────────────────────────────────

describe("cohort sync lifecycle", () => {
  it("SYNC_COHORT_START clears BOTH lastCohortResult AND lastGroupResult", () => {
    const state = frozen({
      lastCohortResult: { result: { results: [] } as CohortSyncResult, operationType: "sync" as const },
      lastGroupResult: { groupId: 1, result: {} as GroupSyncResult, operationType: "sync" as const },
      syncMessage: "old",
      error: "old",
    });
    const result = adminReducer(state, { type: "SYNC_COHORT_START" });
    expect(result.cohortSyncing).toBe(true);
    expect(result.syncMessage).toBeNull();
    expect(result.error).toBeNull();
    expect(result.lastCohortResult).toBeNull();
    expect(result.lastGroupResult).toBeNull();
  });

  it("SYNC_COHORT_SUCCESS sets result and message", () => {
    const cohortResult: CohortSyncResult = { synced: 3, results: [] };
    const state = frozen({ cohortSyncing: true });
    const result = adminReducer(state, {
      type: "SYNC_COHORT_SUCCESS",
      result: cohortResult,
      message: "Synced 3 groups successfully",
    });
    expect(result.cohortSyncing).toBe(false);
    expect(result.syncMessage).toBe("Synced 3 groups successfully");
    expect(result.lastCohortResult).toEqual({ result: cohortResult, operationType: "sync" });
  });

  it("SYNC_COHORT_ERROR sets error, clears syncing", () => {
    const state = frozen({ cohortSyncing: true });
    const result = adminReducer(state, { type: "SYNC_COHORT_ERROR", error: "Cohort sync failed" });
    expect(result.cohortSyncing).toBe(false);
    expect(result.error).toBe("Cohort sync failed");
  });
});

describe("cohort realize lifecycle", () => {
  it("REALIZE_COHORT_START clears BOTH result objects", () => {
    const state = frozen({
      lastCohortResult: { result: { results: [] } as CohortSyncResult, operationType: "sync" as const },
      lastGroupResult: { groupId: 1, result: {} as GroupSyncResult, operationType: "sync" as const },
      syncMessage: "old",
      error: "old",
    });
    const result = adminReducer(state, { type: "REALIZE_COHORT_START" });
    expect(result.cohortRealizing).toBe(true);
    expect(result.syncMessage).toBeNull();
    expect(result.error).toBeNull();
    expect(result.lastCohortResult).toBeNull();
    expect(result.lastGroupResult).toBeNull();
  });

  it("REALIZE_COHORT_SUCCESS sets result, message, AND groups", () => {
    const cohortResult: CohortSyncResult = { realized: 2, results: [] };
    const newGroups: GroupSummary[] = [
      { group_id: 1, group_name: "G1", status: "active", member_count: 3, meeting_time: null },
    ];
    const state = frozen({ cohortRealizing: true });
    const result = adminReducer(state, {
      type: "REALIZE_COHORT_SUCCESS",
      result: cohortResult,
      message: "Realized 2 groups successfully",
      groups: newGroups,
    });
    expect(result.cohortRealizing).toBe(false);
    expect(result.syncMessage).toBe("Realized 2 groups successfully");
    expect(result.lastCohortResult).toEqual({ result: cohortResult, operationType: "realize" });
    expect(result.groups).toEqual(newGroups);
  });

  it("REALIZE_COHORT_ERROR sets error, clears realizing", () => {
    const state = frozen({ cohortRealizing: true });
    const result = adminReducer(state, { type: "REALIZE_COHORT_ERROR", error: "Realize failed" });
    expect(result.cohortRealizing).toBe(false);
    expect(result.error).toBe("Realize failed");
  });
});

// ─── 9. Per-group sync/realize ──────────────────────────────────────

describe("per-group sync lifecycle", () => {
  it("SYNC_GROUP_START sets per-group syncing, clears BOTH results", () => {
    const state = frozen({
      groupSyncing: { 5: false },
      lastGroupResult: { groupId: 1, result: {} as GroupSyncResult, operationType: "sync" as const },
      lastCohortResult: { result: { results: [] } as CohortSyncResult, operationType: "sync" as const },
      syncMessage: "old",
      error: "old",
    });
    const result = adminReducer(state, { type: "SYNC_GROUP_START", groupId: 5 });
    expect(result.groupSyncing[5]).toBe(true);
    expect(result.syncMessage).toBeNull();
    expect(result.error).toBeNull();
    expect(result.lastGroupResult).toBeNull();
    expect(result.lastCohortResult).toBeNull();
  });

  it("SYNC_GROUP_SUCCESS sets per-group syncing false, sets result and message", () => {
    const syncResult: GroupSyncResult = { discord: { granted: 2, revoked: 0, unchanged: 1, failed: 0 } };
    const state = frozen({ groupSyncing: { 5: true } });
    const result = adminReducer(state, {
      type: "SYNC_GROUP_SUCCESS",
      groupId: 5,
      result: syncResult,
      message: "Group synced successfully",
    });
    expect(result.groupSyncing[5]).toBe(false);
    expect(result.syncMessage).toBe("Group synced successfully");
    expect(result.lastGroupResult).toEqual({ groupId: 5, result: syncResult, operationType: "sync" });
  });

  it("SYNC_GROUP_ERROR sets per-group syncing false, sets error", () => {
    const state = frozen({ groupSyncing: { 5: true } });
    const result = adminReducer(state, { type: "SYNC_GROUP_ERROR", groupId: 5, error: "Group sync failed" });
    expect(result.groupSyncing[5]).toBe(false);
    expect(result.error).toBe("Group sync failed");
  });
});

describe("per-group realize lifecycle", () => {
  it("REALIZE_GROUP_START sets per-group realizing, clears BOTH results", () => {
    const state = frozen({
      groupRealizing: { 7: false },
      lastGroupResult: { groupId: 1, result: {} as GroupSyncResult, operationType: "sync" as const },
      lastCohortResult: { result: { results: [] } as CohortSyncResult, operationType: "sync" as const },
      syncMessage: "old",
      error: "old",
    });
    const result = adminReducer(state, { type: "REALIZE_GROUP_START", groupId: 7 });
    expect(result.groupRealizing[7]).toBe(true);
    expect(result.syncMessage).toBeNull();
    expect(result.error).toBeNull();
    expect(result.lastGroupResult).toBeNull();
    expect(result.lastCohortResult).toBeNull();
  });

  it("REALIZE_GROUP_SUCCESS sets result, message, AND groups", () => {
    const syncResult: GroupSyncResult = { infrastructure: { category: { status: "created" }, text_channel: { status: "created" }, voice_channel: { status: "created" }, meetings: { created: 1, existed: 0 }, discord_events: { created: 1, existed: 0, skipped: 0, failed: 0 } } };
    const newGroups: GroupSummary[] = [
      { group_id: 7, group_name: "G7", status: "active", member_count: 4, meeting_time: "Wed 3pm" },
    ];
    const state = frozen({ groupRealizing: { 7: true } });
    const result = adminReducer(state, {
      type: "REALIZE_GROUP_SUCCESS",
      groupId: 7,
      result: syncResult,
      message: "Group realized successfully",
      groups: newGroups,
    });
    expect(result.groupRealizing[7]).toBe(false);
    expect(result.syncMessage).toBe("Group realized successfully");
    expect(result.lastGroupResult).toEqual({ groupId: 7, result: syncResult, operationType: "realize" });
    expect(result.groups).toEqual(newGroups);
  });

  it("REALIZE_GROUP_ERROR sets error, clears per-group realizing", () => {
    const state = frozen({ groupRealizing: { 7: true } });
    const result = adminReducer(state, { type: "REALIZE_GROUP_ERROR", groupId: 7, error: "Realize failed" });
    expect(result.groupRealizing[7]).toBe(false);
    expect(result.error).toBe("Realize failed");
  });
});

// ─── 10. State isolation ────────────────────────────────────────────

describe("state isolation", () => {
  it("does not mutate previous state (Object.freeze)", () => {
    const state = frozen();
    // This would throw if reducer tried to mutate frozen state
    const result = adminReducer(state, { type: "SET_SEARCH_QUERY", query: "test" });
    expect(result).not.toBe(state);
    expect(result.searchQuery).toBe("test");
    expect(state.searchQuery).toBe("");
  });

  it("search actions don't touch groups tab fields", () => {
    const groups: GroupSummary[] = [{ group_id: 1, group_name: "G1", status: "active", member_count: 3, meeting_time: null }];
    const state = frozen({ groups, selectedCohortId: 5, loadingGroups: false });
    const result = adminReducer(state, { type: "SEARCH_START" });
    expect(result.groups).toBe(groups);
    expect(result.selectedCohortId).toBe(5);
    expect(result.loadingGroups).toBe(false);
  });

  it("group actions don't touch user selection", () => {
    const user: UserDetails = {
      user_id: 1, discord_id: "1", nickname: "A", discord_username: "a",
      email: null, group_id: null, group_name: null, cohort_id: null,
      cohort_name: null, group_status: null,
    };
    const state = frozen({ selectedUser: user, searchQuery: "alice" });
    const result = adminReducer(state, { type: "LOAD_GROUPS_START" });
    expect(result.selectedUser).toBe(user);
    expect(result.searchQuery).toBe("alice");
  });
});
