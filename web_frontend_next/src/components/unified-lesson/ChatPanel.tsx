// web_frontend/src/components/unified-lesson/ChatPanel.tsx
import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useLayoutEffect,
} from "react";
import type {
  ChatMessage,
  Stage,
  PendingMessage,
} from "../../types/unified-lesson";
import { transcribeAudio } from "../../api/lessons";
import { Tooltip } from "../Tooltip";
import { StageIcon } from "./StageProgressBar";

type ChatPanelProps = {
  messages: ChatMessage[];
  pendingMessage: PendingMessage | null;
  onSendMessage: (content: string) => void;
  onRetryMessage: () => void;
  isLoading: boolean;
  streamingContent: string;
  currentStage: Stage | null;
  pendingTransition: boolean;
  onConfirmTransition: () => void;
  onContinueChatting: () => void;
  onSkipChat?: () => void;
  showDisclaimer?: boolean;
  isReviewing?: boolean;
  isPreviewing?: boolean;
};

type RecordingState = "idle" | "recording" | "transcribing";

export default function ChatPanel({
  messages,
  pendingMessage,
  onSendMessage,
  onRetryMessage,
  isLoading,
  streamingContent,
  currentStage,
  pendingTransition,
  onConfirmTransition,
  onContinueChatting,
  onSkipChat,
  showDisclaimer = false,
  isReviewing = false,
  isPreviewing = false,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Infinite canvas scrolling refs
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lastUserMessageRef = useRef<HTMLDivElement>(null);
  const aiResponseRef = useRef<HTMLDivElement>(null);
  const [spacerHeight, setSpacerHeight] = useState(0);

  // Recording state
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [recordingTime, setRecordingTime] = useState(0);
  const [volumeBars, setVolumeBars] = useState<number[]>([0, 0, 0, 0, 0]); // 5 bars with jittered volume
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
  const isRecordingRef = useRef(false); // For animation loop (avoids stale closure)
  const recordingTimeRef = useRef(0); // For stopRecording check (avoids stale closure)
  const smoothedVolumeRef = useRef(0); // For decay calculation
  const pcmDataRef = useRef<Float32Array<ArrayBuffer> | null>(null); // Reuse buffer

  const MAX_RECORDING_TIME = 120; // 2 minutes
  const WARNING_TIME = 60; // Show warning after 1 minute
  const MIN_RECORDING_TIME = 0.5; // seconds

  // Scroll user message to TOP when they send it
  // Don't scroll during streaming - let user read at their own pace
  useLayoutEffect(() => {
    if (pendingMessage) {
      // Small delay to ensure ref is attached after render
      requestAnimationFrame(() => {
        lastUserMessageRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    }
  }, [pendingMessage]);

  // Track whether spacer should be active (activated when user sends message)
  const [spacerActive, setSpacerActive] = useState(false);

  // Activate spacer when user sends a message
  useEffect(() => {
    if (pendingMessage) {
      setSpacerActive(true);
    }
  }, [pendingMessage]);

  // Calculate spacer height for infinite canvas scrolling
  // Spacer allows user message to scroll to top, shrinks as AI content grows
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !spacerActive) {
      return;
    }

    const calculateSpacer = () => {
      const containerHeight = container.clientHeight;

      // Find the last user message (either pending or the last one in messages)
      const userMsg = lastUserMessageRef.current;
      const userMsgHeight = userMsg?.offsetHeight || 0;

      // Find AI response - either streaming or the last assistant message
      const aiResponse = aiResponseRef.current;
      const aiResponseHeight = aiResponse?.offsetHeight || 0;

      // Spacer fills remaining viewport after user message + AI response
      // This allows user message to scroll to top of viewport
      const contentHeight = userMsgHeight + aiResponseHeight + 24; // 24px for gap
      const remaining = Math.max(0, containerHeight - contentHeight);

      // If content fills the space, deactivate spacer entirely
      if (remaining === 0) {
        setSpacerActive(false);
        setSpacerHeight(0);
      } else {
        setSpacerHeight(remaining);
      }
    };

    calculateSpacer();

    // Use ResizeObserver for responsive updates during streaming
    const resizeObserver = new ResizeObserver(calculateSpacer);
    resizeObserver.observe(container);

    // Observe user message and AI response for size changes
    const userMsg = lastUserMessageRef.current;
    const aiResponse = aiResponseRef.current;
    if (userMsg) resizeObserver.observe(userMsg);
    if (aiResponse) resizeObserver.observe(aiResponse);

    return () => resizeObserver.disconnect();
  }, [spacerActive, streamingContent, messages]);

  // Auto-resize textarea based on content
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      const maxHeight = 400;
      const needsScroll = textarea.scrollHeight > maxHeight;
      textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
      textarea.style.overflowY = needsScroll ? "auto" : "hidden";
    }
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

  // Volume meter - updates 5 bars with current volume + random jitter
  const lastUpdateRef = useRef(0);
  const updateAudioLevel = useCallback(() => {
    if (!analyserRef.current || !isRecordingRef.current) return;

    // Keep AudioContext alive (Chrome suspends inactive contexts)
    if (audioContextRef.current?.state === "suspended") {
      audioContextRef.current.resume();
    }

    // Reuse buffer to avoid GC
    if (!pcmDataRef.current) {
      pcmDataRef.current = new Float32Array(analyserRef.current.fftSize);
    }
    analyserRef.current.getFloatTimeDomainData(pcmDataRef.current);

    // Calculate RMS volume
    let sumSquares = 0;
    for (const amplitude of pcmDataRef.current) {
      sumSquares += amplitude * amplitude;
    }
    const rms = Math.sqrt(sumSquares / pcmDataRef.current.length);
    const instantVolume = Math.min(1, rms * 4); // Scale for visibility

    // Fast attack, slow decay (0.97 = holds volume longer for slower sample rate)
    const decay = 0.97;
    smoothedVolumeRef.current = Math.max(
      instantVolume,
      smoothedVolumeRef.current * decay
    );

    // Update bars every ~150ms (~7fps) with current volume + random jitter (±30%)
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

      // Set up audio analysis (simple proven approach from jameshfisher.com)
      audioContextRef.current = new AudioContext();
      if (audioContextRef.current.state === "suspended") {
        await audioContextRef.current.resume();
      }
      sourceRef.current =
        audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      sourceRef.current.connect(analyserRef.current);
      // Note: NOT connected to destination - just source → analyser

      // Set up MediaRecorder
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

      // Start timer
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
          // Stop recording after max time
          setTimeout(() => stopRecording(), 0);
        }
      }, 1000);

      // Start audio level updates
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

    // Stop animation loop immediately
    isRecordingRef.current = false;

    // Check minimum recording time
    if (recordingTimeRef.current < MIN_RECORDING_TIME) {
      // Cancel recording - too short
      mediaRecorderRef.current.stop();
      cleanupRecording();
      return;
    }

    // Stop timer and audio analysis
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

    // Stop recording and get audio
    const mediaRecorder = mediaRecorderRef.current;

    await new Promise<void>((resolve) => {
      mediaRecorder.onstop = () => resolve();
      mediaRecorder.stop();
    });

    // Clean up stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    // Transcribe
    const audioBlob = new Blob(audioChunksRef.current, {
      type: mediaRecorder.mimeType,
    });

    try {
      const text = await transcribeAudio(audioBlob);
      if (text.trim()) {
        // Append to existing input
        setInput((prev) => (prev ? `${prev} ${text}` : text));
      } else {
        setErrorMessage("No speech detected");
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Transcription failed"
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
    // Do nothing if transcribing
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      onSendMessage(input.trim());
      setInput("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4">
        <div className="max-w-[620px] mx-auto space-y-3">
          {messages.map((msg, i) => {
            // Check if this is the last assistant message (for spacer calculation)
            const isLastAssistant =
              msg.role === "assistant" &&
              !isLoading &&
              i === messages.length - 1;

            return msg.role === "system" ? (
              <div key={i} className="flex justify-center my-3">
                <span className="text-xs text-gray-500 bg-gray-100 px-3 py-1 rounded-full inline-flex items-center gap-1.5">
                  {msg.icon && <StageIcon type={msg.icon} small />}
                  {msg.content}
                </span>
              </div>
            ) : (
              <div
                key={i}
                ref={isLastAssistant ? aiResponseRef : undefined}
                className={`p-3 rounded-lg ${
                  msg.role === "assistant"
                    ? "bg-blue-50 text-gray-800"
                    : "bg-gray-100 text-gray-800 ml-8"
                }`}
              >
                <div className="text-xs text-gray-500 mb-1">
                  {msg.role === "assistant" ? "Tutor" : "You"}
                </div>
                <div className="whitespace-pre-wrap">{msg.content}</div>
              </div>
            );
          })}

          {/* Pending user message (optimistic) */}
          {pendingMessage && (
            <div
              ref={lastUserMessageRef}
              className={`p-3 rounded-lg ml-8 ${
                pendingMessage.status === "failed"
                  ? "bg-red-50 border border-red-200"
                  : "bg-gray-100"
              }`}
            >
              <div className="text-xs text-gray-500 mb-1 flex items-center justify-between">
                <span>You</span>
                {pendingMessage.status === "sending" && (
                  <span className="text-gray-400">Sending...</span>
                )}
                {pendingMessage.status === "failed" && (
                  <button
                    onClick={onRetryMessage}
                    className="text-red-600 hover:text-red-700 text-xs"
                  >
                    Failed - Click to retry
                  </button>
                )}
              </div>
              <div className="whitespace-pre-wrap text-gray-800">
                {pendingMessage.content}
              </div>
            </div>
          )}

          {/* Streaming message */}
          {isLoading && streamingContent && (
            <div ref={aiResponseRef} className="bg-blue-50 p-3 rounded-lg">
              <div className="text-xs text-gray-500 mb-1">Tutor</div>
              <div className="whitespace-pre-wrap">{streamingContent}</div>
            </div>
          )}

          {/* Loading indicator */}
          {isLoading && !streamingContent && (
            <div ref={aiResponseRef} className="bg-blue-50 p-3 rounded-lg">
              <div className="text-xs text-gray-500 mb-1">Tutor</div>
              <div className="text-gray-800">Thinking...</div>
            </div>
          )}

          {/* Transition prompt */}
          {pendingTransition && (
            <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg">
              <p className="text-yellow-800 mb-3">
                Ready to continue to the next part?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={onConfirmTransition}
                  className="bg-yellow-600 text-white px-4 py-2 rounded hover:bg-yellow-700"
                >
                  Continue
                </button>
                <button
                  onClick={onContinueChatting}
                  className="bg-white text-yellow-700 px-4 py-2 rounded border border-yellow-300 hover:bg-yellow-50"
                >
                  Keep chatting
                </button>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />

          {/* Dynamic spacer for infinite canvas scrolling */}
          {/* Allows user message to scroll to top, shrinks as AI content grows */}
          {spacerHeight > 0 && (
            <div
              aria-hidden="true"
              style={{ height: spacerHeight }}
              className="shrink-0"
            />
          )}
        </div>
      </div>

      {/* Disclaimer when not in chat stage */}
      {showDisclaimer && (
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 relative z-20">
          <div className="max-w-[620px] mx-auto">
            {isPreviewing ? (
              <>
                <p className="text-sm font-medium text-gray-800">
                  You're previewing upcoming content
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  Complete earlier stages to continue here. You can still ask
                  the AI tutor questions.
                </p>
              </>
            ) : isReviewing ? (
              <>
                <p className="text-sm font-medium text-gray-800">
                  You're reviewing previous content
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  You can ask the AI tutor questions, but it doesn't know that
                  you're reviewing older content.
                </p>
              </>
            ) : currentStage?.type === "article" ? (
              <>
                <p className="text-sm font-medium text-gray-800">
                  Please read the article
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  You can already chat with the AI tutor about it, but there
                  will also be a dedicated chat section after reading the
                  article.
                </p>
              </>
            ) : currentStage?.type === "video" ? (
              <>
                <p className="text-sm font-medium text-gray-800">
                  Please watch the video
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  You can already chat with the AI tutor about it, but there
                  will also be a dedicated chat section after watching the
                  video.
                </p>
              </>
            ) : (
              <p className="text-sm text-gray-500">
                Feel free to ask questions.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Skip chat button - shown in active chat stage */}
      {!showDisclaimer && !pendingTransition && onSkipChat && (
        <div className="px-4 py-3 border-t border-gray-100">
          <div className="max-w-[620px] mx-auto flex justify-end">
            <button
              onClick={onSkipChat}
              className="text-sm text-white bg-blue-500 hover:bg-blue-600 px-4 py-2 rounded-lg transition-colors"
            >
              Done chatting. Move to next article/video
            </button>
          </div>
        </div>
      )}

      {/* Error message */}
      {errorMessage && (
        <div className="px-4 py-2 bg-red-50 border-t border-red-100">
          <div className="max-w-[620px] mx-auto text-sm text-red-600">
            {errorMessage}
          </div>
        </div>
      )}

      {/* Recording time warning */}
      {showRecordingWarning && (
        <div className="px-4 py-2 bg-amber-50 border-t border-amber-100">
          <div className="max-w-[620px] mx-auto text-sm text-amber-700">
            Recording will automatically stop and transcribe after{" "}
            {MAX_RECORDING_TIME >= 60
              ? `${Math.floor(MAX_RECORDING_TIME / 60)} minute${MAX_RECORDING_TIME >= 120 ? "s" : ""}`
              : `${MAX_RECORDING_TIME} seconds`}
            . You can start another recording afterwards.
          </div>
        </div>
      )}

      {/* Input form */}
      <form
        onSubmit={handleSubmit}
        className="flex gap-2 p-4 border-t border-gray-200 items-end max-w-[620px] mx-auto w-full"
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            recordingState === "transcribing"
              ? "Transcribing..."
              : "Type a message..."
          }
          disabled={recordingState === "transcribing"}
          rows={1}
          className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none resize-none leading-normal disabled:bg-gray-100"
        />

        {/* Buttons with volume indicator above when recording */}
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
                disabled={recordingState === "transcribing"}
                className="p-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-default bg-gray-100 text-gray-600 hover:bg-gray-200"
              >
                {recordingState === "transcribing" ? (
                  // Spinner
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
                  // Microphone icon (pulses when recording)
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    style={
                      recordingState === "recording"
                        ? {
                            animation: "mic-pulse 1s ease-in-out infinite",
                          }
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
                  className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 min-w-[70px] flex items-center justify-center"
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
                  isLoading || !input.trim() || recordingState !== "idle"
                }
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-default min-w-[70px]"
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
