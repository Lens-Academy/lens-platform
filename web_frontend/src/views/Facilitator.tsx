import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useAuth } from "../hooks/useAuth";
import { API_URL } from "../config";
import { fetchWithRefresh } from "../api/fetchWithRefresh";
import { Skeleton, SkeletonText } from "../components/Skeleton";
import { Check, ChevronDown, ChevronRight, Clock, MessageCircle, Minus, X } from "lucide-react";
import type {
  FacilitatorGroup,
  GroupMember,
  UserProgress,
  ChatSession,
  MeetingAttendance,
  ModuleProgress,
  ModuleStats,
  TimelineData,
  TimelineItem,
} from "../types/facilitator";

// --- Utilities ---

function fmtDuration(seconds: number): string {
  if (seconds < 60) return "<1min";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}min` : `${h}h`;
  return `${m}min`;
}

function fmtTimeAgo(iso: string | null): { text: string; color: string } {
  if (!iso) return { text: "Never", color: "text-slate-400" };
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(ms / 86_400_000);
  if (hours < 1) return { text: "Now", color: "text-emerald-600" };
  if (hours < 24) return { text: `${hours}h`, color: "text-emerald-600" };
  if (days < 3) return { text: `${days}d`, color: "text-slate-600" };
  if (days < 7) return { text: `${days}d`, color: "text-amber-600" };
  return { text: `${days}d`, color: "text-red-600" };
}

function attendColor(attended: number, occurred: number): string {
  if (occurred === 0) return "text-slate-400";
  const rate = attended / occurred;
  if (rate >= 0.8) return "text-emerald-700 font-medium";
  if (rate >= 0.5) return "text-amber-700";
  return "text-red-700";
}

function statusBadge(status: string) {
  const styles: Record<string, string> = {
    completed: "bg-emerald-100 text-emerald-800",
    in_progress: "bg-amber-100 text-amber-800",
    not_started: "bg-slate-100 text-slate-500",
  };
  const labels: Record<string, string> = {
    completed: "Done",
    in_progress: "In progress",
    not_started: "Not started",
  };
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-medium leading-none ${styles[status] || styles.not_started}`}
    >
      {labels[status] || status}
    </span>
  );
}

// --- Small components ---

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="px-3 py-2 bg-white rounded-lg border border-slate-200">
      <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
        {label}
      </div>
      <div className="text-lg font-semibold text-slate-900 leading-tight mt-0.5">
        {value}
        {sub && (
          <span className="text-sm font-normal text-slate-400 ml-1">
            {sub}
          </span>
        )}
      </div>
    </div>
  );
}

function ExtLink({ className = "w-3 h-3" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
      />
    </svg>
  );
}

// --- Main ---

export default function Facilitator() {
  const { isAuthenticated, isLoading: authLoading, user, login } = useAuth();

  const [groups, setGroups] = useState<FacilitatorGroup[]>([]);
  const [discordServerId, setDiscordServerId] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [userProgress, setUserProgress] = useState<UserProgress | null>(null);
  const [userChats, setUserChats] = useState<ChatSession[]>([]);
  const [userMeetings, setUserMeetings] = useState<MeetingAttendance[]>([]);
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [membersLoading, setMembersLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Group-level aggregate stats
  const stats = useMemo(() => {
    if (members.length === 0) return null;
    const withMtgs = members.filter((m) => m.meetings_occurred > 0);
    const avgAtt =
      withMtgs.length > 0
        ? withMtgs.reduce(
            (s, m) => s + m.meetings_attended / m.meetings_occurred,
            0,
          ) / withMtgs.length
        : null;
    const active7d = members.filter((m) => {
      if (!m.last_active_at) return false;
      return Date.now() - new Date(m.last_active_at).getTime() < 7 * 86_400_000;
    }).length;
    const totalAi = members.reduce((s, m) => s + m.ai_message_count, 0);
    return { avgAtt, active7d, totalAi };
  }, [members]);

  // Group modules into units by due_by_meeting, paired with meeting data
  const units = useMemo(() => {
    if (!userProgress) return [];

    const unitMap = new Map<
      number | null,
      { modules: ModuleProgress[]; meeting: MeetingAttendance | null }
    >();

    for (const mod of userProgress.modules) {
      const key = mod.due_by_meeting;
      if (!unitMap.has(key)) {
        const meeting =
          key !== null
            ? userMeetings.find((m) => m.meeting_number === key) ?? null
            : null;
        unitMap.set(key, { modules: [], meeting });
      }
      unitMap.get(key)!.modules.push(mod);
    }

    return [...unitMap.entries()]
      .sort(([a], [b]) => (a ?? 999) - (b ?? 999))
      .map(([meetingNum, data]) => ({
        meetingNumber: meetingNum,
        ...data,
      }));
  }, [userProgress, userMeetings]);

  // Current unit = homework due at the next upcoming meeting
  const currentUnitNumber = useMemo(() => {
    const now = new Date();
    const upcoming = userMeetings.find(
      (m) => new Date(m.scheduled_at) > now && m.meeting_number !== null,
    );
    if (upcoming?.meeting_number) return upcoming.meeting_number;
    // All meetings past: show last unit's homework
    const past = userMeetings.filter(
      (m) => new Date(m.scheduled_at) <= now && m.meeting_number !== null,
    );
    if (past.length > 0) {
      return Math.max(...past.map((m) => m.meeting_number ?? 0));
    }
    return 1;
  }, [userMeetings]);

  // --- Data fetching ---

  useEffect(() => {
    if (!user) return;
    (async () => {
      setError(null);
      try {
        const res = await fetchWithRefresh(
          `${API_URL}/api/facilitator/groups`,
          { credentials: "include" },
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
        setDiscordServerId(data.discord_server_id || "");
        if (data.groups.length > 0) {
          setSelectedGroupId(data.groups[0].group_id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    })();
  }, [user]);

  useEffect(() => {
    if (!selectedGroupId) return;
    (async () => {
      setMembersLoading(true);
      try {
        const [membersRes, timelineRes] = await Promise.all([
          fetchWithRefresh(
            `${API_URL}/api/facilitator/groups/${selectedGroupId}/members`,
            { credentials: "include" },
          ),
          fetchWithRefresh(
            `${API_URL}/api/facilitator/groups/${selectedGroupId}/timeline`,
            { credentials: "include" },
          ),
        ]);
        if (!membersRes.ok) throw new Error("Failed to fetch members");
        const membersData = await membersRes.json();
        setMembers(membersData.members);
        if (timelineRes.ok) {
          setTimeline(await timelineRes.json());
        }
        setSelectedUserId(null);
        setUserProgress(null);
        setUserChats([]);
        setUserMeetings([]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setMembersLoading(false);
      }
    })();
  }, [selectedGroupId]);

  useEffect(() => {
    if (!selectedGroupId || !selectedUserId) return;
    (async () => {
      setDetailLoading(true);
      try {
        const [progressRes, chatsRes, meetingsRes] = await Promise.all([
          fetchWithRefresh(
            `${API_URL}/api/facilitator/groups/${selectedGroupId}/users/${selectedUserId}/progress`,
            { credentials: "include" },
          ),
          fetchWithRefresh(
            `${API_URL}/api/facilitator/groups/${selectedGroupId}/users/${selectedUserId}/chats`,
            { credentials: "include" },
          ),
          fetchWithRefresh(
            `${API_URL}/api/facilitator/groups/${selectedGroupId}/users/${selectedUserId}/meetings`,
            { credentials: "include" },
          ),
        ]);
        if (!progressRes.ok || !chatsRes.ok || !meetingsRes.ok) {
          throw new Error("Failed to fetch user details");
        }
        setUserProgress(await progressRes.json());
        setUserChats((await chatsRes.json()).chats);
        setUserMeetings((await meetingsRes.json()).meetings);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setDetailLoading(false);
      }
    })();
  }, [selectedGroupId, selectedUserId]);

  // --- Guards ---

  if (authLoading) {
    return (
      <div className="py-6">
        <Skeleton variant="rectangular" className="h-8 w-48 mb-4" />
        <SkeletonText lines={3} />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="py-8">
        <h1 className="text-2xl font-bold mb-4">Facilitator Panel</h1>
        <p className="mb-4">Please sign in to access the facilitator panel.</p>
        <button
          onClick={login}
          className="bg-slate-900 text-white px-4 py-2 rounded-lg hover:bg-slate-800 transition-colors"
        >
          Sign in with Discord
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-8">
        <h1 className="text-2xl font-bold mb-4">Facilitator Panel</h1>
        <div className="text-red-600">{error}</div>
      </div>
    );
  }

  // --- Derived ---

  const selectedGroup = groups.find((g) => g.group_id === selectedGroupId);
  const selectedMember = members.find((m) => m.user_id === selectedUserId);
  const groupChannelUrl =
    selectedGroup?.discord_text_channel_id && discordServerId
      ? `https://discord.com/channels/${discordServerId}/${selectedGroup.discord_text_channel_id}`
      : null;

  // --- Render ---

  return (
    <div className="py-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <h1 className="text-xl font-bold text-slate-900">
            Facilitator Panel
          </h1>
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 uppercase tracking-wide">
            {isAdmin ? "Admin" : "Facilitator"}
          </span>
        </div>
        {groupChannelUrl && (
          <a
            href={groupChannelUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
          >
            Message group <ExtLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>

      {/* Group Tabs */}
      {groups.length > 1 && (
        <div className="flex gap-1 mb-3 overflow-x-auto scrollbar-hide -mx-1 px-1">
          {groups.map((g) => (
            <button
              key={g.group_id}
              onClick={() => setSelectedGroupId(g.group_id)}
              className={`px-3 py-1.5 text-sm rounded-lg whitespace-nowrap transition-colors ${
                selectedGroupId === g.group_id
                  ? "bg-slate-900 text-white font-medium"
                  : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"
              }`}
            >
              {g.group_name}
              <span className="ml-1.5 text-xs opacity-60">{g.cohort_name}</span>
            </button>
          ))}
        </div>
      )}

      {/* Summary Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          <StatCard label="Members" value={String(members.length)} />
          <StatCard
            label="Avg Attendance"
            value={
              stats.avgAtt !== null
                ? `${Math.round(stats.avgAtt * 100)}%`
                : "—"
            }
          />
          <StatCard
            label="Active (7d)"
            value={String(stats.active7d)}
            sub={`/ ${members.length}`}
          />
          <StatCard
            label="AI Messages"
            value={String(stats.totalAi)}
            sub="total"
          />
        </div>
      )}

      {/* Master-Detail Layout */}
      <div className="lg:flex lg:gap-4 items-start">
        {/* Left: Members Table */}
        <div className="flex-1 min-w-0 mb-4 lg:mb-0">
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            {membersLoading && (
              <div className="h-0.5 bg-indigo-100 overflow-hidden">
                <div className="h-full w-full bg-indigo-500 animate-pulse" />
              </div>
            )}
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80">
                  <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="text-right px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    Attend.
                  </th>
                  <th className="text-right px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    Sections
                  </th>
                  <th className="text-right px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider hidden sm:table-cell">
                    AI
                  </th>
                  <th className="text-right px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider hidden sm:table-cell">
                    Time
                  </th>
                  <th className="text-right px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    Active
                  </th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const active = fmtTimeAgo(m.last_active_at);
                  const sel = selectedUserId === m.user_id;
                  return (
                    <tr
                      key={m.user_id}
                      onClick={() => setSelectedUserId(m.user_id)}
                      className={`border-b border-slate-100 last:border-0 cursor-pointer transition-colors ${
                        sel
                          ? "bg-indigo-50/80"
                          : "hover:bg-slate-50/80"
                      }`}
                    >
                      <td className="px-3 py-2 font-medium text-slate-900 truncate max-w-[180px]">
                        {m.name}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {m.meetings_occurred > 0 ? (
                          <span
                            className={attendColor(
                              m.meetings_attended,
                              m.meetings_occurred,
                            )}
                          >
                            {m.meetings_attended}/{m.meetings_occurred}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {m.sections_completed}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700 hidden sm:table-cell">
                        {m.ai_message_count || (
                          <span className="text-slate-300">0</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600 hidden sm:table-cell">
                        {fmtDuration(m.total_time_seconds)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${active.color}`}
                      >
                        {active.text}
                      </td>
                    </tr>
                  );
                })}
                {members.length === 0 && !membersLoading && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-8 text-center text-slate-400 text-sm"
                    >
                      No members in this group
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: User Detail Panel */}
        {detailLoading ? (
          <div className="lg:w-[400px] lg:shrink-0">
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <Skeleton variant="text" className="h-5 w-32 mb-4" />
              <SkeletonText lines={8} />
            </div>
          </div>
        ) : selectedUserId && selectedMember ? (
          <div className="lg:w-[400px] lg:shrink-0">
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              {/* Header */}
              <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-slate-900">
                    {selectedMember.name}
                  </h2>
                  {selectedMember.discord_id && (
                    <a
                      href={`https://discord.com/users/${selectedMember.discord_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
                    >
                      DM <ExtLink />
                    </a>
                  )}
                </div>
                {/* Inline stats */}
                <div className="flex gap-4 mt-1.5 text-xs text-slate-500">
                  <span>
                    <span className="font-semibold text-slate-700 tabular-nums">
                      {selectedMember.sections_completed}
                    </span>{" "}
                    sections
                  </span>
                  <span>
                    <span className="font-semibold text-slate-700 tabular-nums">
                      {fmtDuration(selectedMember.total_time_seconds)}
                    </span>{" "}
                    spent
                  </span>
                  <span>
                    <span className="font-semibold text-slate-700 tabular-nums">
                      {selectedMember.ai_message_count}
                    </span>{" "}
                    AI msgs
                  </span>
                </div>
              </div>

              {/* Unit-based progress (modules grouped by week, merged with meeting data) */}
              <div className="divide-y divide-slate-100">
                {units.length > 0 ? (
                  units.map((unit) => {
                    const isCurrent =
                      unit.meetingNumber === currentUnitNumber;
                    const mtg = unit.meeting;
                    const isPastMeeting =
                      mtg && new Date(mtg.scheduled_at) < new Date();
                    const unitCompleted =
                      unit.modules.length > 0 &&
                      unit.modules.every((m) => m.status === "completed");
                    const unitSections = unit.modules.reduce(
                      (s, m) => s + m.completed_count,
                      0,
                    );
                    const unitTotal = unit.modules.reduce(
                      (s, m) => s + m.total_count,
                      0,
                    );
                    const unitPct =
                      unitTotal > 0
                        ? Math.round((unitSections / unitTotal) * 100)
                        : 0;

                    return (
                      <details
                        key={unit.meetingNumber ?? "extra"}
                        open={isCurrent}
                        className="group/unit"
                      >
                        {/* Unit header */}
                        <summary
                          className={`px-4 py-2.5 cursor-pointer hover:bg-slate-50 transition-colors flex items-center gap-2 ${
                            isCurrent ? "bg-indigo-50/60" : ""
                          }`}
                        >
                          <svg
                            className="w-3 h-3 text-slate-400 transition-transform group-open/unit:rotate-90 shrink-0"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path d="M6 6l4 4-4 4V6z" />
                          </svg>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span
                                  className={`text-sm font-medium ${isCurrent ? "text-indigo-900" : "text-slate-800"}`}
                                >
                                  {unit.meetingNumber !== null
                                    ? `Unit ${unit.meetingNumber}`
                                    : "Additional"}
                                </span>
                                {isCurrent && (
                                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 uppercase tracking-wide">
                                    Current
                                  </span>
                                )}
                                {/* Meeting attendance inline */}
                                {mtg && (
                                  <span className="text-xs text-slate-400 shrink-0">
                                    {new Date(
                                      mtg.scheduled_at,
                                    ).toLocaleDateString(undefined, {
                                      month: "short",
                                      day: "numeric",
                                    })}
                                    {isPastMeeting && (
                                      <span
                                        className={`ml-1 ${
                                          mtg.checked_in_at
                                            ? "text-emerald-600"
                                            : "text-red-500"
                                        }`}
                                      >
                                        {mtg.checked_in_at
                                          ? "\u2713 attended"
                                          : "\u2717 missed"}
                                      </span>
                                    )}
                                  </span>
                                )}
                              </div>
                              <span className="text-xs text-slate-500 tabular-nums shrink-0">
                                {unitCompleted ? (
                                  <span className="text-emerald-600 font-medium">
                                    Done
                                  </span>
                                ) : (
                                  `${unitPct}%`
                                )}
                              </span>
                            </div>
                            {/* Unit progress bar */}
                            <div className="w-full h-1 bg-slate-200 rounded-full mt-1.5">
                              <div
                                className={`h-1 rounded-full transition-all ${
                                  unitPct === 100
                                    ? "bg-emerald-500"
                                    : isCurrent
                                      ? "bg-indigo-500"
                                      : unitPct > 0
                                        ? "bg-slate-400"
                                        : "bg-slate-200"
                                }`}
                                style={{ width: `${unitPct}%` }}
                              />
                            </div>
                          </div>
                        </summary>

                        {/* Unit content — expanded */}
                        <div
                          className={`px-4 pb-3 ${isCurrent ? "bg-indigo-50/30" : ""}`}
                        >
                          {unit.modules.map((mod) => {
                            const chatsForModule = userChats.filter(
                              (c) => c.module_slug === mod.slug,
                            );

                            return isCurrent ? (
                              /* Current unit: show full section detail */
                              <div
                                key={mod.slug}
                                className="mt-2 first:mt-1"
                              >
                                <div className="flex items-center justify-between gap-2 mb-1">
                                  <span className="text-sm font-medium text-slate-800 truncate">
                                    {mod.title}
                                  </span>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {statusBadge(mod.status)}
                                    <span className="text-xs text-slate-500 tabular-nums">
                                      {mod.completed_count}/{mod.total_count}
                                    </span>
                                  </div>
                                </div>
                                {/* Per-section progress */}
                                <div className="space-y-0.5 text-xs ml-0.5">
                                  {mod.sections.map((s) => (
                                    <div
                                      key={s.content_id}
                                      className="flex justify-between py-0.5"
                                    >
                                      <span
                                        className={
                                          s.completed
                                            ? "text-emerald-700"
                                            : "text-slate-500"
                                        }
                                      >
                                        {s.completed ? "\u2713" : "\u2013"}{" "}
                                        {s.title}
                                        <span className="text-slate-400 ml-1">
                                          ({s.type})
                                        </span>
                                      </span>
                                      <span className="text-slate-400 tabular-nums shrink-0 ml-2">
                                        {fmtDuration(s.time_spent_seconds)}
                                      </span>
                                    </div>
                                  ))}
                                  {chatsForModule.map((chat) => (
                                    <details
                                      key={chat.session_id}
                                      className="mt-1 border-t border-slate-200/60 pt-1"
                                    >
                                      <summary className="text-slate-600 cursor-pointer hover:text-slate-900 transition-colors">
                                        Chat ({chat.messages.length}{" "}
                                        messages)
                                        {chat.is_archived && (
                                          <span className="text-slate-400 ml-1">
                                            (archived)
                                          </span>
                                        )}
                                      </summary>
                                      {chat.messages.length > 0 && (
                                        <div className="max-h-48 overflow-y-auto mt-1 bg-white/80 rounded border border-slate-200 p-2 space-y-1">
                                          {chat.messages.map((msg, i) => (
                                            <div
                                              key={i}
                                              className={
                                                msg.role === "user"
                                                  ? "text-indigo-800"
                                                  : "text-slate-600"
                                              }
                                            >
                                              <span className="font-medium capitalize">
                                                {msg.role}:
                                              </span>{" "}
                                              {msg.content}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </details>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              /* Past/future units: compact module row */
                              <details key={mod.slug} className="group/mod">
                                <summary className="flex items-center gap-2 py-1 mt-1 first:mt-0.5 cursor-pointer hover:bg-slate-50 rounded -mx-1.5 px-1.5 transition-colors">
                                  <svg
                                    className="w-2.5 h-2.5 text-slate-400 transition-transform group-open/mod:rotate-90 shrink-0"
                                    fill="currentColor"
                                    viewBox="0 0 20 20"
                                  >
                                    <path d="M6 6l4 4-4 4V6z" />
                                  </svg>
                                  <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                                    <span className="text-sm text-slate-700 truncate">
                                      {mod.title}
                                    </span>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      {statusBadge(mod.status)}
                                      <span className="text-xs text-slate-500 tabular-nums">
                                        {mod.completed_count}/
                                        {mod.total_count}
                                      </span>
                                    </div>
                                  </div>
                                </summary>
                                <div className="ml-5 mt-0.5 mb-1.5 space-y-0.5 text-xs">
                                  {mod.sections.map((s) => (
                                    <div
                                      key={s.content_id}
                                      className="flex justify-between py-0.5"
                                    >
                                      <span
                                        className={
                                          s.completed
                                            ? "text-emerald-700"
                                            : "text-slate-500"
                                        }
                                      >
                                        {s.completed ? "\u2713" : "\u2013"}{" "}
                                        {s.title}
                                      </span>
                                      <span className="text-slate-400 tabular-nums shrink-0 ml-2">
                                        {fmtDuration(s.time_spent_seconds)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            );
                          })}
                        </div>
                      </details>
                    );
                  })
                ) : (
                  <div className="px-4 py-6 text-center">
                    <p className="text-sm text-slate-400">
                      No progress recorded
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="hidden lg:block lg:w-[400px] lg:shrink-0">
            <div className="border border-dashed border-slate-300 rounded-lg p-8 text-center">
              <p className="text-sm text-slate-400">
                Select a member to view details
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Progress Timeline */}
      {timeline &&
        timeline.timeline_items.length > 0 &&
        timeline.members.length > 0 && (
          <div className="mt-6">
            <h2 className="text-sm font-semibold text-slate-700 mb-2">
              Progress Timeline
            </h2>
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-max min-w-full">
                  {/* Header: unit markers */}
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="sticky left-0 z-10 bg-slate-50 px-3 py-1.5 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider min-w-[120px]">
                        Name
                      </th>
                      <th className="px-2 py-1.5">
                        <TimelineHeader items={timeline.timeline_items} />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {timeline.members.map((tm) => {
                      const completedSet = new Set(tm.completed_ids);
                      return (
                        <tr
                          key={tm.user_id}
                          className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50"
                        >
                          <td className="sticky left-0 z-10 bg-white px-3 py-1.5 text-sm font-medium text-slate-900 truncate max-w-[160px]">
                            {tm.name}
                          </td>
                          <td className="px-2 py-1">
                            <TimelineRow
                              items={timeline.timeline_items}
                              completedSet={completedSet}
                              meetings={tm.meetings}
                              moduleStats={tm.module_stats}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

      {/* Vertical Progress Timeline */}
      {timeline &&
        timeline.timeline_items.length > 0 &&
        timeline.members.length > 0 && (
          <div className="mt-6">
            <h2 className="text-sm font-semibold text-slate-700 mb-2">
              Progress Timeline (Vertical)
            </h2>
            <VerticalTimeline timeline={timeline} />
          </div>
        )}
    </div>
  );
}

// --- Timeline subcomponents ---

/** Group flat timeline items into segments: consecutive sections of same module, or meetings. */
interface TimelineSegment {
  type: "module" | "meeting";
  items: TimelineItem[];
  slug?: string;
  meetingNumber?: number;
}

function buildSegments(items: TimelineItem[]): TimelineSegment[] {
  const segs: TimelineSegment[] = [];
  for (const item of items) {
    if (item.type === "meeting") {
      segs.push({
        type: "meeting",
        items: [item],
        meetingNumber: item.number,
      });
    } else {
      const last = segs[segs.length - 1];
      if (last?.type === "module" && last.slug === item.module_slug) {
        last.items.push(item);
      } else {
        segs.push({
          type: "module",
          items: [item],
          slug: item.module_slug,
        });
      }
    }
  }
  return segs;
}

function TimelineHeader({ items }: { items: TimelineItem[] }) {
  const segs = useMemo(() => buildSegments(items), [items]);
  return (
    <div className="flex items-end gap-0">
      {segs.map((seg, i) => {
        if (seg.type === "meeting") {
          return (
            <div
              key={i}
              className="w-5 flex items-center justify-center shrink-0"
            >
              <span className="text-[9px] font-semibold text-slate-500">
                {seg.meetingNumber}
              </span>
            </div>
          );
        }
        // Module segment: one spacer per dot + gaps
        const dotCount = seg.items.length;
        // width = dots*8 + gaps*(dotCount-1)*3 + 2px inter-module gap
        const w = dotCount * 8 + (dotCount - 1) * 3 + (i > 0 ? 2 : 0);
        return <span key={i} className="shrink-0" style={{ width: w }} />;
      })}
    </div>
  );
}

function TimelineRow({
  items,
  completedSet,
  meetings,
  moduleStats,
}: {
  items: TimelineItem[];
  completedSet: Set<string>;
  meetings: Record<string, "attended" | "missed">;
  moduleStats: Record<string, ModuleStats>;
}) {
  const segs = useMemo(() => buildSegments(items), [items]);

  return (
    <div>
      {/* Dots row */}
      <div className="flex items-center gap-0">
        {segs.map((seg, si) => {
          if (seg.type === "meeting") {
            const status = meetings[String(seg.meetingNumber)];
            const color = status
              ? status === "attended"
                ? "bg-emerald-500"
                : "bg-red-400"
              : "bg-slate-200";
            return (
              <div key={si} className="w-5 flex items-center justify-center shrink-0">
                <span
                  className={`w-3.5 h-3.5 rounded-full border-2 border-white ${color}`}
                  title={`Meeting ${seg.meetingNumber}: ${status || "upcoming"}`}
                />
              </div>
            );
          }

          return (
            <div
              key={si}
              className={`flex items-center gap-[3px] shrink-0 ${si > 0 ? "ml-0.5" : ""}`}
            >
              {seg.items.map((item, ii) => {
                const done = item.content_id
                  ? completedSet.has(item.content_id)
                  : false;
                return (
                  <span
                    key={ii}
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      done ? "bg-emerald-500" : "bg-slate-200"
                    }`}
                    title={item.module_slug || ""}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
      {/* Per-module annotation row */}
      <div className="flex items-center gap-0 mt-px">
        {segs.map((seg, si) => {
          if (seg.type === "meeting") {
            return <span key={si} className="w-5 shrink-0" />;
          }
          const dotCount = seg.items.length;
          const w = dotCount * 8 + (dotCount - 1) * 3;
          const stats = seg.slug ? moduleStats[seg.slug] : undefined;
          const hasData = stats && (stats.time_seconds > 0 || stats.chat_count > 0);
          return (
            <div
              key={si}
              className={`shrink-0 overflow-hidden ${si > 0 ? "ml-0.5" : ""}`}
              style={{ width: w }}
            >
              {hasData ? (
                <div className="text-[10px] leading-tight text-slate-600 tabular-nums whitespace-nowrap">
                  {stats.time_seconds > 0 && (
                    <div>{fmtDuration(stats.time_seconds)}</div>
                  )}
                  {stats.chat_count > 0 && (
                    <div>
                      {stats.chat_count}
                      {"\uD83D\uDCAC"}
                    </div>
                  )}
                </div>
              ) : (
                <span className="text-[10px] leading-tight">&nbsp;</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Vertical timeline ---

/** Animated section titles column for the vertical timeline. */
function SectionTitlesColumn({
  segs,
  expanded,
  onToggle,
  moduleH,
  mtgH,
  dotH,
}: {
  segs: TimelineSegment[];
  expanded: boolean;
  onToggle: () => void;
  moduleH: (n: number) => number;
  mtgH: number;
  dotH: number;
}) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [contentWidth, setContentWidth] = useState(0);

  // Measure natural width of expanded content
  useEffect(() => {
    if (innerRef.current) {
      // Temporarily make visible to measure
      const el = innerRef.current;
      el.style.width = "auto";
      el.style.position = "absolute";
      el.style.visibility = "hidden";
      const w = el.scrollWidth;
      el.style.width = "";
      el.style.position = "";
      el.style.visibility = "";
      if (w > 0) setContentWidth(w);
    }
  }, [segs]);

  const BUTTON_W = 20;
  const MAX_TITLES_W = 180;
  const animatedWidth = expanded ? Math.min(Math.max(contentWidth, 60) + BUTTON_W, MAX_TITLES_W) : BUTTON_W;

  return (
    <div
      className="shrink-0 border-r border-slate-200 overflow-hidden"
      style={{
        width: animatedWidth,
        transition: "width 200ms ease-in-out",
      }}
    >
      <div className="h-10 border-b border-slate-200 flex items-center justify-center" style={{ width: BUTTON_W }}>
        <button
          className="text-[10px] text-slate-400 hover:text-slate-600 cursor-pointer px-1"
          onClick={onToggle}
          title={expanded ? "Collapse sections" : "Expand sections"}
        >
          {expanded ? "›‹" : "‹›"}
        </button>
      </div>
      <div ref={innerRef}>
        {segs.map((seg, si) => {
          if (seg.type === "meeting") {
            return <div key={si} style={{ height: mtgH }} />;
          }
          return (
            <div
              key={si}
              className="overflow-hidden flex flex-col justify-center"
              style={{ height: moduleH(seg.items.length) }}
            >
              {seg.items.map((item, ii) => (
                <div
                  key={ii}
                  className="flex items-center"
                  style={{ height: dotH, paddingLeft: BUTTON_W, paddingRight: 8 }}
                >
                  <span
                    className="text-[9px] text-slate-400 whitespace-nowrap leading-none"
                    style={{
                      opacity: expanded ? 1 : 0,
                      transition: "opacity 200ms ease-in-out",
                    }}
                  >
                    {item.title || "Untitled"}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Column-based vertical timeline with tight dot clusters and inline stats. */
function VerticalTimeline({ timeline }: { timeline: TimelineData }) {
  const segs = useMemo(
    () => buildSegments(timeline.timeline_items),
    [timeline.timeline_items],
  );
  const [sectionsExpanded, setSectionsExpanded] = useState(false);

  // Pixel constants — shared across label + member columns for alignment
  const DOT_H = 10; // height per dot row (dot 8px + 2px gap)
  const V_PAD = 4; // vertical padding above/below every element (module or meeting)
  const DOT_COL = 14; // fixed dot column width (fits 14px meeting dot)
  const moduleH = (n: number) => n * DOT_H + V_PAD * 2;
  const mtgH = 12 + V_PAD * 2; // 12px dot + symmetric padding

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <div className="inline-flex min-w-full">
          {/* Left labels column */}
          <div className="shrink-0 sticky left-0 z-10 bg-white border-r border-slate-200">
            <div className="h-10 border-b border-slate-200" />
            {segs.map((seg, si) =>
              seg.type === "meeting" ? (
                <div
                  key={si}
                  className="px-2 flex items-center"
                  style={{ height: mtgH }}
                >
                  <span className="text-[10px] font-semibold text-slate-600">
                    Meeting {seg.meetingNumber}
                  </span>
                </div>
              ) : (
                <div
                  key={si}
                  className="px-2 flex items-center overflow-hidden"
                  style={{ height: moduleH(seg.items.length) }}
                >
                  <span className="text-[10px] text-slate-500 truncate max-w-[100px] leading-tight">
                    {seg.slug?.replace(/-/g, " ")}
                  </span>
                </div>
              ),
            )}
          </div>

          {/* Section titles column — always present, animates between collapsed/expanded */}
          <SectionTitlesColumn
            segs={segs}
            expanded={sectionsExpanded}
            onToggle={() => setSectionsExpanded((v) => !v)}
            moduleH={moduleH}
            mtgH={mtgH}
            dotH={DOT_H}
          />

          {/* Member columns */}
          {timeline.members.map((tm) => {
            const completedSet = new Set(tm.completed_ids);
            const sectionTimes = tm.section_times ?? {};
            const sectionChats = tm.section_chats ?? {};
            return (
              <div key={tm.user_id} className="shrink-0">
                {/* Name */}
                <div className="h-10 border-b border-slate-200 px-1 flex items-end pb-1">
                  <span
                    className="text-[10px] font-medium text-slate-700 leading-tight line-clamp-2"
                    title={tm.name}
                  >
                    {tm.name}
                  </span>
                </div>

                {/* Segments */}
                {segs.map((seg, si) => {
                  if (seg.type === "meeting") {
                    const status =
                      tm.meetings[String(seg.meetingNumber)];
                    const rsvp =
                      (tm.rsvps ?? {})[String(seg.meetingNumber)];
                    const color = status
                      ? status === "attended"
                        ? "bg-emerald-500"
                        : "bg-red-400"
                      : "bg-slate-200";
                    const rsvpIcon =
                      rsvp === "attending" ? (
                        <Check size={8} className="text-emerald-500" />
                      ) : rsvp === "not_attending" ? (
                        <X size={8} className="text-red-400" />
                      ) : rsvp === "tentative" ? (
                        <Minus size={8} className="text-amber-400" />
                      ) : null;
                    return (
                      <div
                        key={si}
                        className="flex items-center overflow-hidden"
                        style={{ height: mtgH }}
                      >
                        <span className="shrink-0 flex items-center justify-center" style={{ width: DOT_COL }}>
                          <span
                            className={`w-3 h-3 rounded-full ${color}`}
                            title={`Meeting ${seg.meetingNumber}: ${status || "upcoming"}`}
                          />
                        </span>
                        {rsvpIcon && (
                          <span className="inline-flex items-center gap-px shrink-0 ml-1" title={`RSVP: ${rsvp}`}>
                            <span className="text-[8px] text-slate-400 leading-none">RSVP:</span>
                            {rsvpIcon}
                          </span>
                        )}
                      </div>
                    );
                  }

                  return (
                    <div
                      key={si}
                      className="overflow-hidden flex flex-col justify-center"
                      style={{ height: moduleH(seg.items.length) }}
                    >
                      {seg.items.map((item, ii) => {
                        const cid = item.content_id;
                        const done = cid ? completedSet.has(cid) : false;
                        const time = cid ? sectionTimes[cid] ?? 0 : 0;
                        const chatCount = cid ? sectionChats[cid] ?? 0 : 0;
                        return (
                          <div
                            key={ii}
                            className="flex items-center"
                            style={{ height: DOT_H }}
                          >
                            <span className="shrink-0 flex items-center justify-center" style={{ width: DOT_COL }}>
                              <span
                                className={`w-2 h-2 rounded-full ${
                                  done ? "bg-emerald-500" : "bg-slate-200"
                                }`}
                              />
                            </span>
                            <span className="inline-flex items-center justify-end gap-px shrink-0" style={{ width: 18 }}>
                              {time > 0 && (
                                <>
                                  <span className="text-[9px] text-slate-400 leading-none tabular-nums">
                                    {Math.round(time / 60)}
                                  </span>
                                  <Clock size={7} className="text-slate-400" />
                                </>
                              )}
                            </span>
                            <span className="inline-flex items-center justify-end gap-px shrink-0" style={{ width: 16 }}>
                              {chatCount > 0 && (
                                <>
                                  <span className="text-[9px] text-indigo-400 leading-none tabular-nums">
                                    {chatCount}
                                  </span>
                                  <MessageCircle size={7} className="text-indigo-400" />
                                </>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
