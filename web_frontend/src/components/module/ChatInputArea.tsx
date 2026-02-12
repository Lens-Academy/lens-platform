/**
 * ChatInputArea — shared input area for all chat surfaces
 * (NarrativeChatSection, ChatSidebar, ReflectionChatDialog).
 *
 * Handles:
 *   - Text input with auto-resize
 *   - Voice recording (mic) + transcription
 *   - Send button / stop recording button
 *   - Error messages (auto-clear after 3s)
 *   - Recording timer + volume bars
 */

import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { transcribeAudio } from "@/api/modules";
import { Tooltip } from "@/components/Tooltip";
import { triggerHaptic } from "@/utils/haptics";

type RecordingState = "idle" | "recording" | "transcribing";

type ChatInputAreaProps = {
  onSend: (content: string) => void;
  isLoading: boolean;
  disabled?: boolean;
  placeholder?: string;
};

export function ChatInputArea({
  onSend,
  isLoading,
  disabled = false,
  placeholder = "Type a message...",
}: ChatInputAreaProps) {
  const [input, setInput] = useState("");
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [recordingTime, setRecordingTime] = useState(0);
  const [volumeBars, setVolumeBars] = useState<number[]>([0, 0, 0, 0, 0]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showRecordingWarning, setShowRecordingWarning] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const MAX_RECORDING_TIME = 120;
  const WARNING_TIME = 60;
  const MIN_RECORDING_TIME = 0.5;

  // Auto-resize textarea
  // Empty → no inline height (rows={1} handles it natively)
  // Has content → measure scrollHeight and set explicit height
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    if (!input) {
      // Clear inline height so rows={1} controls the natural single-line size
      textarea.style.height = "";
      textarea.style.overflowY = "hidden";
      return;
    }

    // Collapse to 0 to measure true content height, then set
    textarea.style.height = "0";
    const maxHeight = 200;
    const scrollH = textarea.scrollHeight;
    textarea.style.height = `${Math.min(scrollH, maxHeight)}px`;
    textarea.style.overflowY = scrollH > maxHeight ? "auto" : "hidden";
  }, [input]);

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

  // Clear error message after 3 seconds
  useEffect(() => {
    if (errorMessage) {
      const timer = setTimeout(() => setErrorMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [errorMessage]);

  // Volume meter animation loop
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

  const startRecording = async () => {
    setErrorMessage(null);

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
      if (err instanceof Error && err.name === "NotAllowedError") {
        setErrorMessage("Microphone access required");
      } else {
        setErrorMessage("Could not access microphone");
      }
    }
  };

  const stopRecording = async () => {
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
        setInput((prev) => (prev ? `${prev} ${text}` : text));
      } else {
        setErrorMessage("No speech detected");
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Transcription failed",
      );
    } finally {
      cleanupRecording();
    }
  };

  const cleanupRecording = () => {
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
  };

  const handleMicClick = () => {
    if (recordingState === "idle") {
      startRecording();
    } else if (recordingState === "recording") {
      stopRecording();
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading && !disabled) {
      triggerHaptic(10);
      onSend(input.trim());
      setInput("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const isDisabled = disabled || isLoading;

  return (
    <div>
      {/* Error message */}
      {errorMessage && (
        <div
          role="alert"
          className="px-4 py-2 bg-red-50 border-t border-red-100"
        >
          <div className="text-sm text-red-600">{errorMessage}</div>
        </div>
      )}

      {/* Recording warning */}
      {showRecordingWarning && (
        <div className="px-4 py-2 bg-amber-50 border-t border-amber-100">
          <div className="text-sm text-amber-700">
            Recording will stop after 2 minutes.
          </div>
        </div>
      )}

      {/* Input form */}
      <form
        onSubmit={handleSubmit}
        className="flex gap-2 p-4 border-t border-gray-200 items-end"
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            // Delay to let iOS keyboard animation start
            setTimeout(() => {
              textareaRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "nearest",
              });
            }, 100);
          }}
          placeholder={
            recordingState === "transcribing" ? "Transcribing..." : placeholder
          }
          disabled={recordingState === "transcribing" || isDisabled}
          rows={1}
          className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none leading-normal disabled:bg-gray-100"
        />

        {/* Buttons */}
        <div className="flex flex-col items-center gap-1">
          {recordingState === "recording" && (
            <div className="flex items-center gap-2">
              <div className="flex items-end gap-1 h-6">
                {volumeBars.map((vol, i) => (
                  <div
                    key={i}
                    className="w-1.5 bg-gray-500 rounded-sm transition-[height] duration-100"
                    style={{
                      height: `${Math.max(6, Math.min(1, vol * 2) * 24)}px`,
                    }}
                  />
                ))}
              </div>
              <span className="text-sm text-gray-500 tabular-nums">
                {formatTime(recordingTime)}
              </span>
            </div>
          )}
          <div className="flex gap-2">
            <Tooltip
              content={
                recordingState === "recording"
                  ? "Stop recording"
                  : "Start recording"
              }
            >
              <button
                type="button"
                onClick={handleMicClick}
                disabled={recordingState === "transcribing" || isDisabled}
                aria-label={
                  recordingState === "recording"
                    ? "Stop recording"
                    : "Start voice recording"
                }
                className="min-w-[44px] min-h-[44px] p-2 rounded-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-default bg-gray-100 text-gray-600 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {recordingState === "transcribing" ? (
                  <svg
                    className="w-5 h-5 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                ) : (
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    style={
                      recordingState === "recording"
                        ? { animation: "mic-pulse 1s ease-in-out infinite" }
                        : undefined
                    }
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                    />
                  </svg>
                )}
              </button>
            </Tooltip>
            {recordingState === "recording" ? (
              <Tooltip content="Stop recording">
                <button
                  type="button"
                  onClick={handleMicClick}
                  aria-label="Stop recording"
                  className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[70px] min-h-[44px] flex items-center justify-center transition-all active:scale-95"
                >
                  <svg
                    className="w-5 h-5"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <rect x="6" y="6" width="12" height="12" rx="1" />
                  </svg>
                </button>
              </Tooltip>
            ) : (
              <button
                type="submit"
                disabled={
                  isLoading ||
                  !input.trim() ||
                  recordingState !== "idle" ||
                  isDisabled
                }
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-default min-w-[70px] min-h-[44px] transition-all active:scale-95"
              >
                Send
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
