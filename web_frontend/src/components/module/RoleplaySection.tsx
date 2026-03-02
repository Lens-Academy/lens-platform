/**
 * RoleplaySection - Main roleplay conversation component.
 *
 * Uses the unified roleplay WebSocket hook for concurrent LLM text + TTS
 * audio streaming. Wires together toggles, sub-components (briefing, toolbar,
 * voice input, speaking indicator) into the full user-facing roleplay experience.
 *
 * Manages its own state entirely -- separate from Module.tsx's shared chat state
 * (Pitfall 2: no cross-contamination with tutor chat).
 */

import { useState, useCallback, useRef, useEffect } from "react";
import type { RoleplaySegment } from "@/types/module";
import { useUnifiedRoleplay } from "@/hooks/useUnifiedRoleplay";
import { useRoleplayToggles } from "@/hooks/useRoleplayToggles";
import {
  completeRoleplay,
  retryRoleplay,
  getRoleplayAssessment,
} from "@/api/roleplay";
import { extractCharacterName } from "@/utils/extractCharacterName";
import { useVoiceRecording } from "@/hooks/useVoiceRecording";
import { triggerHaptic } from "@/utils/haptics";
import ChatMarkdown from "@/components/ChatMarkdown";
import RoleplayBriefing from "./RoleplayBriefing";
import RoleplayToolbar from "./RoleplayToolbar";
import VoiceInputBar from "./VoiceInputBar";
import SpeakingIndicator from "./SpeakingIndicator";

type AssessmentData = {
  score_data: {
    overall_score: number;
    reasoning: string;
    dimensions?: Array<{ name: string; score: number; note?: string }>;
    key_observations?: string[];
  };
  model_id: string | null;
  created_at: string;
};

type RoleplaySectionProps = {
  segment: RoleplaySegment;
  moduleSlug: string;
  onComplete?: () => void;
  onFeedbackTrigger?: (assessmentSummary: string) => void;
};

export default function RoleplaySection({
  segment,
  moduleSlug,
  onComplete,
  onFeedbackTrigger,
}: RoleplaySectionProps) {
  const {
    textDisplay,
    ttsEnabled,
    inputMode,
    toggleTextDisplay,
    toggleTTS,
    toggleInputMode,
  } = useRoleplayToggles(segment.id);

  const {
    messages,
    streamingContent,
    status,
    sessionId,
    isCompleted,
    sendMessage,
    stopAudio,
    reset,
    markComplete,
  } = useUnifiedRoleplay({
    moduleSlug,
    roleplayId: segment.id,
    aiInstructions: segment.aiInstructions,
    scenarioContent: segment.content,
    openingMessage: segment.openingMessage,
    voice: ttsEnabled ? "Ashley" : undefined,
    speakingRate: ttsEnabled ? 1.5 : undefined,
  });

  const characterName = extractCharacterName(segment.aiInstructions);
  const isLoading = status === "streaming" || status === "connecting";

  // "Not started" = no messages yet and not loading — show Start button
  const notStarted = messages.length === 0 && !isLoading && !isCompleted;

  // Text mode: optional STT fills textarea (same as tutor chat)
  const [textInput, setTextInput] = useState("");
  const {
    recordingState,
    recordingTime,
    volumeBars,
    formatTime,
    handleMicClick,
  } = useVoiceRecording({
    onTranscription: (text) =>
      setTextInput((prev) => (prev ? `${prev} ${text}` : text)),
  });

  // Complete: stop audio, call REST API, update local state, notify parent
  const handleComplete = useCallback(async () => {
    stopAudio();
    if (sessionId) {
      await completeRoleplay(sessionId);
      markComplete();
      onComplete?.();
    }
  }, [stopAudio, sessionId, markComplete, onComplete]);

  // Retry: capture session ID, reset all state, then archive old session.
  // After reset, messages=[] so the "Start Conversation" button reappears.
  const handleRetry = useCallback(async () => {
    const oldSessionId = sessionId;
    reset();
    if (oldSessionId) {
      await retryRoleplay(oldSessionId, segment.openingMessage);
    }
  }, [reset, sessionId, segment.openingMessage]);

  // Send from text input
  const handleTextSend = useCallback(() => {
    if (textInput.trim() && !isLoading) {
      triggerHaptic(10);
      void sendMessage(textInput.trim());
      setTextInput("");
    }
  }, [textInput, isLoading, sendMessage]);

  // Wrapper for VoiceInputBar's onSend (needs to match (content: string) => void)
  const handleVoiceSend = useCallback((content: string) => {
    void sendMessage(content);
  }, [sendMessage]);

  // Assessment polling state
  const [assessmentState, setAssessmentState] = useState<
    "idle" | "loading" | "ready" | "unavailable"
  >("idle");
  const [assessmentData, setAssessmentData] = useState<AssessmentData | null>(
    null,
  );

  // Poll for assessment after completion (only if segment has assessment instructions)
  useEffect(() => {
    if (!isCompleted || !sessionId || !segment.assessmentInstructions) {
      return;
    }

    // If we already have assessment data (e.g., from a previous completion), skip
    if (assessmentState === "ready") return;

    setAssessmentState("loading");
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 15;
    const interval = 2000;

    const poll = async () => {
      while (!cancelled && attempts < maxAttempts) {
        try {
          const result = await getRoleplayAssessment(sessionId);
          if (cancelled) return;
          if (result) {
            setAssessmentData(result);
            setAssessmentState("ready");
            return;
          }
        } catch {
          // Ignore errors, keep polling
        }
        attempts++;
        if (attempts < maxAttempts && !cancelled) {
          await new Promise((r) => setTimeout(r, interval));
        }
      }
      if (!cancelled) {
        setAssessmentState("unavailable");
      }
    };

    void poll();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCompleted, sessionId, segment.assessmentInstructions]);

  // Build assessment summary for feedback chat
  const buildAssessmentSummary = useCallback((): string => {
    if (!assessmentData) return "";
    const { score_data } = assessmentData;
    let summary = `I just completed a roleplay exercise. Here are my results:\n\nScore: ${score_data.overall_score}/5\nReasoning: ${score_data.reasoning}`;
    if (score_data.key_observations && score_data.key_observations.length > 0) {
      summary += "\nKey observations:";
      for (const obs of score_data.key_observations) {
        summary += `\n- ${obs}`;
      }
    }
    summary += "\n\nCan you help me understand how to improve?";
    return summary;
  }, [assessmentData]);

  const chatScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamingContent]);

  return (
    <div className="py-4 px-4" style={{ overflowAnchor: "none" }}>
      <div className="max-w-content-padded mx-auto">
        {/* Briefing card -- always visible */}
        <RoleplayBriefing content={segment.content} />

        {/* Toolbar -- three toggles */}
        <div className="mt-3 border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
          <RoleplayToolbar
            textDisplay={textDisplay}
            ttsEnabled={ttsEnabled}
            inputMode={inputMode}
            onToggleText={toggleTextDisplay}
            onToggleTTS={toggleTTS}
            onToggleInput={toggleInputMode}
            disabled={isCompleted}
          />

          {/* Conversation area */}
          <div ref={chatScrollRef} className="px-4 py-4 max-h-[70vh] overflow-y-auto">
            {textDisplay ? (
              /* Full message list */
              <div className="space-y-4">
                {messages.map((msg, i) =>
                  msg.role === "assistant" ? (
                    <div key={i} className="text-gray-800">
                      <div className="text-sm text-indigo-600 font-medium mb-1">
                        {characterName}
                      </div>
                      <div className="bg-indigo-50 rounded-2xl p-3">
                        <ChatMarkdown>{msg.content}</ChatMarkdown>
                      </div>
                    </div>
                  ) : (
                    <div
                      key={i}
                      className="ml-auto max-w-[80%] bg-gray-100 text-gray-800 p-3 rounded-2xl"
                    >
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                    </div>
                  ),
                )}

                {/* Streaming response */}
                {isLoading && streamingContent && (
                  <div className="text-gray-800">
                    <div className="text-sm text-indigo-600 font-medium mb-1">
                      {characterName}
                    </div>
                    <div className="bg-indigo-50 rounded-2xl p-3">
                      <ChatMarkdown>{streamingContent}</ChatMarkdown>
                    </div>
                  </div>
                )}

                {/* Thinking indicator */}
                {isLoading && !streamingContent && (
                  <div className="text-gray-800">
                    <div className="text-sm text-indigo-600 font-medium mb-1">
                      {characterName}
                    </div>
                    <div className="bg-indigo-50 rounded-2xl p-3 text-gray-500">
                      Thinking...
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Text-off mode: speaking indicator */
              <SpeakingIndicator
                speaker={isLoading ? characterName : null}
                isUserTurn={!isLoading && !isCompleted}
              />
            )}
          </div>

          {/* Input area */}
          {notStarted ? (
            /* Not started: show Start Conversation button */
            <div className="border-t border-gray-100 px-4 py-6 text-center">
              <button
                onClick={() => void sendMessage("")}
                className="px-6 py-2.5 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 transition-colors font-medium"
              >
                Start Conversation (this will play audio)
              </button>
            </div>
          ) : !isCompleted ? (
            <div className="border-t border-gray-100 px-4 py-3">
              {inputMode === "text" ? (
                /* Text input with optional STT mic (same pattern as NarrativeChatSection) */
                <>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleTextSend();
                  }}
                  className="flex gap-2 items-end"
                >
                  <textarea
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleTextSend();
                      }
                    }}
                    placeholder={
                      recordingState === "transcribing"
                        ? "Transcribing..."
                        : "Type a message..."
                    }
                    disabled={isLoading || recordingState === "transcribing"}
                    rows={1}
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none leading-normal disabled:bg-gray-50 bg-transparent"
                  />
                  <div className="flex gap-1.5 shrink-0">
                    {/* Optional STT mic for text mode */}
                    <button
                      type="button"
                      onClick={handleMicClick}
                      disabled={recordingState === "transcribing"}
                      className={`min-w-[36px] min-h-[36px] p-2 rounded-lg transition-colors ${
                        recordingState === "recording"
                          ? "bg-red-500 text-white animate-pulse"
                          : "text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-default"
                      }`}
                      aria-label={
                        recordingState === "recording"
                          ? "Stop recording"
                          : "Start voice recording"
                      }
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
                    {/* Send button */}
                    <button
                      type="submit"
                      disabled={
                        isLoading ||
                        !textInput.trim() ||
                        recordingState !== "idle"
                      }
                      className="bg-indigo-600 text-white p-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-default min-w-[36px] min-h-[36px]"
                    >
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
                        />
                      </svg>
                    </button>
                  </div>
                </form>
                {recordingState === "recording" && (
                  <div className="flex items-center justify-center gap-2 pt-2">
                    <div className="flex items-end gap-1 h-5">
                      {volumeBars.map((vol, i) => (
                        <div
                          key={i}
                          className="w-1 bg-red-400 rounded-sm transition-[height] duration-100"
                          style={{ height: `${Math.max(4, Math.min(1, vol * 2) * 20)}px` }}
                        />
                      ))}
                    </div>
                    <span className="text-xs text-gray-500 tabular-nums">
                      {formatTime(recordingTime)}
                    </span>
                  </div>
                )}
                </>
              ) : (
                /* Voice input mode: push-to-talk */
                <VoiceInputBar
                  onSend={handleVoiceSend}
                  isLoading={isLoading}
                  disabled={isCompleted}
                />
              )}

              {/* Complete button -- right-aligned below input */}
              <div className="flex justify-end mt-2">
                <button
                  onClick={handleComplete}
                  disabled={isLoading || messages.length === 0}
                  className="text-sm px-4 py-1.5 border border-gray-300 rounded-full text-gray-600 hover:text-gray-800 hover:border-gray-400 disabled:opacity-50 disabled:cursor-default transition-colors"
                >
                  End Conversation
                </button>
              </div>
            </div>
          ) : (
            /* Done state */
            <div className="border-t border-gray-100 px-4 py-6">
              {/* Assessment score card */}
              {assessmentState === "loading" && (
                <div className="text-center mb-4">
                  <div className="inline-flex items-center gap-2 text-sm text-gray-500">
                    <svg
                      className="w-4 h-4 animate-spin"
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
                    Assessing your conversation...
                  </div>
                </div>
              )}

              {assessmentState === "ready" && assessmentData && (
                <div className="mb-4 mx-auto max-w-md">
                  <div className="border border-indigo-200 rounded-xl bg-indigo-50/50 p-4">
                    {/* Overall score */}
                    <div className="flex items-baseline gap-2 mb-2">
                      <span className="text-2xl font-semibold text-indigo-700">
                        {assessmentData.score_data.overall_score}/5
                      </span>
                      <span className="text-sm text-gray-500">Overall</span>
                    </div>

                    {/* Reasoning */}
                    <p className="text-sm text-gray-700 mb-3">
                      {assessmentData.score_data.reasoning}
                    </p>

                    {/* Dimensions */}
                    {assessmentData.score_data.dimensions &&
                      assessmentData.score_data.dimensions.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-3">
                          {assessmentData.score_data.dimensions.map((dim) => (
                            <div
                              key={dim.name}
                              className="flex items-center gap-1.5 bg-white rounded-lg px-2.5 py-1 text-sm border border-indigo-100"
                            >
                              <span className="font-medium text-indigo-600">
                                {dim.score}/5
                              </span>
                              <span className="text-gray-600">{dim.name}</span>
                            </div>
                          ))}
                        </div>
                      )}

                    {/* Key observations */}
                    {assessmentData.score_data.key_observations &&
                      assessmentData.score_data.key_observations.length > 0 && (
                        <ul className="text-sm text-gray-600 space-y-1">
                          {assessmentData.score_data.key_observations.map(
                            (obs, i) => (
                              <li key={i} className="flex gap-1.5">
                                <span className="text-indigo-400 shrink-0">
                                  -
                                </span>
                                <span>{obs}</span>
                              </li>
                            ),
                          )}
                        </ul>
                      )}

                    {/* Discuss button */}
                    {onFeedbackTrigger && (
                      <button
                        onClick={() =>
                          onFeedbackTrigger(buildAssessmentSummary())
                        }
                        className="mt-3 w-full text-sm px-4 py-2 border border-indigo-300 text-indigo-600 rounded-full hover:bg-indigo-100 transition-colors font-medium"
                      >
                        Discuss your performance
                      </button>
                    )}
                  </div>
                </div>
              )}

              {assessmentState !== "loading" &&
                assessmentState !== "ready" && (
                  <div className="text-sm text-gray-500 mb-3 text-center">
                    Conversation complete
                  </div>
                )}

              <div className="text-center">
                <button
                  onClick={handleRetry}
                  className="text-sm px-4 py-1.5 bg-indigo-50 text-indigo-600 rounded-full hover:bg-indigo-100 transition-colors"
                >
                  Try again
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
