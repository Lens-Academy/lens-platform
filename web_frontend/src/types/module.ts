// web_frontend_next/src/types/module.ts

/**
 * Types for Module format.
 *
 * Segments within a section allow interleaving of text, content excerpts, and chat.
 *
 * The API bundles all content (article excerpts, video transcripts) directly
 * in the response - no separate fetching needed.
 */

// Segment types within a section
export type TextSegment = {
  type: "text";
  content: string; // Markdown content (authored)
};

export type ArticleSegment = {
  type: "article";
  content: string; // Pre-extracted content from API
  collapsed_before?: string | null; // Omitted content before this excerpt
  collapsed_after?: string | null; // Omitted content after this excerpt (last excerpt only)
  title?: string; // From article frontmatter
  author?: string; // From article frontmatter
  sourceUrl?: string; // From article frontmatter
  published?: string; // From article frontmatter
  optional?: boolean;
};

export type VideoSegment = {
  type: "video";
  from: number; // seconds
  to: number | null; // seconds (null = play to end)
  transcript: string; // Transcript text from API
  title?: string; // From video transcript frontmatter
  channel?: string; // From video transcript frontmatter
  videoId?: string; // YouTube video ID from transcript URL
  optional?: boolean;
};

export type ChatSegment = {
  type: "chat";
  instructions: string;
  hidePreviousContentFromUser: boolean;
  hidePreviousContentFromTutor: boolean;
};

export type QuestionSegment = {
  type: "question";
  content: string;
  assessmentInstructions?: string;
  maxTime?: string;
  maxChars?: number;
  enforceVoice?: boolean;
  optional?: boolean;
  feedback?: boolean;
};

export type RoleplaySegment = {
  type: "roleplay";
  id: string; // UUID for session isolation
  content: string; // Student-facing scenario briefing
  aiInstructions: string; // Character behavior
  openingMessage?: string; // Optional first AI message
  assessmentInstructions?: string; // Optional scoring rubric
  optional?: boolean;
  feedback?: boolean;
};

export type ModuleSegment =
  | TextSegment
  | ArticleSegment
  | VideoSegment
  | ChatSegment
  | QuestionSegment
  | RoleplaySegment;

// v2 section types (flattened format - backend resolves all references)

/**
 * A lens section with text/chat/article/video segments.
 * Metadata (title, author, channel, videoId) is on individual segments.
 */
export type LensSection = {
  type: "lens";
  displayType?: "lens-article" | "lens-video" | "lens-mixed";
  contentId: string | null;
  learningOutcomeId: string | null;
  learningOutcomeName: string | null;
  meta: { title?: string | null };
  segments: ModuleSegment[];
  optional: boolean;
  hide?: boolean;
  tldr?: string;
  wordCount?: number;
  videoDurationSeconds?: number;
};

/**
 * A test section containing assessment questions.
 * Rendered at the end of a module for time-gap measurement.
 */
export type TestSection = {
  type: "test";
  contentId: string | null;
  learningOutcomeId: string | null;
  learningOutcomeName: string | null;
  meta: { title?: string | null };
  segments: ModuleSegment[];
  optional: boolean;
  hide?: boolean;
  feedback?: boolean;
};

// Union of all section types
export type ModuleSection = LensSection | TestSection;

// Full module definition
export type Module = {
  slug: string;
  title: string;
  sections: ModuleSection[];
  error?: string;
};

// Chat types (used in module player)
export type ChatMessage = {
  role: "user" | "assistant" | "system" | "course-content";
  content: string;
  icon?: "article" | "video" | "chat" | "course-content"; // Optional icon for system messages
};

export type PendingMessage = {
  content: string;
  status: "sending" | "failed";
};

// Article data for embedded content
export type ArticleData = {
  content: string;
  title: string | null;
  author: string | null;
  sourceUrl: string | null;
  published: string | null;
  isExcerpt?: boolean;
  collapsed_before?: string | null; // Omitted content before this excerpt
  collapsed_after?: string | null; // Omitted content after this excerpt
};

// Stage types for progress bar (discriminated union matching section types)
export type ArticleStage = {
  type: "article";
  source: string;
  from: number | null;
  to: number | null;
  title?: string;
  optional?: boolean;
  hide?: boolean;
  tldr?: string;
  duration?: number | null;
};

export type VideoStage = {
  type: "video";
  videoId: string;
  from: number;
  to: number | null;
  title?: string;
  optional?: boolean;
  hide?: boolean;
  tldr?: string;
  duration?: number | null;
};

export type ChatStage = {
  type: "chat";
  instructions: string;
  hidePreviousContentFromUser: boolean;
  hidePreviousContentFromTutor: boolean;
  title?: string;
  optional?: boolean;
  hide?: boolean;
  tldr?: string;
  duration?: number | null;
};

export type LensStage = {
  type: "lens";
  source: string;
  from: number | null;
  to: number | null;
  title?: string;
  optional?: boolean;
  hide?: boolean;
  tldr?: string;
  duration?: number | null;
};

export type Stage = ArticleStage | VideoStage | ChatStage | LensStage;
