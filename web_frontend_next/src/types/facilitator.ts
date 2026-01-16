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
  lessons_completed: number;
  total_time_seconds: number;
  last_active_at: string | null;
}

export interface StageProgress {
  stage_index: number;
  stage_type: "article" | "video" | "chat";
  time_spent_seconds: number;
}

export interface LessonProgress {
  lesson_slug: string;
  completed: boolean;
  time_spent_seconds: number;
  stages: StageProgress[];
}

export interface UserProgress {
  lessons: LessonProgress[];
  total_time_seconds: number;
  last_active_at: string | null;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatSession {
  session_id: number;
  lesson_slug: string;
  messages: ChatMessage[];
  started_at: string | null;
  completed_at: string | null;
  duration_seconds: number;
}
