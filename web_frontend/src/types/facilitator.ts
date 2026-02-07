export interface FacilitatorGroup {
  group_id: number;
  group_name: string;
  status: string;
  cohort_id: number;
  cohort_name: string;
  cohort_start_date: string;
}

export interface GroupMember {
  user_id: number;
  name: string;
  sections_completed: number;
  total_time_seconds: number;
  last_active_at: string | null;
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
