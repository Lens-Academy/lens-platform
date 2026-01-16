// web_frontend/src/components/lesson-prototypes/shared/types.ts

export type ContentBlock =
  | { type: "markdown"; content: string; id: string }
  | { type: "video"; videoId: string; start: number; end: number; id: string }
  | { type: "chat"; id: string; prompt?: string };

export type PrototypeLesson = {
  title: string;
  blocks: ContentBlock[];
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatState = {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
};
