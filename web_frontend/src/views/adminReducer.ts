import type {
  UserSearchResult,
  UserDetails,
  GroupSummary,
  GroupSyncResult,
  CohortSyncResult,
} from "../api/admin";

// ─── Types ──────────────────────────────────────────────────────────

export type TabType = "users" | "groups";

export interface Cohort {
  cohort_id: number;
  cohort_name: string;
  course_name?: string;
}

export interface AdminState {
  activeTab: TabType;
  error: string | null;

  // Users tab
  searchQuery: string;
  searchResults: UserSearchResult[];
  isSearching: boolean;
  selectedUser: UserDetails | null;
  isLoadingUser: boolean;
  isSyncing: boolean;
  syncMessage: string | null;

  // Add/Change group (Users tab)
  addGroupCohortId: number | null;
  addGroupId: number | null;
  addGroupOptions: GroupSummary[];
  isAddingToGroup: boolean;

  // Groups tab
  cohorts: Cohort[];
  selectedCohortId: number | null;
  groups: GroupSummary[];
  loadingGroups: boolean;
  cohortSyncing: boolean;
  cohortRealizing: boolean;
  groupSyncing: Record<number, boolean>;
  groupRealizing: Record<number, boolean>;

  // Operation results
  lastGroupResult: {
    groupId: number;
    result: GroupSyncResult;
    operationType: "sync" | "realize";
  } | null;
  lastCohortResult: {
    result: CohortSyncResult;
    operationType: "sync" | "realize";
  } | null;
}

export type AdminAction =
  // Simple setters
  | { type: "SET_ACTIVE_TAB"; tab: TabType }
  | { type: "SET_COHORTS"; cohorts: Cohort[] }
  | { type: "SET_SEARCH_QUERY"; query: string }
  | { type: "SET_SELECTED_COHORT_ID"; cohortId: number | null }
  | { type: "SET_ADD_GROUP_COHORT_ID"; cohortId: number | null }
  | { type: "SET_ADD_GROUP_ID"; groupId: number | null }
  | { type: "SET_ADD_GROUP_OPTIONS"; options: GroupSummary[] }
  // Search
  | { type: "SEARCH_START" }
  | { type: "SEARCH_SUCCESS"; results: UserSearchResult[] }
  | { type: "SEARCH_ERROR"; error: string }
  | { type: "SEARCH_CLEAR" }
  // Select user
  | { type: "SELECT_USER_START" }
  | { type: "SELECT_USER_SUCCESS"; user: UserDetails }
  | { type: "SELECT_USER_ERROR"; error: string }
  // Sync user group
  | { type: "SYNC_USER_GROUP_START" }
  | { type: "SYNC_USER_GROUP_SUCCESS"; groupId: number; result: GroupSyncResult; message: string }
  | { type: "SYNC_USER_GROUP_ERROR"; error: string }
  // Add to group
  | { type: "ADD_TO_GROUP_START" }
  | { type: "ADD_TO_GROUP_SUCCESS"; user: UserDetails; message: string }
  | { type: "ADD_TO_GROUP_ERROR"; error: string }
  // Load groups
  | { type: "LOAD_GROUPS_START" }
  | { type: "LOAD_GROUPS_SUCCESS"; groups: GroupSummary[] }
  | { type: "LOAD_GROUPS_ERROR"; error: string }
  // Cohort sync/realize
  | { type: "SYNC_COHORT_START" }
  | { type: "SYNC_COHORT_SUCCESS"; result: CohortSyncResult; message: string }
  | { type: "SYNC_COHORT_ERROR"; error: string }
  | { type: "REALIZE_COHORT_START" }
  | { type: "REALIZE_COHORT_SUCCESS"; result: CohortSyncResult; message: string; groups: GroupSummary[] }
  | { type: "REALIZE_COHORT_ERROR"; error: string }
  // Per-group sync/realize
  | { type: "SYNC_GROUP_START"; groupId: number }
  | { type: "SYNC_GROUP_SUCCESS"; groupId: number; result: GroupSyncResult; message: string }
  | { type: "SYNC_GROUP_ERROR"; groupId: number; error: string }
  | { type: "REALIZE_GROUP_START"; groupId: number }
  | { type: "REALIZE_GROUP_SUCCESS"; groupId: number; result: GroupSyncResult; message: string; groups: GroupSummary[] }
  | { type: "REALIZE_GROUP_ERROR"; groupId: number; error: string };

// ─── Initial state ──────────────────────────────────────────────────

export const initialAdminState: AdminState = {
  activeTab: "users",
  error: null,
  searchQuery: "",
  searchResults: [],
  isSearching: false,
  selectedUser: null,
  isLoadingUser: false,
  isSyncing: false,
  syncMessage: null,
  addGroupCohortId: null,
  addGroupId: null,
  addGroupOptions: [],
  isAddingToGroup: false,
  cohorts: [],
  selectedCohortId: null,
  groups: [],
  loadingGroups: false,
  cohortSyncing: false,
  cohortRealizing: false,
  groupSyncing: {},
  groupRealizing: {},
  lastGroupResult: null,
  lastCohortResult: null,
};

// ─── Reducer ────────────────────────────────────────────────────────

export function adminReducer(state: AdminState, action: AdminAction): AdminState {
  switch (action.type) {
    // Simple setters
    case "SET_ACTIVE_TAB":
      return { ...state, activeTab: action.tab };
    case "SET_COHORTS":
      return { ...state, cohorts: action.cohorts };
    case "SET_SEARCH_QUERY":
      return { ...state, searchQuery: action.query };
    case "SET_SELECTED_COHORT_ID":
      return { ...state, selectedCohortId: action.cohortId };
    case "SET_ADD_GROUP_COHORT_ID":
      return { ...state, addGroupCohortId: action.cohortId };
    case "SET_ADD_GROUP_ID":
      return { ...state, addGroupId: action.groupId };
    case "SET_ADD_GROUP_OPTIONS":
      return { ...state, addGroupOptions: action.options };

    // Search
    case "SEARCH_START":
      return { ...state, isSearching: true, error: null };
    case "SEARCH_SUCCESS":
      return { ...state, isSearching: false, searchResults: action.results };
    case "SEARCH_ERROR":
      return { ...state, isSearching: false, error: action.error, searchResults: [] };
    case "SEARCH_CLEAR":
      return { ...state, searchResults: [], isSearching: false };

    // Select user
    case "SELECT_USER_START":
      return { ...state, isLoadingUser: true, error: null, syncMessage: null };
    case "SELECT_USER_SUCCESS":
      return { ...state, isLoadingUser: false, selectedUser: action.user };
    case "SELECT_USER_ERROR":
      return { ...state, isLoadingUser: false, selectedUser: null, error: action.error };

    // Sync user group (START clears lastGroupResult but NOT lastCohortResult)
    case "SYNC_USER_GROUP_START":
      return { ...state, isSyncing: true, syncMessage: null, error: null, lastGroupResult: null };
    case "SYNC_USER_GROUP_SUCCESS":
      return {
        ...state,
        isSyncing: false,
        syncMessage: action.message,
        lastGroupResult: { groupId: action.groupId, result: action.result, operationType: "sync" },
      };
    case "SYNC_USER_GROUP_ERROR":
      return { ...state, isSyncing: false, error: action.error };

    // Add to group
    case "ADD_TO_GROUP_START":
      return { ...state, isAddingToGroup: true, syncMessage: null, error: null };
    case "ADD_TO_GROUP_SUCCESS":
      return {
        ...state,
        isAddingToGroup: false,
        selectedUser: action.user,
        syncMessage: action.message,
        addGroupCohortId: null,
        addGroupId: null,
      };
    case "ADD_TO_GROUP_ERROR":
      return { ...state, isAddingToGroup: false, error: action.error };

    // Load groups
    case "LOAD_GROUPS_START":
      return { ...state, loadingGroups: true, error: null };
    case "LOAD_GROUPS_SUCCESS":
      return { ...state, loadingGroups: false, groups: action.groups };
    case "LOAD_GROUPS_ERROR":
      return { ...state, loadingGroups: false, groups: [], error: action.error };

    // Cohort sync (START clears BOTH results)
    case "SYNC_COHORT_START":
      return {
        ...state,
        cohortSyncing: true,
        syncMessage: null,
        error: null,
        lastCohortResult: null,
        lastGroupResult: null,
      };
    case "SYNC_COHORT_SUCCESS":
      return {
        ...state,
        cohortSyncing: false,
        syncMessage: action.message,
        lastCohortResult: { result: action.result, operationType: "sync" },
      };
    case "SYNC_COHORT_ERROR":
      return { ...state, cohortSyncing: false, error: action.error };

    // Cohort realize (START clears BOTH results)
    case "REALIZE_COHORT_START":
      return {
        ...state,
        cohortRealizing: true,
        syncMessage: null,
        error: null,
        lastCohortResult: null,
        lastGroupResult: null,
      };
    case "REALIZE_COHORT_SUCCESS":
      return {
        ...state,
        cohortRealizing: false,
        syncMessage: action.message,
        lastCohortResult: { result: action.result, operationType: "realize" },
        groups: action.groups,
      };
    case "REALIZE_COHORT_ERROR":
      return { ...state, cohortRealizing: false, error: action.error };

    // Per-group sync (START clears BOTH results)
    case "SYNC_GROUP_START":
      return {
        ...state,
        groupSyncing: { ...state.groupSyncing, [action.groupId]: true },
        syncMessage: null,
        error: null,
        lastGroupResult: null,
        lastCohortResult: null,
      };
    case "SYNC_GROUP_SUCCESS":
      return {
        ...state,
        groupSyncing: { ...state.groupSyncing, [action.groupId]: false },
        syncMessage: action.message,
        lastGroupResult: { groupId: action.groupId, result: action.result, operationType: "sync" },
      };
    case "SYNC_GROUP_ERROR":
      return {
        ...state,
        groupSyncing: { ...state.groupSyncing, [action.groupId]: false },
        error: action.error,
      };

    // Per-group realize (START clears BOTH results)
    case "REALIZE_GROUP_START":
      return {
        ...state,
        groupRealizing: { ...state.groupRealizing, [action.groupId]: true },
        syncMessage: null,
        error: null,
        lastGroupResult: null,
        lastCohortResult: null,
      };
    case "REALIZE_GROUP_SUCCESS":
      return {
        ...state,
        groupRealizing: { ...state.groupRealizing, [action.groupId]: false },
        syncMessage: action.message,
        lastGroupResult: { groupId: action.groupId, result: action.result, operationType: "realize" },
        groups: action.groups,
      };
    case "REALIZE_GROUP_ERROR":
      return {
        ...state,
        groupRealizing: { ...state.groupRealizing, [action.groupId]: false },
        error: action.error,
      };

    default:
      return state;
  }
}
