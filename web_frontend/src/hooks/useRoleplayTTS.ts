/**
 * useRoleplayTTS - Coordinates TTS audio playback for roleplay conversations.
 *
 * Uses the buffered TTS approach: after the LLM response completes,
 * the full text is sent to /ws/tts for audio synthesis. This is simpler
 * than streaming TTS and acceptable for Phase 10 latency requirements.
 *
 * Internally uses useAudioPlayback for gapless chunk scheduling and
 * AudioContext lifecycle management.
 */

import { useRef, useCallback, useEffect } from "react";
import { useAudioPlayback } from "./useAudioPlayback";

export interface UseRoleplayTTSReturn {
  /** Call after LLM response completes to speak the text */
  speakText: (text: string) => void;
  /** Stop playback and close WebSocket */
  stop: () => void;
  /** Whether audio is currently playing */
  isPlaying: boolean;
}

export function useRoleplayTTS(ttsEnabled: boolean): UseRoleplayTTSReturn {
  const audioPlayback = useAudioPlayback();
  const wsRef = useRef<WebSocket | null>(null);
  const mountedRef = useRef(true);

  /**
   * Send completed assistant text to /ws/tts for audio playback.
   *
   * Must be called in a chain from a user gesture (e.g., message send
   * button click) to satisfy AudioContext autoplay policy (Pitfall 3).
   */
  const speakText = useCallback(
    (text: string) => {
      if (!ttsEnabled || !text.trim()) return;

      // Close any existing WebSocket connection
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      // Resume AudioContext (must be called from user gesture chain)
      audioPlayback.resume();

      // Determine WebSocket protocol based on page protocol
      const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${wsProtocol}//${location.host}/ws/tts`);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ text, voice: "Ashley" }));
      };

      ws.onmessage = async (event: MessageEvent) => {
        if (!mountedRef.current) return;

        if (event.data instanceof Blob) {
          // Binary audio chunk -- decode and play
          try {
            const bytes = await event.data.arrayBuffer();
            await audioPlayback.playChunk(bytes);
          } catch (err) {
            console.warn("[useRoleplayTTS] Failed to play audio chunk:", err);
          }
        } else if (typeof event.data === "string") {
          // JSON control message
          try {
            const msg = JSON.parse(event.data);
            if (msg.done) {
              // TTS synthesis complete -- WebSocket will close
              ws.close();
            } else if (msg.error) {
              console.error("[useRoleplayTTS] TTS error:", msg.error);
              ws.close();
            }
          } catch {
            // Non-JSON string -- ignore
          }
        }
      };

      ws.onerror = (event) => {
        console.error("[useRoleplayTTS] WebSocket error:", event);
      };

      ws.onclose = () => {
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
      };
    },
    [ttsEnabled, audioPlayback],
  );

  /**
   * Stop all audio playback and close the TTS WebSocket.
   *
   * Called when completing or retrying a session (Pitfall 5) to prevent
   * audio from continuing over state transitions.
   */
  const stop = useCallback(() => {
    audioPlayback.stop();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, [audioPlayback]);

  // Cleanup on unmount (reset on remount for React strict mode)
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  return {
    speakText,
    stop,
    isPlaying: audioPlayback.isPlaying,
  };
}
