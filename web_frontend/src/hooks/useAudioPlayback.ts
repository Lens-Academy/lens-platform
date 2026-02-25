/**
 * useAudioPlayback - Streaming MP3 chunk playback via Web Audio API.
 *
 * Handles gapless scheduling of audio chunks as they arrive from a
 * WebSocket TTS stream. Each MP3 chunk is decoded independently and
 * scheduled to play immediately after the previous one finishes,
 * achieving seamless streaming playback.
 *
 * Critical design decisions:
 * - Each chunk gets its own AudioBufferSourceNode (they are one-shot).
 * - Scheduling uses AudioContext.currentTime for sample-accurate timing.
 * - AudioContext is lazy-created and requires resume() from a user gesture.
 * - Source nodes and decoded buffers are released after playback for GC.
 */

import { useState, useRef, useCallback, useEffect } from "react";

export type AudioContextState = "suspended" | "running" | "closed";

export interface UseAudioPlaybackReturn {
  /** Feed an MP3 chunk (ArrayBuffer) for playback */
  playChunk: (mp3Bytes: ArrayBuffer) => Promise<void>;
  /** Stop all playback and reset state */
  stop: () => void;
  /** Whether audio is currently playing */
  isPlaying: boolean;
  /** Number of chunks received so far */
  chunksReceived: number;
  /** Resume AudioContext after user gesture (call on button click) */
  resume: () => Promise<void>;
  /** Current AudioContext state ('suspended' | 'running' | 'closed') */
  contextState: AudioContextState | null;
  /** Set playback speed (0.7 - 2.0). Applied to subsequent chunks. */
  setPlaybackRate: (rate: number) => void;
  /** Current playback rate */
  playbackRate: number;
}

export function useAudioPlayback(): UseAudioPlaybackReturn {
  const [isPlaying, setIsPlaying] = useState(false);
  const [chunksReceived, setChunksReceived] = useState(0);
  const [contextState, setContextState] = useState<AudioContextState | null>(
    null,
  );

  const [playbackRate, setPlaybackRateState] = useState(1.0);

  // Refs for AudioContext state (not React state -- these are high-frequency)
  const ctxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const activeSourceCountRef = useRef(0);
  // Track whether we've been stopped/unmounted to avoid stale callbacks
  const stoppedRef = useRef(false);
  // Serialize playChunk calls to prevent race conditions from concurrent decoding
  const playChainRef = useRef<Promise<void>>(Promise.resolve());
  // Playback speed (applied to each AudioBufferSourceNode)
  const playbackRateRef = useRef(1.0);

  /** Create or return the AudioContext, updating state. */
  const ensureContext = useCallback((): AudioContext => {
    if (ctxRef.current && ctxRef.current.state !== "closed") {
      return ctxRef.current;
    }

    const ctx = new AudioContext();
    ctxRef.current = ctx;
    stoppedRef.current = false;
    nextStartTimeRef.current = 0;
    activeSourceCountRef.current = 0;

    // Track state changes
    ctx.onstatechange = () => {
      setContextState(ctx.state as AudioContextState);
    };
    setContextState(ctx.state as AudioContextState);

    return ctx;
  }, []);

  /** Resume AudioContext -- MUST be called from a user gesture handler. */
  const resume = useCallback(async () => {
    const ctx = ensureContext();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    setContextState(ctx.state as AudioContextState);
  }, [ensureContext]);

  /** Set playback speed (clamped to 0.7–2.0). */
  const setPlaybackRate = useCallback((rate: number) => {
    const clamped = Math.max(0.7, Math.min(2.0, rate));
    playbackRateRef.current = clamped;
    setPlaybackRateState(clamped);
  }, []);

  /** Feed an MP3 chunk for gapless playback. */
  const playChunk = useCallback(
    async (mp3Bytes: ArrayBuffer) => {
      const ctx = ensureContext();

      // Chain onto previous playChunk to serialize decode + schedule.
      // Without this, concurrent async handlers from ws.onmessage race
      // through decodeAudioData and corrupt nextStartTimeRef.
      const result = playChainRef.current.then(async () => {
        // Decode the MP3 chunk
        let audioBuffer: AudioBuffer;
        try {
          audioBuffer = await ctx.decodeAudioData(mp3Bytes);
        } catch (err) {
          console.warn(
            "[useAudioPlayback] Failed to decode audio chunk, skipping:",
            err,
          );
          return;
        }

        // If stop() was called while we were decoding, bail out
        if (stoppedRef.current) return;

        // Create a one-shot source node
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);

        // Apply playback speed
        const rate = playbackRateRef.current;
        source.playbackRate.value = rate;

        // Schedule for gapless playback
        const now = ctx.currentTime;
        const startTime = Math.max(nextStartTimeRef.current, now);
        source.start(startTime);

        // Advance the schedule cursor (adjusted for playback rate)
        nextStartTimeRef.current = startTime + audioBuffer.duration / rate;

        // Track active sources for isPlaying state
        activeSourceCountRef.current += 1;
        setIsPlaying(true);
        setChunksReceived((prev) => prev + 1);

        // Clean up when this source finishes playing
        source.onended = () => {
          // Release references for GC (source and buffer go out of scope)
          source.disconnect();
          activeSourceCountRef.current -= 1;
          if (activeSourceCountRef.current <= 0 && !stoppedRef.current) {
            activeSourceCountRef.current = 0;
            setIsPlaying(false);
          }
        };
      });
      playChainRef.current = result.catch(() => {}); // don't block chain on errors
      await result;
    },
    [ensureContext],
  );

  /** Stop all playback and reset state. Creates a fresh context on next use. */
  const stop = useCallback(() => {
    stoppedRef.current = true;

    if (ctxRef.current && ctxRef.current.state !== "closed") {
      ctxRef.current.close().catch(() => {
        // Ignore close errors -- context may already be closing
      });
    }
    ctxRef.current = null;
    nextStartTimeRef.current = 0;
    activeSourceCountRef.current = 0;
    playChainRef.current = Promise.resolve();

    setIsPlaying(false);
    setChunksReceived(0);
    setContextState(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stoppedRef.current = true;
      if (ctxRef.current && ctxRef.current.state !== "closed") {
        ctxRef.current.close().catch(() => {});
      }
      ctxRef.current = null;
    };
  }, []);

  return {
    playChunk,
    stop,
    isPlaying,
    chunksReceived,
    resume,
    contextState,
    setPlaybackRate,
    playbackRate,
  };
}
