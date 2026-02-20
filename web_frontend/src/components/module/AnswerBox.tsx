/**
 * AnswerBox - Inline free-text answer component for question segments.
 *
 * Renders a question prompt with an auto-expanding textarea that auto-saves
 * via the useAutoSave hook. Supports voice input via useVoiceRecording,
 * completion, character counting, enforceVoice mode, and loading existing answers.
 */

import { useEffect, useRef } from "react";
import type { QuestionSegment } from "@/types/module";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useVoiceRecording } from "@/hooks/useVoiceRecording";
import FeedbackChat from "./FeedbackChat";

interface AnswerBoxProps {
  segment: QuestionSegment;
  moduleSlug: string;
  sectionIndex: number;
  segmentIndex: number;
  learningOutcomeId?: string | null;
  contentId?: string | null;
  isAuthenticated: boolean;
  onComplete?: () => void;
}

export default function AnswerBox({
  segment,
  moduleSlug,
  sectionIndex,
  segmentIndex,
  learningOutcomeId,
  contentId,
  isAuthenticated,
  onComplete,
}: AnswerBoxProps) {
  const questionId = `${moduleSlug}:${sectionIndex}:${segmentIndex}`;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const voiceUsedRef = useRef(false);
  const justCompletedRef = useRef(false);

  const {
    text,
    setText,
    setMetadata,
    saveStatus,
    isCompleted,
    markComplete,
    reopenAnswer,
    isLoading,
  } = useAutoSave({
    questionId,
    moduleSlug,
    learningOutcomeId,
    contentId,
    isAuthenticated,
  });

  const {
    recordingState,
    recordingTime,
    volumeBars,
    errorMessage,
    showRecordingWarning,
    handleMicClick,
    formatTime,
  } = useVoiceRecording({
    onTranscription: (transcribedText) => {
      setText(text ? `${text} ${transcribedText}` : transcribedText);
      // Track that voice was used in metadata
      if (!voiceUsedRef.current) {
        voiceUsedRef.current = true;
        setMetadata({ voice_used: true });
      }
    },
  });

  // Auto-expand textarea (preserve scroll position to prevent viewport jumping)
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      const scrollY = window.scrollY;
      textarea.style.height = "0";
      textarea.style.height = `${Math.max(textarea.scrollHeight, 120)}px`;
      window.scrollTo(0, scrollY);
    }
  }, [text]);

  // Wrap markComplete to also notify parent via onComplete callback
  const handleFinish = async () => {
    justCompletedRef.current = true;
    await markComplete();
    onComplete?.();
  };

  const isOverLimit = segment.maxChars ? text.length > segment.maxChars : false;
  const enforceVoice = segment.enforceVoice === true;

  return (
    <div className="py-6">
      <div className="max-w-content mx-auto">
        {/* Question prompt */}
        <p className="text-stone-700 text-[1.05rem] font-medium leading-relaxed mb-3">
          {segment.userInstruction}
        </p>

        {/* Loading state */}
        {isLoading ? (
          <div className="w-full min-h-[120px] rounded-lg bg-stone-100 animate-pulse" />
        ) : isCompleted ? (
          /* Completed state */
          <div>
            <div className="w-full rounded-lg bg-stone-50 border border-stone-200 px-4 py-3 text-stone-700 leading-relaxed whitespace-pre-wrap">
              {text}
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-emerald-600 flex items-center gap-1">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Completed
              </span>
              <button
                onClick={reopenAnswer}
                className="text-xs text-stone-400 hover:text-stone-600 transition-colors"
              >
                Answer again
              </button>
            </div>
            {segment.feedback && (
              <FeedbackChat
                questionId={questionId}
                moduleSlug={moduleSlug}
                answerText={text}
                isAuthenticated={isAuthenticated}
                autoTrigger={justCompletedRef.current}
              />
            )}
          </div>
        ) : (
          /* Active editing state */
          <div>
            {/* Textarea with mic button */}
            <div className="relative">
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-4 py-3 pr-12 resize-none overflow-hidden focus:outline-none focus:ring-2 focus:ring-blue-500 leading-relaxed text-stone-800 placeholder:text-stone-300 bg-white"
                placeholder={
                  recordingState === "transcribing"
                    ? "Transcribing..."
                    : enforceVoice
                      ? "Use the mic button to record your answer, or type here..."
                      : "Type your answer..."
                }
                disabled={recordingState === "transcribing"}
                style={{ minHeight: "120px" }}
                maxLength={segment.maxChars}
              />

              {/* Mic button - positioned inside textarea area */}
              <button
                type="button"
                onClick={handleMicClick}
                disabled={recordingState === "transcribing"}
                aria-label={
                  recordingState === "recording"
                    ? "Stop recording"
                    : "Start voice recording"
                }
                className={`absolute top-3 right-3 p-2 rounded-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-default focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  recordingState === "recording"
                    ? "bg-red-100 text-red-600 hover:bg-red-200"
                    : enforceVoice
                      ? "bg-blue-100 text-blue-600 hover:bg-blue-200"
                      : "bg-stone-100 text-stone-500 hover:bg-stone-200"
                }`}
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
            </div>

            {/* Recording UI: volume bars + timer */}
            {recordingState === "recording" && (
              <div className="flex items-center gap-3 mt-2 px-1">
                <div className="flex items-end gap-1 h-5">
                  {volumeBars.map((vol, i) => (
                    <div
                      key={i}
                      className="w-1.5 bg-red-400 rounded-sm transition-[height] duration-100"
                      style={{
                        height: `${Math.max(4, Math.min(1, vol * 2) * 20)}px`,
                      }}
                    />
                  ))}
                </div>
                <span className="text-xs text-stone-500 tabular-nums">
                  {formatTime(recordingTime)}
                </span>
                <button
                  type="button"
                  onClick={handleMicClick}
                  className="text-xs text-red-600 hover:text-red-700 ml-auto"
                >
                  Stop
                </button>
              </div>
            )}

            {/* Recording warning */}
            {showRecordingWarning && (
              <div className="mt-1 px-1">
                <span className="text-xs text-amber-600">
                  Recording will stop after 2 minutes.
                </span>
              </div>
            )}

            {/* Error message */}
            {errorMessage && (
              <div className="mt-1 px-1">
                <span className="text-xs text-red-500">{errorMessage}</span>
              </div>
            )}

            {/* Footer: save status + char count + finish button */}
            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center gap-3">
                {/* Save status */}
                <span
                  className={`text-xs transition-opacity duration-300 ${
                    saveStatus === "saving"
                      ? "text-stone-400 opacity-100"
                      : saveStatus === "saved"
                        ? "text-stone-400 opacity-100"
                        : saveStatus === "error"
                          ? "text-red-500 opacity-100"
                          : "opacity-0"
                  }`}
                >
                  {saveStatus === "saving"
                    ? "Saving..."
                    : saveStatus === "saved"
                      ? "Saved"
                      : saveStatus === "error"
                        ? "Error saving"
                        : "\u00A0"}
                </span>

                {/* Character count */}
                {segment.maxChars != null && (
                  <span
                    className={`text-xs ${isOverLimit ? "text-red-500" : "text-stone-400"}`}
                  >
                    {text.length}/{segment.maxChars}
                  </span>
                )}
              </div>

              {/* Finish button */}
              <button
                onClick={handleFinish}
                disabled={!text.trim()}
                className={`text-sm px-4 py-1.5 rounded-md transition-colors ${
                  text.trim()
                    ? "bg-stone-100 text-stone-600 hover:bg-stone-200 cursor-pointer"
                    : "bg-stone-50 text-stone-300 cursor-default"
                }`}
              >
                Finish
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
