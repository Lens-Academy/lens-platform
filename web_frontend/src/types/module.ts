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

export type ArticleExcerptSegment = {
  type: "article-excerpt";
  content: string; // Pre-extracted content from API
  collapsed_before: string | null; // Omitted content before this excerpt
  collapsed_after: string | null; // Omitted content after this excerpt (last excerpt only)
};

export type VideoExcerptSegment = {
  type: "video-excerpt";
  from: number; // seconds
  to: number | null; // seconds (null = play to end)
  transcript: string; // Transcript text from API
};

export type ChatSegment = {
  type: "chat";
  instructions: string;
  hidePreviousContentFromUser: boolean;
  hidePreviousContentFromTutor: boolean;
};

export type ModuleSegment =
  | TextSegment
  | ArticleExcerptSegment
  | VideoExcerptSegment
  | ChatSegment;

// Metadata for article sections
export type ArticleMeta = {
  title: string;
  author: string | null;
  sourceUrl: string | null;
};

// Metadata for video sections
export type VideoMeta = {
  title: string;
  channel: string | null;
};

// Section types (one progress marker each)
export type TextSection = {
  type: "text";
  content: string;
  contentId?: string | null;
};

export type ArticleSection = {
  type: "article";
  meta: ArticleMeta;
  segments: ModuleSegment[];
  optional?: boolean;
  contentId?: string | null;
};

export type VideoSection = {
  type: "video";
  videoId: string;
  meta: VideoMeta;
  segments: ModuleSegment[];
  optional?: boolean;
  contentId?: string | null;
};

export type ChatSection = {
  type: "chat";
  meta: { title: string };
  instructions: string;
  hidePreviousContentFromUser: boolean;
  hidePreviousContentFromTutor: boolean;
  contentId?: string | null;
};

// v2 section types (flattened format - backend resolves all references)

/**
 * A page section with text/chat segments.
 * These are standalone sections not associated with a Learning Outcome.
 */
export type PageSection = {
  type: "page";
  contentId?: string | null;
  meta: { title: string | null };
  segments: ModuleSegment[];
};

/**
 * A lens section containing video content.
 * The learningOutcomeId links this to its parent LO (null if uncategorized).
 */
export type LensVideoSection = {
  type: "lens-video";
  contentId: string;
  learningOutcomeId: string | null;
  videoId: string;
  meta: { title: string; channel: string | null };
  segments: ModuleSegment[];
  optional: boolean;
};

/**
 * A lens section containing article content.
 * The learningOutcomeId links this to its parent LO (null if uncategorized).
 */
export type LensArticleSection = {
  type: "lens-article";
  contentId: string;
  learningOutcomeId: string | null;
  meta: { title: string; author: string | null; sourceUrl: string | null };
  segments: ModuleSegment[];
  optional: boolean;
};

// Union of all section types
// v2 types: page, lens-video, lens-article (flattened, ready to render)
// v1 types: text, article, video, chat (legacy, still used for v1 content)
export type ModuleSection =
  | PageSection
  | LensVideoSection
  | LensArticleSection
  | TextSection
  | ArticleSection
  | VideoSection
  | ChatSection;

// Full module definition
export type Module = {
  slug: string;
  title: string;
  sections: ModuleSection[];
};

// Chat types (used in module player)
export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  icon?: "article" | "video" | "chat"; // Optional icon for system messages
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
};

export type VideoStage = {
  type: "video";
  videoId: string;
  from: number;
  to: number | null;
  title?: string;
  optional?: boolean;
};

export type ChatStage = {
  type: "chat";
  instructions: string;
  hidePreviousContentFromUser: boolean;
  hidePreviousContentFromTutor: boolean;
  title?: string;
  optional?: boolean;
};

export type Stage = ArticleStage | VideoStage | ChatStage;
