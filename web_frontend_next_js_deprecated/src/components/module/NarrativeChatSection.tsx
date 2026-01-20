// web_frontend_next/src/components/narrative-lesson/NarrativeChatSection.tsx
"use client";

import { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage, PendingMessage } from "@/types/module";
import { transcribeAudio } from "@/api/modules";
import { Tooltip } from "@/components/Tooltip";
import { StageIcon } from "@/components/module/StageProgressBar";

// Minimal markdown for chat - just inline formatting, no block elements
function ChatMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Inline formatting
        strong: ({ children }) => (
          <strong className="font-semibold">{children}</strong>
        ),
        em: ({ children }) => <em className="italic">{children}</em>,
        // Render paragraphs as spans to avoid block-level spacing
        p: ({ children }) => <span>{children}</span>,
        // Links
        a: ({ href, children }) => (
          <a
            href={href}
            className="text-blue-600 underline hover:text-blue-800"
            target="_blank"
            rel="noopener noreferrer"
          >
            {children}
          </a>
        ),
        // Disable block elements - render as plain text
        h1: ({ children }) => <span>{children}</span>,
        h2: ({ children }) => <span>{children}</span>,
        h3: ({ children }) => <span>{children}</span>,
        blockquote: ({ children }) => <span>{children}</span>,
        ul: ({ children }) => <span>{children}</span>,
        ol: ({ children }) => <span>{children}</span>,
        li: ({ children }) => <span>{children} </span>,
        pre: ({ children }) => <span>{children}</span>,
        code: ({ children }) => (
          <code className="bg-gray-100 px-1 rounded text-sm">{children}</code>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

type NarrativeChatSectionProps = {
  messages: ChatMessage[];
  pendingMessage: PendingMessage | null;
  streamingContent: string;
  isLoading: boolean;
  onSendMessage: (content: string) => void;
  onRetryMessage?: () => void;
};

type RecordingState = "idle" | "recording" | "transcribing";

/**
 * Chat section for NarrativeLesson.
 * Copied from ChatPanel with stage-specific features removed.
 */
export default function NarrativeChatSection({
  messages,
  pendingMessage,
  streamingContent,
  isLoading,
  onSendMessage,
  onRetryMessage,
}: NarrativeChatSectionProps) {
  // Local state - component stays mounted so no need for parent sync
  const [input, setInput] = useState("");
  const [hasInteracted, setHasInteracted] = useState(false);
  const [currentExchangeStartIndex, setCurrentExchangeStartIndex] = useState(0);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [scrollContainerHeight, setScrollContainerHeight] = useState(0);

  const currentExchangeRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const MAX_RECORDING_TIME = 120;
  const WARNING_TIME = 60;
  const MIN_RECORDING_TIME = 0.5;

  // Scroll user's new message to top when they send
  useLayoutEffect(() => {
    // Need scrollContainerHeight > 0 so minHeight is applied before scrolling
    if (pendingMessage && currentExchangeRef.current && scrollContainerRef.current && scrollContainerHeight > 0) {
      const container = scrollContainerRef.current;
      const element = currentExchangeRef.current;
      const elementTop = element.offsetTop;

      // Scroll the container (not the viewport) to show the element at the top
      container.scrollTo({
        top: elementTop - 24, // 24px matches the scrollMarginTop
        behavior: "instant",
      });
    }
  }, [pendingMessage, scrollContainerHeight]);

  // Scroll chat container into view when user first interacts
  useEffect(() => {
    if (hasInteracted && containerRef.current) {
      containerRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [hasInteracted]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      const maxHeight = 200;
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

  // Track scroll container height for min-height calculation
  useLayoutEffect(() => {
    if (!scrollContainerRef.current || !hasInteracted) return;

    const container = scrollContainerRef.current;

    // Set initial height immediately (fixes first-message scroll issue)
    setScrollContainerHeight(container.clientHeight);

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setScrollContainerHeight(entry.contentRect.height);
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [hasInteracted]);

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
      smoothedVolumeRef.current * decay
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
        // Append to existing input (input is now controlled via props)
        setInput(input ? `${input} ${text}` : text);
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
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      // Set split point before sending - current messages become "previous"
      setCurrentExchangeStartIndex(messages.length);
      setShowScrollButton(false); // Reset scroll button when sending new message
      setHasInteracted(true);
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

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const isAtBottom = distanceFromBottom < 50;
    setShowScrollButton(!isAtBottom);
  };

  const scrollToBottom = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  };

  return (
    <div className="max-w-[700px] mx-auto py-4 px-4" style={{ overflowAnchor: "none" }}>
      <div
        ref={containerRef}
        className="border border-gray-200 rounded-lg bg-white shadow-sm flex flex-col scroll-mb-8 relative"
        style={hasInteracted
          ? { height: "85vh", overflowAnchor: "none" }  // Fixed height when interacted to prevent jitter during streaming
          : { maxHeight: "85vh", minHeight: "180px", overflowAnchor: "none" }
        }
      >
        {/* Messages area */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto p-4"
          style={{ overflowAnchor: "none" }}
          onScroll={handleScroll}
        >
          {hasInteracted ? (
            <div className="max-w-[620px] mx-auto">
              {/* Previous messages - natural height */}
              {currentExchangeStartIndex > 0 && (
                <div className="space-y-3 pb-3">
                  {messages.slice(0, currentExchangeStartIndex).map((msg, i) =>
                    msg.role === "system" ? (
                      <div key={i} className="flex justify-center my-3">
                        <span className="text-xs text-gray-500 bg-gray-100 px-3 py-1 rounded-full inline-flex items-center gap-1.5">
                          {msg.icon && <StageIcon type={msg.icon} small />}
                          {msg.content}
                        </span>
                      </div>
                    ) : (
                      <div
                        key={i}
                        className={`p-3 rounded-lg ${
                          msg.role === "assistant"
                            ? "bg-blue-50 text-gray-800"
                            : "bg-gray-100 text-gray-800 ml-8"
                        }`}
                      >
                        <div className="text-xs text-gray-500 mb-1">
                          {msg.role === "assistant" ? "Tutor" : "You"}
                        </div>
                        <div className="whitespace-pre-wrap">
                          {msg.role === "assistant" ? (
                            <ChatMarkdown>{msg.content}</ChatMarkdown>
                          ) : (
                            msg.content
                          )}
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}

              {/* Current exchange - min height with spacer */}
              <div
                ref={currentExchangeRef}
                className="flex flex-col"
                style={{
                  scrollMarginTop: "24px",
                  minHeight: scrollContainerHeight > 0 ? `${scrollContainerHeight}px` : undefined,
                }}
              >
                <div className="space-y-3">
                  {/* Current exchange messages */}
                  {messages.slice(currentExchangeStartIndex).map((msg, i) =>
                    msg.role === "system" ? (
                      <div key={`current-${i}`} className="flex justify-center my-3">
                        <span className="text-xs text-gray-500 bg-gray-100 px-3 py-1 rounded-full inline-flex items-center gap-1.5">
                          {msg.icon && <StageIcon type={msg.icon} small />}
                          {msg.content}
                        </span>
                      </div>
                    ) : (
                      <div
                        key={`current-${i}`}
                        className={`p-3 rounded-lg ${
                          msg.role === "assistant"
                            ? "bg-blue-50 text-gray-800"
                            : "bg-gray-100 text-gray-800 ml-8"
                        }`}
                      >
                        <div className="text-xs text-gray-500 mb-1">
                          {msg.role === "assistant" ? "Tutor" : "You"}
                        </div>
                        <div className="whitespace-pre-wrap">
                          {msg.role === "assistant" ? (
                            <ChatMarkdown>{msg.content}</ChatMarkdown>
                          ) : (
                            msg.content
                          )}
                        </div>
                      </div>
                    )
                  )}

                  {/* Pending user message */}
                  {pendingMessage && (
                    <div
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
                        {pendingMessage.status === "failed" && onRetryMessage && (
                          <button
                            onClick={onRetryMessage}
                            className="text-red-600 hover:text-red-700 text-xs focus:outline-none focus:underline"
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

                  {/* Streaming response */}
                  {isLoading && streamingContent && (
                    <div className="bg-blue-50 p-3 rounded-lg">
                      <div className="text-xs text-gray-500 mb-1">Tutor</div>
                      <div className="whitespace-pre-wrap">
                        <ChatMarkdown>{streamingContent}</ChatMarkdown>
                      </div>
                    </div>
                  )}

                  {/* Loading indicator */}
                  {isLoading && !streamingContent && (
                    <div className="bg-blue-50 p-3 rounded-lg">
                      <div className="text-xs text-gray-500 mb-1">Tutor</div>
                      <div className="text-gray-800">Thinking...</div>
                    </div>
                  )}
                </div>

                {/* Spacer - fills remaining viewport space */}
                <div className="flex-grow" />
              </div>
            </div>
          ) : (
            // Empty state before first interaction
            <div className="h-full flex flex-col items-center justify-center text-gray-400">
              <svg
                className="w-12 h-12 mb-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
              <p className="text-sm">Send a message to start the discussion</p>
            </div>
          )}
        </div>

        {/* Scroll to bottom button */}
        {showScrollButton && hasInteracted && (
          <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-10">
            <button
              onClick={scrollToBottom}
              className="bg-white border border-gray-300 rounded-full p-2 shadow-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Scroll to bottom"
            >
              <svg
                className="w-5 h-5 text-gray-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 14l-7 7m0 0l-7-7m7 7V3"
                />
              </svg>
            </button>
          </div>
        )}

        {/* Error message */}
        {errorMessage && (
          <div role="alert" className="px-4 py-2 bg-red-50 border-t border-red-100">
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
            placeholder={
              recordingState === "transcribing"
                ? "Transcribing..."
                : "Type a message..."
            }
            disabled={recordingState === "transcribing"}
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
                  disabled={recordingState === "transcribing"}
                  aria-label={recordingState === "recording" ? "Stop recording" : "Start voice recording"}
                  className="p-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-default bg-gray-100 text-gray-600 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[70px] flex items-center justify-center"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <rect x="6" y="6" width="12" height="12" rx="1" />
                    </svg>
                  </button>
                </Tooltip>
              ) : (
                <button
                  type="submit"
                  disabled={isLoading || !input.trim() || recordingState !== "idle"}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-default min-w-[70px]"
                >
                  Send
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
