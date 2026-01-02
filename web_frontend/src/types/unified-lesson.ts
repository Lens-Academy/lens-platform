/**
 * Types for unified lesson feature.
 */

export type ArticleStage = {
  type: "article";
  source_url: string;
  from: string | null;
  to: string | null;
};

export type VideoStage = {
  type: "video";
  videoId: string;
  from: number;
  to: number | null;
};

export type ChatStage = {
  type: "chat";
  context: string;
  includePreviousContent: boolean;
};

export type Stage = ArticleStage | VideoStage | ChatStage;

export type Lesson = {
  id: string;
  title: string;
  stages: Stage[];
};

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type PendingMessage = {
  content: string;
  status: "sending" | "failed";
};

export type PreviousStageInfo = {
  type: "article" | "video";
  videoId?: string;
};

export type SessionState = {
  session_id: number;
  lesson_id: string;
  lesson_title: string;
  current_stage_index: number;
  total_stages: number;
  current_stage: Stage | null;
  messages: ChatMessage[];
  completed: boolean;
  content: string | null;
  stages: Stage[];
  // For chat stages: previous content to display (blurred or visible)
  previous_content: string | null;
  previous_stage: PreviousStageInfo | null;
  include_previous_content: boolean;
};
