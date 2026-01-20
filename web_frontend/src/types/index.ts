// web_frontend_next/src/types/index.ts
// Re-export all types for cleaner imports

// Module types
export type {
  TextSegment,
  ArticleExcerptSegment,
  VideoExcerptSegment,
  ChatSegment,
  ModuleSegment,
  ArticleMeta,
  VideoMeta,
  TextSection,
  ArticleSection,
  VideoSection,
  ModuleSection,
  Module,
  ChatMessage,
  PendingMessage,
  ArticleData,
  ArticleStage,
  VideoStage,
  ChatStage,
  Stage,
} from "./module";

// Course types
export * from "./course";

// Facilitator types
export * from "./facilitator";

// Signup types
export * from "./signup";
