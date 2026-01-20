/**
 * Types for course overview feature.
 */

export type StageInfo = {
  type: "article" | "video" | "chat";
  title: string;
  duration: string | null;
  optional: boolean;
};

export type ModuleStatus = "completed" | "in_progress" | "not_started";

export type ModuleInfo = {
  slug: string;
  title: string;
  stages: StageInfo[];
  status: ModuleStatus;
  currentStageIndex: number | null;
  sessionId: number | null;
  optional: boolean;
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
