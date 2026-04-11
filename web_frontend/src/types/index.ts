// web_frontend_next/src/types/index.ts
// Re-export all types for cleaner imports

// Module types
export type {
  TextSegment,
  ArticleSegment,
  VideoSegment,
  ChatSegment,
  ModuleSegment,
  // v2 section types
  LensSection,
  TestSection,
  // Union type
  ModuleSection,
  Module,
  ChatMessage,
  PendingMessage,
  ArticleData,
  ArticleStage,
  VideoStage,
  ChatStage,
  LensStage,
  Stage,
} from "./module";

// Course types
export * from "./course";

// Facilitator types
export * from "./facilitator";

// Signup types - file removed, no exports needed
