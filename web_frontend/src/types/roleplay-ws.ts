/**
 * Shared types for the unified roleplay WebSocket (/ws/chat/roleplay).
 *
 * The server sends JSON text messages (parsed into these types) and binary
 * audio chunks (LINEAR16 PCM). The "audio" type below is synthetic — emitted
 * by the client hook when a binary chunk arrives, not parsed from the server.
 */

export type RoleplayWsMessage =
  | {
      type: "session";
      session_id: number;
      messages: Array<{ role: string; content: string }>;
      completed_at: string | null;
    }
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "log"; tag: string; msg: string }
  | { type: "done"; audio_bytes?: number; audio_chunks?: number }
  | { type: "error"; message: string }
  | { type: "audio"; bytes: number };
