/**
 * Types for course overview feature.
 */

export type StageInfo = {
  type:
    | "article"
    | "video"
    | "chat"
    | "lens-video"
    | "lens-article"
    | "page"
    | "test";
  title: string;
  duration: string | null;
  optional: boolean;
  // New fields for lens-level progress tracking
  contentId?: string | null;
  completed?: boolean;
};

export type ModuleStatus = "completed" | "in_progress" | "not_started";

export type ModuleInfo = {
  slug: string;
  title: string;
  stages: StageInfo[];
  status: ModuleStatus;
  optional: boolean;
  // Legacy fields (may still be present)
  currentStageIndex?: number | null;
  sessionId?: number | null;
  // New lens progress fields
  completedLenses?: number;
  totalLenses?: number;
};

export type UnitInfo = {
  meetingNumber: number | null;
  modules: ModuleInfo[];
};

export type CourseProgress = {
  course: {
    slug: string;
    title: string;
  };
  units: UnitInfo[];
};
