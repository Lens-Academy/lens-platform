/**
 * Types for course overview feature.
 */

export type StageInfo = {
  type: "article" | "video" | "chat" | "lens" | "test";
  title: string;
  duration: number | null;
  optional: boolean;
  // New fields for lens-level progress tracking
  contentId?: string | null;
  completed?: boolean;
  tldr?: string;
};

export type ModuleStatus = "completed" | "in_progress" | "not_started";

export type ModuleInfo = {
  slug: string;
  title: string;
  stages: StageInfo[];
  status: ModuleStatus;
  optional: boolean;
  // Submodule fields (present when module was split from a parent)
  parentSlug?: string | null;
  parentTitle?: string | null;
  // Legacy fields (may still be present)
  currentStageIndex?: number | null;
  sessionId?: number | null;
  // New lens progress fields
  completedLenses?: number;
  totalLenses?: number;
  // Module duration in minutes (computed from content word count + video duration)
  duration?: number | null;
};

export type UnitInfo = {
  meetingNumber: number | null;
  meetingName?: string | null;
  meetingDate?: string | null;
  modules: ModuleInfo[];
};

export type CourseProgress = {
  course: {
    slug: string;
    title: string;
  };
  units: UnitInfo[];
};
