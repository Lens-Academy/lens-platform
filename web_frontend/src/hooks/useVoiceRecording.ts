/**
 * useVoiceRecording - Reusable voice recording hook.
 *
 * Encapsulates microphone access, MediaRecorder, volume metering,
 * timer, transcription via API, and cleanup. Used by both
 * NarrativeChatSection (chat voice input) and AnswerBox (answer voice input).
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { transcribeAudio } from "@/api/modules";

export type RecordingState = "idle" | "recording" | "transcribing";

export interface UseVoiceRecordingOptions {
  onTranscription: (text: string) => void;
  onError?: (message: string) => void;
  maxRecordingTime?: number; // Default 120 seconds
  warningTime?: number; // Default 60 seconds
  minRecordingTime?: number; // Default 0.5 seconds
}

export interface UseVoiceRecordingReturn {
  recordingState: RecordingState;
  recordingTime: number;
  volumeBars: number[];
  errorMessage: string | null;
  showRecordingWarning: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  handleMicClick: () => void;
  formatTime: (seconds: number) => string;
}

export function useVoiceRecording(
  options: UseVoiceRecordingOptions,
): UseVoiceRecordingReturn {
  const {
    onTranscription,
    onError,
    maxRecordingTime: MAX_RECORDING_TIME = 120,
    warningTime: WARNING_TIME = 60,
    minRecordingTime: MIN_RECORDING_TIME = 0.5,
  } = options;

  // Keep stable references to callbacks
  const onTranscriptionRef = useRef(onTranscription);
  onTranscriptionRef.current = onTranscription;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // Recording state
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [recordingTime, setRecordingTime] = useState(0);
  const [volumeBars, setVolumeBars] = useState<number[]>([0, 0, 0, 0, 0]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showRecordingWarning, setShowRecordingWarning] = useState(false);

  // Recording refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const timerIntervalRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isRecordingRef = useRef(false);
  const recordingTimeRef = useRef(0);
  const smoothedVolumeRef = useRef(0);
  const pcmDataRef = useRef<Float32Array<ArrayBuffer> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // Clear error message after timeout (longer for persistent issues)
  const errorTimeoutRef = useRef<number>(3000);
  useEffect(() => {
    if (errorMessage) {
      const timer = setTimeout(() => setErrorMessage(null), errorTimeoutRef.current);
      return () => clearTimeout(timer);
    }
  }, [errorMessage]);

  // Volume meter
  const lastUpdateRef = useRef(0);
  const updateAudioLevel = useCallback(() => {
    if (!analyserRef.current || !isRecordingRef.current) return;

    if (audioContextRef.current?.state === "suspended") {
      audioContextRef.current.resume();
    }

    if (!pcmDataRef.current) {
      pcmDataRef.current = new Float32Array(analyserRef.current.fftSize);
    }
    analyserRef.current.getFloatTimeDomainData(pcmDataRef.current);

    let sumSquares = 0;
    for (const amplitude of pcmDataRef.current) {
      sumSquares += amplitude * amplitude;
    }
    const rms = Math.sqrt(sumSquares / pcmDataRef.current.length);
    const instantVolume = Math.min(1, rms * 4);

    const decay = 0.97;
    smoothedVolumeRef.current = Math.max(
      instantVolume,
      smoothedVolumeRef.current * decay,
    );

    const now = performance.now();
    if (now - lastUpdateRef.current > 150) {
      lastUpdateRef.current = now;
      const baseVol = smoothedVolumeRef.current;
      setVolumeBars([
        baseVol * (0.7 + Math.random() * 0.6),
        baseVol * (0.7 + Math.random() * 0.6),
        baseVol * (0.7 + Math.random() * 0.6),
        baseVol * (0.7 + Math.random() * 0.6),
        baseVol * (0.7 + Math.random() * 0.6),
      ]);
    }

    animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
  }, []);

  const cleanupRecording = useCallback(() => {
    setRecordingState("idle");
    isRecordingRef.current = false;
    recordingTimeRef.current = 0;
    setRecordingTime(0);
    setVolumeBars([0, 0, 0, 0, 0]);
    setShowRecordingWarning(false);
    smoothedVolumeRef.current = 0;
    pcmDataRef.current = null;
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];

    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
  }, []);

  const stopRecording = useCallback(async () => {
    if (!mediaRecorderRef.current || !isRecordingRef.current) return;

    isRecordingRef.current = false;

    if (recordingTimeRef.current < MIN_RECORDING_TIME) {
      mediaRecorderRef.current.stop();
      cleanupRecording();
      return;
    }

    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    setRecordingState("transcribing");
    setVolumeBars([0, 0, 0, 0, 0]);
    smoothedVolumeRef.current = 0;

    const mediaRecorder = mediaRecorderRef.current;

    await new Promise<void>((resolve) => {
      mediaRecorder.onstop = () => resolve();
      mediaRecorder.stop();
    });

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    const audioBlob = new Blob(audioChunksRef.current, {
      type: mediaRecorder.mimeType,
    });

    try {
      const text = await transcribeAudio(audioBlob);
      if (text.trim()) {
        onTranscriptionRef.current(text);
      } else {
        const msg = "No speech detected";
        setErrorMessage(msg);
        onErrorRef.current?.(msg);
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Transcription failed";
      setErrorMessage(msg);
      onErrorRef.current?.(msg);
    } finally {
      cleanupRecording();
    }
  }, [MIN_RECORDING_TIME, cleanupRecording]);

  const setError = useCallback((msg: string, timeout = 3000) => {
    errorTimeoutRef.current = timeout;
    setErrorMessage(msg);
    onErrorRef.current?.(msg);
  }, []);

  const startRecording = useCallback(async () => {
    setErrorMessage(null);

    // Guard: secure context required for getUserMedia
    if (!window.isSecureContext) {
      setError("Voice recording requires HTTPS", 8000);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Voice recording is not supported in this browser", 8000);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      audioContextRef.current = new AudioContext();
      if (audioContextRef.current.state === "suspended") {
        await audioContextRef.current.resume();
      }
      sourceRef.current =
        audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      sourceRef.current.connect(analyserRef.current);

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/mp4",
      });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.start();
      setRecordingState("recording");
      isRecordingRef.current = true;
      setRecordingTime(0);

      recordingTimeRef.current = 0;
      setShowRecordingWarning(false);
      timerIntervalRef.current = window.setInterval(() => {
        recordingTimeRef.current += 1;
        const currentTime = recordingTimeRef.current;
        setRecordingTime(currentTime);
        if (currentTime >= WARNING_TIME && currentTime < MAX_RECORDING_TIME) {
          setShowRecordingWarning(true);
        }
        if (currentTime >= MAX_RECORDING_TIME) {
          setTimeout(() => stopRecording(), 0);
        }
      }, 1000);

      animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
    } catch (err) {
      // Clean up stream if getUserMedia succeeded but later setup failed
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      cleanupRecording();

      if (err instanceof Error && err.name === "NotAllowedError") {
        setError("Microphone permission denied — allow access and try again");
      } else if (err instanceof Error && err.name === "NotFoundError") {
        setError("No microphone found");
      } else if (err instanceof Error && err.name === "NotReadableError") {
        setError("Microphone is in use by another application");
      } else {
        setError("Could not access microphone");
      }
    }
  }, [MAX_RECORDING_TIME, WARNING_TIME, stopRecording, updateAudioLevel, cleanupRecording, setError]);

  const handleMicClick = useCallback(() => {
    if (recordingState === "idle") {
      startRecording();
    } else if (recordingState === "recording") {
      stopRecording();
    }
  }, [recordingState, startRecording, stopRecording]);

  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }, []);

  return {
    recordingState,
    recordingTime,
    volumeBars,
    errorMessage,
    showRecordingWarning,
    startRecording,
    stopRecording,
    handleMicClick,
    formatTime,
  };
}
