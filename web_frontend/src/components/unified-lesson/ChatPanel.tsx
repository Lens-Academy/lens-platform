// web_frontend/src/components/unified-lesson/ChatPanel.tsx
import { useState, useRef, useEffect, useCallback } from "react";
import type { ChatMessage, Stage, PendingMessage } from "../../types/unified-lesson";
import { transcribeAudio } from "../../api/lessons";

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
  showDisclaimer?: boolean;
  isReviewing?: boolean;
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
  showDisclaimer = false,
  isReviewing = false,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Recording state
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [recordingTime, setRecordingTime] = useState(0);
  const [volumeLevel, setVolumeLevel] = useState(0); // Single volume bar (0-1)
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
  const smoothedVolumeRef = useRef(0); // For decay calculation
  const pcmDataRef = useRef<Float32Array | null>(null); // Reuse buffer

  const MAX_RECORDING_TIME = 60; // seconds
  const MIN_RECORDING_TIME = 0.5; // seconds

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent, pendingMessage]);

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

  // Volume meter with fast attack, slow decay (like system mic settings)
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

    // Fast attack, slow decay (0.92 = ~50ms decay at 60fps)
    const decay = 0.92;
    smoothedVolumeRef.current = Math.max(instantVolume, smoothedVolumeRef.current * decay);

    setVolumeLevel(smoothedVolumeRef.current);

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
      sourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
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
      timerIntervalRef.current = window.setInterval(() => {
        setRecordingTime((prev) => {
          if (prev >= MAX_RECORDING_TIME - 1) {
            stopRecording();
            return prev;
          }
          return prev + 1;
        });
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
    if (!mediaRecorderRef.current || recordingState !== "recording") return;

    // Stop animation loop immediately
    isRecordingRef.current = false;

    // Check minimum recording time
    if (recordingTime < MIN_RECORDING_TIME) {
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
    setVolumeLevel(0);
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
    setRecordingTime(0);
    setVolumeLevel(0);
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
      <div className="flex-1 overflow-y-auto space-y-3 p-4">
        {messages.map((msg, i) =>
          msg.role === "system" ? (
            <div key={i} className="flex justify-center my-3">
              <span className="text-xs text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
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
              <div className="whitespace-pre-wrap">{msg.content}</div>
            </div>
          )
        )}

        {/* Pending user message (optimistic) */}
        {pendingMessage && (
          <div className={`p-3 rounded-lg ml-8 ${
            pendingMessage.status === "failed"
              ? "bg-red-50 border border-red-200"
              : "bg-gray-100"
          }`}>
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
            <div className="whitespace-pre-wrap text-gray-800">{pendingMessage.content}</div>
          </div>
        )}

        {/* Streaming message */}
        {isLoading && streamingContent && (
          <div className="bg-blue-50 p-3 rounded-lg">
            <div className="text-xs text-gray-500 mb-1">Tutor</div>
            <div className="whitespace-pre-wrap">{streamingContent}</div>
          </div>
        )}

        {/* Loading indicator */}
        {isLoading && !streamingContent && (
          <div className="bg-blue-50 p-3 rounded-lg">
            <div className="text-xs text-gray-500 mb-1">Tutor</div>
            <div className="text-gray-800">Thinking...</div>
          </div>
        )}

        {/* Transition prompt */}
        {pendingTransition && (
          <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg">
            <p className="text-yellow-800 mb-3">Ready to continue to the next part?</p>
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
      </div>

      {/* Disclaimer when not in chat stage */}
      {showDisclaimer && (
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 relative z-20">
          {isReviewing ? (
            <>
              <p className="text-sm font-medium text-gray-800">You're reviewing a previous article/video</p>
              <p className="text-sm text-gray-500 mt-1">
                You can ask the AI tutor questions, but it doesn't know that you're reviewing older content.
              </p>
            </>
          ) : currentStage?.type === "article" ? (
            <>
              <p className="text-sm font-medium text-gray-800">Please read the article</p>
              <p className="text-sm text-gray-500 mt-1">
                You can already chat with the AI tutor about it, but there will also be a dedicated chat section after reading the article.
              </p>
            </>
          ) : currentStage?.type === "video" ? (
            <>
              <p className="text-sm font-medium text-gray-800">Please watch the video</p>
              <p className="text-sm text-gray-500 mt-1">
                You can already chat with the AI tutor about it, but there will also be a dedicated chat section after watching the video.
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-500">Feel free to ask questions.</p>
          )}
        </div>
      )}

      {/* Error message */}
      {errorMessage && (
        <div className="px-4 py-2 text-sm text-red-600 bg-red-50 border-t border-red-100">
          {errorMessage}
        </div>
      )}

      {/* Input form */}
      <form onSubmit={handleSubmit} className="flex gap-2 p-4 border-t border-gray-200 items-end">
        {recordingState === "recording" ? (
          // Recording indicator with volume bar
          <div className="flex-1 flex items-center gap-3 border border-red-300 bg-red-50 rounded-lg px-4 py-2">
            {/* Volume bar (like system mic settings) */}
            <div className="w-24 h-3 bg-red-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-red-500 rounded-full transition-[width] duration-[50ms]"
                style={{ width: `${volumeLevel * 100}%` }}
              />
            </div>
            <span className="text-red-700">Recording... {formatTime(recordingTime)}</span>
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={recordingState === "transcribing" ? "Transcribing..." : "Type a message..."}
            disabled={isLoading || recordingState === "transcribing"}
            rows={1}
            className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none resize-none leading-normal disabled:bg-gray-100"
          />
        )}

        {/* Mic button */}
        <button
          type="button"
          onClick={handleMicClick}
          disabled={isLoading || recordingState === "transcribing"}
          className={`p-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            recordingState === "recording"
              ? "bg-red-100 text-red-600 hover:bg-red-200"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
          title={recordingState === "recording" ? "Stop recording" : "Start recording"}
        >
          {recordingState === "transcribing" ? (
            // Spinner
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : recordingState === "recording" ? (
            // Stop icon
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
          ) : (
            // Microphone icon
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          )}
        </button>

        <button
          type="submit"
          disabled={isLoading || !input.trim() || recordingState !== "idle"}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </form>
    </div>
  );
}
