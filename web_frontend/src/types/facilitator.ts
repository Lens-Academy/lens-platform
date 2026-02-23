export interface FacilitatorGroup {
  group_id: number;
  group_name: string;
  status: string;
  discord_text_channel_id: string | null;
  cohort_id: number;
  cohort_name: string;
  cohort_start_date: string;
}

export interface GroupMember {
  user_id: number;
  name: string;
  discord_id: string | null;
  sections_completed: number;
  total_time_seconds: number;
  last_active_at: string | null;
  meetings_attended: number;
  meetings_occurred: number;
  ai_message_count: number;
}

export interface SectionProgress {
  content_id: string;
  title: string;
  type: string;
  completed: boolean;
  time_spent_seconds: number;
}

export interface ModuleProgress {
  slug: string;
  title: string;
  status: "not_started" | "in_progress" | "completed";
  completed_count: number;
  total_count: number;
  time_spent_seconds: number;
  sections: SectionProgress[];
  due_by_meeting: number | null;
}

export interface UserProgress {
  modules: ModuleProgress[];
  total_time_seconds: number;
  last_active_at: string | null;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatSession {
  session_id: number;
  content_id: string | null;
  module_slug: string | null;
  module_title: string | null;
  messages: ChatMessage[];
  started_at: string | null;
  last_active_at: string | null;
  is_archived: boolean;
}

export interface TimelineItem {
  type: "section" | "meeting";
  content_id?: string;
  module_slug?: string;
  title?: string;
  number?: number;
  is_past?: boolean;
}

export interface ModuleStats {
  time_seconds: number;
  chat_count: number;
}

export interface TimelineMember {
  user_id: number;
  name: string;
  completed_ids: string[];
  meetings: Record<string, "attended" | "missed">;
  rsvps: Record<
    string,
    "pending" | "attending" | "not_attending" | "tentative"
  >;
  module_stats: Record<string, ModuleStats>;
  section_times: Record<string, number>;
  guest_elsewhere?: string[];
}

export interface TimelineData {
  timeline_items: TimelineItem[];
  members: TimelineMember[];
}

export interface MeetingAttendance {
  meeting_id: number;
  meeting_number: number | null;
  scheduled_at: string;
  rsvp_status: string | null;
  rsvp_at: string | null;
  checked_in_at: string | null;
}
