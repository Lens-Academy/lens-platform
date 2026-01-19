/**
 * Types for unified lesson feature.
 */

export type ArticleStage = {
  type: "article";
  source: string;
  from: string | null;
  to: string | null;
  optional?: boolean;
  introduction?: string; // Lens Academy intro note
};

export type VideoStage = {
  type: "video";
  videoId: string;
  from: number;
  to: number | null;
  optional?: boolean;
  introduction?: string; // Lens Academy intro note
};

export type ChatStage = {
  type: "chat";
  instructions: string;
  showUserPreviousContent: boolean;
  showTutorPreviousContent: boolean;
};

export type Stage = ArticleStage | VideoStage | ChatStage;

export type Lesson = {
  slug: string;
  title: string;
  stages: Stage[];
};

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  icon?: "article" | "video" | "chat"; // For system messages
};

export type PendingMessage = {
  content: string;
  status: "sending" | "failed";
};

export type PreviousStageInfo = {
  type: "article" | "video";
  videoId?: string;
  from?: number;
  to?: number | null;
};

export type ArticleMetadata = {
  title: string | null;
  author: string | null;
  source_url: string | null; // Original article URL
};

// Bundled article data - content + metadata together
export type ArticleData = {
  content: string;
  title?: string | null;
  author?: string | null;
  sourceUrl?: string | null;
  isExcerpt?: boolean;
};

export type SessionState = {
  session_id: number;
  lesson_slug: string;
  lesson_title: string;
  current_stage_index: number;
  total_stages: number;
  current_stage: Stage | null;
  messages: ChatMessage[];
  completed: boolean;
  // Article content with metadata bundled
  article: ArticleData | null;
  stages: Stage[];
  // For chat stages: previous content to display (blurred or visible)
  previous_article: ArticleData | null;
  previous_stage: PreviousStageInfo | null;
  show_user_previous_content: boolean;
  // User ID if session is claimed, null for anonymous sessions
  user_id: number | null;
};
