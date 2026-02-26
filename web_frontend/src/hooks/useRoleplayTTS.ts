/**
 * useRoleplayTTS - Coordinates TTS audio playback for roleplay conversations.
 *
 * Supports two modes:
 * - **Single-shot** (`speakText`): sends full text to /ws/tts after LLM completes.
 * - **Streaming** (`startStreaming` / `sendToken` / `flush`): opens TTS WebSocket
 *   before LLM starts, forwards tokens as they arrive, so audio plays concurrently
 *   with LLM generation.
 *
 * Internally uses useAudioPlayback for gapless chunk scheduling and
 * AudioContext lifecycle management.
 */

import { useRef, useCallback, useEffect } from "react";
import { useAudioPlayback } from "./useAudioPlayback";

export interface UseRoleplayTTSReturn {
  /** Send completed text for audio playback (single-shot) */
  speakText: (text: string) => void;
  /** Open TTS WebSocket in streaming mode (call from user gesture chain) */
  startStreaming: () => void;
  /** Forward an LLM token to the streaming TTS WebSocket */
  sendToken: (text: string) => void;
  /** Signal that LLM generation is done (triggers Inworld flush) */
  flush: () => void;
  /** Stop playback and close WebSocket */
  stop: () => void;
  /** Whether audio is currently playing */
  isPlaying: boolean;
}

function makeTTSUrl(): string {
  const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProtocol}//${location.host}/ws/tts`;
}

export function useRoleplayTTS(ttsEnabled: boolean): UseRoleplayTTSReturn {
  const audioPlayback = useAudioPlayback();
  const wsRef = useRef<WebSocket | null>(null);
  const mountedRef = useRef(true);

  /** Shared handler for incoming WebSocket messages (audio chunks + control). */
  const handleWsMessage = useCallback(
    async (event: MessageEvent) => {
      if (!mountedRef.current) return;

      if (event.data instanceof Blob) {
        try {
          const bytes = await event.data.arrayBuffer();
          await audioPlayback.playChunk(bytes);
        } catch (err) {
          console.warn("[useRoleplayTTS] Failed to play audio chunk:", err);
        }
      } else if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data);
          if (msg.done) {
            wsRef.current?.close();
          } else if (msg.error) {
            console.error("[useRoleplayTTS] TTS error:", msg.error);
            wsRef.current?.close();
          }
        } catch {
          // Non-JSON string -- ignore
        }
      }
    },
    [audioPlayback],
  );

  /** Close any existing WS and clean up ref. */
  const closeWs = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  // ---- Single-shot mode ----

  const speakText = useCallback(
    (text: string) => {
      if (!ttsEnabled || !text.trim()) return;
      closeWs();
      audioPlayback.resume();

      const ws = new WebSocket(makeTTSUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ text, voice: "Ashley", audio_encoding: "LINEAR16" }));
      };
      ws.onmessage = handleWsMessage;
      ws.onerror = (e) => console.error("[useRoleplayTTS] WebSocket error:", e);
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
      };
    },
    [ttsEnabled, audioPlayback, closeWs, handleWsMessage],
  );

  // ---- Streaming mode ----

  const startStreaming = useCallback(() => {
    if (!ttsEnabled) return;
    closeWs();
    audioPlayback.resume();

    const ws = new WebSocket(makeTTSUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ streaming: true, voice: "Ashley", audio_encoding: "LINEAR16" }));
    };
    ws.onmessage = handleWsMessage;
    ws.onerror = (e) => console.error("[useRoleplayTTS] WebSocket error:", e);
    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null;
    };
  }, [ttsEnabled, audioPlayback, closeWs, handleWsMessage]);

  const sendToken = useCallback((text: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ text }));
    }
  }, []);

  const flush = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ flush: true }));
    }
  }, []);

  // ---- Stop / cleanup ----

  const stop = useCallback(() => {
    audioPlayback.stop();
    closeWs();
  }, [audioPlayback, closeWs]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      closeWs();
    };
  }, [closeWs]);

  return {
    speakText,
    startStreaming,
    sendToken,
    flush,
    stop,
    isPlaying: audioPlayback.isPlaying,
  };
}
