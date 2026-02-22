import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  forwardRef,
} from "react";
import { useAuth } from "../hooks/useAuth";
import { API_URL } from "../config";
import { fetchWithRefresh } from "../api/fetchWithRefresh";
import { Skeleton, SkeletonText } from "../components/Skeleton";
import { Check, Clock, MessageCircle, Minus, X } from "lucide-react";
import type {
  ChatSession,
  FacilitatorGroup,
  GroupMember,
  TimelineData,
  TimelineItem,
} from "../types/facilitator";

// --- Helpers ---

function formatLastActive(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// --- Small components ---

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
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [membersLoading, setMembersLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Chat panel state
  const [selectedChat, setSelectedChat] = useState<{
    userId: number;
    userName: string;
    moduleSlug: string;
    moduleTitle: string;
  } | null>(null);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const chatPanelRef = useRef<HTMLDivElement>(null);

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
    setSelectedChat(null); // close chat panel on group change
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
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setMembersLoading(false);
      }
    })();
  }, [selectedGroupId]);

  // Fetch chat sessions when selectedChat changes
  useEffect(() => {
    if (!selectedChat || !selectedGroupId) {
      setChatSessions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setChatLoading(true);
      try {
        const res = await fetchWithRefresh(
          `${API_URL}/api/facilitator/groups/${selectedGroupId}/users/${selectedChat.userId}/chats`,
          { credentials: "include" },
        );
        if (!res.ok) throw new Error("Failed to fetch chats");
        const data = await res.json();
        if (cancelled) return;
        const filtered = (data.chats as ChatSession[]).filter(
          (s) => s.module_slug === selectedChat.moduleSlug,
        );
        setChatSessions(filtered);
      } catch {
        if (!cancelled) setChatSessions([]);
      } finally {
        if (!cancelled) setChatLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedChat, selectedGroupId]);

  // Scroll chat panel into view when it opens
  useEffect(() => {
    if (selectedChat && chatPanelRef.current) {
      chatPanelRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [selectedChat, chatSessions]);

  const handleChatClick = useCallback(
    (
      userId: number,
      userName: string,
      moduleSlug: string,
      moduleTitle: string,
    ) => {
      setSelectedChat((prev) =>
        prev && prev.userId === userId && prev.moduleSlug === moduleSlug
          ? null // toggle off
          : { userId, userName, moduleSlug, moduleTitle },
      );
    },
    [],
  );

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
      {groups.length > 0 && (
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

      {/* Progress Timeline */}
      {membersLoading && (
        <div className="h-0.5 bg-indigo-100 overflow-hidden rounded-full mb-2">
          <div className="h-full w-full bg-indigo-500 animate-pulse" />
        </div>
      )}
      {timeline &&
        timeline.timeline_items.length > 0 &&
        timeline.members.length > 0 && (
          <VerticalTimeline
            timeline={timeline}
            memberDiscordIds={Object.fromEntries(
              members.map((m) => [m.user_id, m.discord_id]),
            )}
            memberLastActive={Object.fromEntries(
              members.map((m) => [m.user_id, m.last_active_at]),
            )}
            onChatClick={handleChatClick}
            selectedChat={selectedChat}
          />
        )}

      {/* Chat panel */}
      {selectedChat && (
        <ChatPanel
          ref={chatPanelRef}
          selectedChat={selectedChat}
          sessions={chatSessions}
          loading={chatLoading}
          onClose={() => setSelectedChat(null)}
        />
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
  const MAX_TITLES_W = 200;
  const animatedWidth = expanded
    ? Math.min(Math.max(contentWidth, 60) + BUTTON_W, MAX_TITLES_W)
    : BUTTON_W;

  return (
    <div
      className="shrink-0 border-r border-slate-200 overflow-hidden"
      style={{
        width: animatedWidth,
        transition: "width 200ms ease-in-out",
      }}
    >
      <div
        className="h-12 border-b border-slate-200 flex items-center justify-center"
        style={{ width: BUTTON_W }}
      >
        <button
          className="text-xs text-slate-400 hover:text-slate-600 cursor-pointer px-1"
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
                  style={{
                    height: dotH,
                    paddingLeft: BUTTON_W,
                    paddingRight: 8,
                  }}
                >
                  <span
                    className="text-[11px] text-slate-400 whitespace-nowrap leading-none"
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
function VerticalTimeline({
  timeline,
  memberDiscordIds,
  memberLastActive,
  onChatClick,
  selectedChat,
}: {
  timeline: TimelineData;
  memberDiscordIds: Record<number, string | null>;
  memberLastActive: Record<number, string | null>;
  onChatClick: (
    userId: number,
    userName: string,
    moduleSlug: string,
    moduleTitle: string,
  ) => void;
  selectedChat: { userId: number; moduleSlug: string } | null;
}) {
  const segs = useMemo(
    () => buildSegments(timeline.timeline_items),
    [timeline.timeline_items],
  );
  const [sectionsExpanded, setSectionsExpanded] = useState(false);

  // Pixel constants — shared across label + member columns for alignment
  const DOT_H = 14; // height per dot row
  const V_PAD = 5; // vertical padding above/below every element (module or meeting)
  const DOT_COL = 18; // fixed dot column width
  const moduleH = (n: number) => n * DOT_H + V_PAD * 2;
  const mtgH = 16 + V_PAD * 2; // meeting dot + symmetric padding

  return (
    <div className="bg-white border border-slate-200 rounded-lg">
      <div className="overflow-x-auto overflow-y-visible">
        <div className="inline-flex min-w-full">
          {/* Left labels column */}
          <div className="shrink-0 sticky left-0 z-10 bg-white border-r border-slate-200">
            <div className="h-12 border-b border-slate-200" />
            {segs.map((seg, si) =>
              seg.type === "meeting" ? (
                <div
                  key={si}
                  className="px-2 flex items-center"
                  style={{ height: mtgH }}
                >
                  <span className="text-xs font-semibold text-slate-600">
                    Meeting {seg.meetingNumber}
                  </span>
                </div>
              ) : (
                <div
                  key={si}
                  className="px-2 flex items-center overflow-hidden"
                  style={{ height: moduleH(seg.items.length) }}
                >
                  <span className="text-xs text-slate-500 truncate max-w-[120px] leading-tight">
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
            const moduleStats = tm.module_stats ?? {};
            return (
              <div key={tm.user_id} className="shrink-0">
                {/* Name + last active + DM link */}
                <div className="h-12 border-b border-slate-200 px-1.5 flex flex-col justify-end pb-1">
                  <div className="flex items-center gap-0.5">
                    <span
                      className="text-xs font-medium text-slate-700 leading-tight line-clamp-1"
                      title={tm.name}
                    >
                      {tm.name}
                    </span>
                    {memberDiscordIds[tm.user_id] && (
                      <a
                        href={`https://discord.com/users/${memberDiscordIds[tm.user_id]}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-slate-400 hover:text-indigo-500 transition-colors"
                        title="DM on Discord"
                      >
                        <ExtLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                  {memberLastActive[tm.user_id] && (
                    <span className="text-[10px] text-slate-400 leading-none">
                      {formatLastActive(memberLastActive[tm.user_id]!)}
                    </span>
                  )}
                </div>

                {/* Segments */}
                {segs.map((seg, si) => {
                  if (seg.type === "meeting") {
                    const mNum = String(seg.meetingNumber);
                    const status = tm.meetings[mNum];
                    const rsvp = (tm.rsvps ?? {})[mNum];
                    const isGuestElsewhere =
                      tm.guest_elsewhere?.includes(mNum) ?? false;
                    const isPast = seg.items[0]?.is_past ?? false;

                    // Guest visiting another group overrides normal display
                    const color = isGuestElsewhere
                      ? isPast
                        ? "bg-emerald-500"
                        : "bg-slate-200"
                      : status
                        ? status === "attended"
                          ? "bg-emerald-500"
                          : "bg-red-400"
                        : "bg-slate-200";
                    const dotTitle = isGuestElsewhere
                      ? `Meeting ${seg.meetingNumber}: ${isPast ? "joined another group" : "will join another group"}`
                      : `Meeting ${seg.meetingNumber}: ${status || "upcoming"}`;

                    const rsvpIcon = isGuestElsewhere ? null :
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
                        className="flex items-center overflow-visible"
                        style={{ height: mtgH }}
                      >
                        <span
                          className="shrink-0 flex items-center justify-center"
                          style={{ width: DOT_COL }}
                        >
                          <span
                            className={`w-3.5 h-3.5 rounded-full ${color}`}
                            title={dotTitle}
                          />
                        </span>
                        {isGuestElsewhere ? (
                          <span className="text-[10px] text-indigo-500 leading-none ml-1 whitespace-nowrap">
                            {isPast
                              ? "Joined another group"
                              : "Will join another group"}
                          </span>
                        ) : (
                          rsvpIcon && (
                            <span
                              className="inline-flex items-center gap-px shrink-0 ml-1"
                              title={`RSVP: ${rsvp}`}
                            >
                              <span className="text-[10px] text-slate-400 leading-none">
                                RSVP:
                              </span>
                              {rsvpIcon}
                            </span>
                          )
                        )}
                      </div>
                    );
                  }

                  const modChat = seg.slug
                    ? (moduleStats[seg.slug]?.chat_count ?? 0)
                    : 0;
                  const isActiveChat =
                    selectedChat &&
                    selectedChat.userId === tm.user_id &&
                    selectedChat.moduleSlug === seg.slug;
                  const chatColor = isActiveChat
                    ? "text-indigo-600"
                    : "text-indigo-400";
                  const bracketBorder = isActiveChat
                    ? "border-indigo-500"
                    : "border-indigo-300/60";
                  return (
                    <div
                      key={si}
                      className="overflow-visible flex items-stretch"
                      style={{ height: moduleH(seg.items.length) }}
                    >
                      {/* Section rows */}
                      <div className="flex flex-col justify-center">
                        {seg.items.map((item, ii) => {
                          const cid = item.content_id;
                          const done = cid ? completedSet.has(cid) : false;
                          const time = cid ? (sectionTimes[cid] ?? 0) : 0;
                          return (
                            <div
                              key={ii}
                              className="flex items-center"
                              style={{ height: DOT_H }}
                            >
                              <span
                                className="shrink-0 flex items-center justify-center"
                                style={{ width: DOT_COL }}
                              >
                                <span
                                  className={`w-2.5 h-2.5 rounded-full ${
                                    done ? "bg-emerald-500" : "bg-slate-200"
                                  }`}
                                />
                              </span>
                              <span
                                className="relative inline-flex items-center justify-end gap-px shrink-0 group/time"
                                style={{ width: 24 }}
                              >
                                {time > 0 && (
                                  <>
                                    <span className="text-[11px] text-slate-400 leading-none tabular-nums">
                                      {Math.round(time / 60)}
                                    </span>
                                    <Clock
                                      size={9}
                                      className="text-slate-400"
                                    />
                                    <span className="hidden group-hover/time:block absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 text-[10px] text-white bg-slate-800 rounded whitespace-nowrap z-20 pointer-events-none">
                                      Time spent: {Math.round(time / 60)} min
                                    </span>
                                  </>
                                )}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      {/* Module-level chat bracket — clickable */}
                      <div
                        className={`shrink-0 flex flex-col ${modChat > 0 ? "cursor-pointer" : ""}`}
                        style={{
                          width: 28,
                          paddingTop: V_PAD,
                          paddingBottom: V_PAD,
                        }}
                        onClick={
                          modChat > 0 && seg.slug
                            ? () => {
                                const moduleTitle =
                                  seg.items[0]?.module_slug?.replace(
                                    /-/g,
                                    " ",
                                  ) ??
                                  seg.slug ??
                                  "";
                                onChatClick(
                                  tm.user_id,
                                  tm.name,
                                  seg.slug!,
                                  moduleTitle,
                                );
                              }
                            : undefined
                        }
                      >
                        {modChat > 0 && (
                          <>
                            <div
                              className={`flex-1 border-r border-t ${bracketBorder} rounded-tr`}
                              style={{ marginLeft: 1, width: 6, minHeight: 2 }}
                            />
                            <div
                              className="relative flex items-center gap-px shrink-0 group/chat"
                              style={{ marginLeft: 2 }}
                            >
                              <span
                                className={`text-[11px] ${chatColor} leading-none tabular-nums`}
                              >
                                {modChat}
                              </span>
                              <MessageCircle size={9} className={chatColor} />
                              <span className="hidden group-hover/chat:block absolute bottom-full left-0 mb-1 px-1.5 py-0.5 text-[10px] text-white bg-slate-800 rounded whitespace-nowrap z-20 pointer-events-none">
                                Messages to AI: {modChat}
                              </span>
                            </div>
                            <div
                              className={`flex-1 border-r border-b ${bracketBorder} rounded-br`}
                              style={{ marginLeft: 1, width: 6, minHeight: 2 }}
                            />
                          </>
                        )}
                      </div>
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

// --- Chat panel ---

const ChatPanel = forwardRef<
  HTMLDivElement,
  {
    selectedChat: { userName: string; moduleTitle: string };
    sessions: ChatSession[];
    loading: boolean;
    onClose: () => void;
  }
>(function ChatPanel({ selectedChat, sessions, loading, onClose }, ref) {
  const [activeIdx, setActiveIdx] = useState(0);
  const active = sessions[activeIdx] ?? sessions[0];

  // Reset tab when sessions change
  useEffect(() => {
    setActiveIdx(0);
  }, [sessions]);

  return (
    <div
      ref={ref}
      className="mt-2 bg-white border border-slate-200 rounded-lg overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-slate-50">
        <div className="flex items-center gap-2 min-w-0">
          <MessageCircle size={14} className="text-indigo-500 shrink-0" />
          <span className="text-sm font-medium text-slate-700">
            {selectedChat.userName}
          </span>
          <span className="text-xs text-slate-400">
            {selectedChat.moduleTitle}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-0.5 text-slate-400 hover:text-slate-600 cursor-pointer"
        >
          <X size={14} />
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="px-3 py-6 text-center text-sm text-slate-400">
          Loading chat sessions...
        </div>
      )}

      {/* No sessions */}
      {!loading && sessions.length === 0 && (
        <div className="px-3 py-6 text-center text-sm text-slate-400">
          No chat sessions found for this module.
        </div>
      )}

      {/* Sessions */}
      {!loading && sessions.length > 0 && (
        <>
          {/* Session tabs (only if multiple) */}
          {sessions.length > 1 && (
            <div className="flex gap-0 px-3 border-b border-slate-200 overflow-x-auto">
              {sessions.map((s, i) => (
                <button
                  key={s.session_id}
                  onClick={() => setActiveIdx(i)}
                  className={`px-3 py-1.5 text-[11px] whitespace-nowrap cursor-pointer transition-colors border-b-2 -mb-px ${
                    i === activeIdx
                      ? "border-indigo-500 text-indigo-700 font-medium"
                      : "border-transparent text-slate-400 hover:text-slate-600"
                  }`}
                >
                  Session {i + 1}
                  {s.started_at && (
                    <span className="ml-1 opacity-60">
                      {new Date(s.started_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Messages */}
          {active && (
            <div className="px-3 py-2 space-y-2 max-h-80 overflow-y-auto">
              {active.messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex flex-col ${
                    msg.role === "user"
                      ? "items-end"
                      : msg.role === "system"
                        ? "items-center"
                        : "items-start"
                  }`}
                >
                  {msg.role !== "system" && (
                    <span className="text-[9px] text-slate-400 mb-0.5 px-1">
                      {msg.role === "user" ? "Student" : "Tutor"}
                    </span>
                  )}
                  <div
                    className={`max-w-[85%] px-2.5 py-1.5 rounded-lg text-xs leading-relaxed whitespace-pre-wrap ${
                      msg.role === "user"
                        ? "bg-slate-800 text-white"
                        : msg.role === "system"
                          ? "bg-transparent text-slate-400 italic text-center"
                          : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
});
