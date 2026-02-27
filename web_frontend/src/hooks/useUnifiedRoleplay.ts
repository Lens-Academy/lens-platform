/**
 * useUnifiedRoleplay - Shared hook for the unified roleplay WebSocket.
 *
 * Connects to /ws/chat/roleplay which interleaves LLM text tokens and TTS
 * audio chunks over a single WebSocket. Audio plays concurrently with text
 * generation — no waiting for the full LLM response.
 *
 * Lazy connect: the WebSocket opens on the first sendMessage() call, not on
 * mount. The init message (module, roleplay config, TTS settings) is sent in
 * the onopen handler.
 *
 * Used by both the TTS test page (with onMessage for timing/logging) and the
 * production RoleplaySection.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useAudioPlayback } from "./useAudioPlayback";
import { getAnonymousToken } from "./useAnonymousToken";
import type { RoleplayWsMessage } from "@/types/roleplay-ws";

export type { RoleplayWsMessage };

export interface UseUnifiedRoleplayConfig {
  moduleSlug: string;
  roleplayId: string;
  aiInstructions: string;
  scenarioContent?: string;
  openingMessage?: string;
  /** TTS voice name. Omit to disable TTS (text-only streaming). */
  voice?: string;
  /** TTS model. Defaults to server default if omitted. */
  model?: string;
  /** Audio encoding. Defaults to "LINEAR16". */
  audioEncoding?: string;
  /** TTS speaking rate. */
  speakingRate?: number;
  /** Fires for every parsed server message (and synthetic "audio" messages). */
  onMessage?: (msg: RoleplayWsMessage) => void;
}

export type UnifiedRoleplayStatus = "idle" | "connecting" | "streaming" | "error";

export interface UseUnifiedRoleplayReturn {
  messages: Array<{ role: string; content: string }>;
  streamingContent: string;
  status: UnifiedRoleplayStatus;
  sessionId: number | null;
  isCompleted: boolean;
  isPlaying: boolean;
  audioChunksReceived: number;
  sendMessage: (content: string) => Promise<void>;
  cancel: () => void;
  stopAudio: () => void;
  disconnect: () => void;
  /** Reset all conversation state back to initial values. */
  reset: () => void;
  /** Mark session as completed (updates local state only; caller handles REST). */
  markComplete: () => void;
}

export function useUnifiedRoleplay(config: UseUnifiedRoleplayConfig): UseUnifiedRoleplayReturn {
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [status, setStatus] = useState<UnifiedRoleplayStatus>("idle");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [isCompleted, setIsCompleted] = useState(false);
  const [audioChunksReceived, setAudioChunksReceived] = useState(0);

  const audioPlayback = useAudioPlayback();

  const wsRef = useRef<WebSocket | null>(null);
  const initedRef = useRef(false);
  const streamingRef = useRef("");
  const mountedRef = useRef(true);
  // Track the voice config the current WS was opened with, so we can
  // detect when the user toggles TTS and reconnect.
  const wsVoiceRef = useRef<string | undefined>(undefined);
  // Stable ref for config so onmessage handler always reads latest
  const configRef = useRef(config);
  configRef.current = config;

  /** Build the WebSocket URL. */
  const makeWsUrl = useCallback((): string => {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${location.host}/ws/chat/roleplay`;
  }, []);

  /** Close the current WebSocket cleanly. */
  const closeWs = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    initedRef.current = false;
  }, []);

  /** Open a new WebSocket and send the init message. Returns a promise
   *  that resolves once the "session" response arrives. */
  const openWs = useCallback((): Promise<WebSocket> => {
    // If already open with matching voice config, reuse
    const existing = wsRef.current;
    if (existing && existing.readyState === WebSocket.OPEN && wsVoiceRef.current === config.voice) {
      return Promise.resolve(existing);
    }

    // Close stale connection (e.g. voice config changed)
    closeWs();

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(makeWsUrl());
      wsRef.current = ws;
      wsVoiceRef.current = config.voice;

      ws.onopen = () => {
        const cfg = configRef.current;
        const initPayload: Record<string, unknown> = {
          module_slug: cfg.moduleSlug,
          roleplay_id: cfg.roleplayId,
          ai_instructions: cfg.aiInstructions,
          anonymous_token: getAnonymousToken(),
        };
        if (cfg.scenarioContent) initPayload.scenario_content = cfg.scenarioContent;
        if (cfg.openingMessage) initPayload.opening_message = cfg.openingMessage;
        if (cfg.voice) {
          initPayload.voice = cfg.voice;
          initPayload.audio_encoding = cfg.audioEncoding ?? "LINEAR16";
          if (cfg.model) initPayload.model = cfg.model;
          if (cfg.speakingRate != null) initPayload.speaking_rate = cfg.speakingRate;
        }
        ws.send(JSON.stringify(initPayload));
      };

      ws.onmessage = async (event: MessageEvent) => {
        if (!mountedRef.current) return;

        if (event.data instanceof Blob) {
          // Binary = TTS audio chunk
          const bytes = await event.data.arrayBuffer();
          setAudioChunksReceived((c) => c + 1);
          configRef.current.onMessage?.({ type: "audio", bytes: bytes.byteLength });
          try {
            await audioPlayback.playChunk(bytes);
          } catch (err) {
            console.warn("[useUnifiedRoleplay] playChunk failed:", err);
          }
          return;
        }

        // JSON text message
        try {
          const parsed = JSON.parse(event.data as string) as RoleplayWsMessage;
          configRef.current.onMessage?.(parsed);

          switch (parsed.type) {
            case "session":
              initedRef.current = true;
              setSessionId(parsed.session_id);
              setIsCompleted(!!parsed.completed_at);
              setMessages(parsed.messages ?? []);
              resolve(ws);
              break;

            case "text":
              streamingRef.current += parsed.content;
              setStreamingContent(streamingRef.current);
              break;

            case "thinking":
              // Consumed by onMessage callback if desired; no state update
              break;

            case "log":
              // Consumed by onMessage callback if desired
              break;

            case "done": {
              const fullContent = streamingRef.current;
              if (fullContent) {
                setMessages((prev) => [...prev, { role: "assistant", content: fullContent }]);
              }
              setStreamingContent("");
              streamingRef.current = "";
              setStatus("idle");
              audioPlayback.endStream();
              break;
            }

            case "error":
              console.error("[useUnifiedRoleplay] Server error:", parsed.message);
              setStatus("error");
              break;
          }
        } catch {
          // Non-JSON text — ignore
        }
      };

      ws.onerror = () => {
        if (!mountedRef.current) return;
        setStatus("error");
        reject(new Error("WebSocket connection failed"));
      };

      ws.onclose = () => {
        if (wsRef.current === ws) {
          wsRef.current = null;
          initedRef.current = false;
        }
      };
    });
  }, [config.voice, closeWs, makeWsUrl, audioPlayback]);

  /** Send a user message (or empty string for opening message trigger). */
  const sendMessage = useCallback(async (content: string) => {
    const isUserMessage = content.trim() !== "";

    if (isUserMessage) {
      setMessages((prev) => [...prev, { role: "user", content }]);
    }

    setStreamingContent("");
    streamingRef.current = "";
    setStatus("connecting");
    setAudioChunksReceived(0);
    audioPlayback.stop();

    try {
      await audioPlayback.resume();
      if (configRef.current.voice) {
        audioPlayback.beginStream();
      }
    } catch (err) {
      console.error("[useUnifiedRoleplay] AudioContext resume failed:", err);
    }

    try {
      const ws = await openWs();

      setStatus("streaming");
      ws.send(JSON.stringify({ message: content }));
    } catch (err) {
      console.error("[useUnifiedRoleplay] Failed to send:", err);
      setStatus("error");
    }
  }, [audioPlayback, openWs]);

  /** Cancel the current turn and close the WebSocket. */
  const cancel = useCallback(() => {
    audioPlayback.stop();
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ cancel: true }));
    }
    closeWs();
    // Commit any partial streaming content
    const partial = streamingRef.current;
    if (partial) {
      setMessages((prev) => [...prev, { role: "assistant", content: partial }]);
      setStreamingContent("");
      streamingRef.current = "";
    }
    setStatus("idle");
  }, [audioPlayback, closeWs]);

  /** Stop audio playback only (don't close WS or discard text). */
  const stopAudio = useCallback(() => {
    audioPlayback.stop();
  }, [audioPlayback]);

  /** Disconnect the WebSocket (next sendMessage will open a fresh one). */
  const disconnect = useCallback(() => {
    audioPlayback.stop();
    closeWs();
  }, [audioPlayback, closeWs]);

  /** Reset all conversation state back to initial values. */
  const reset = useCallback(() => {
    audioPlayback.stop();
    closeWs();
    setMessages([]);
    setStreamingContent("");
    setStatus("idle");
    setSessionId(null);
    setIsCompleted(false);
  }, [audioPlayback, closeWs]);

  /** Mark the session as completed (local state only). */
  const markComplete = useCallback(() => {
    setIsCompleted(true);
  }, []);


  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      audioPlayback.stop();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    messages,
    streamingContent,
    status,
    sessionId,
    isCompleted,
    isPlaying: audioPlayback.isPlaying,
    audioChunksReceived: audioChunksReceived,
    sendMessage,
    cancel,
    stopAudio,
    disconnect,
    reset,
    markComplete,
  };
}
