/**
 * AnswerBox - Inline free-text answer component for question segments.
 *
 * Renders a question prompt with an auto-expanding textarea that auto-saves
 * via the useAutoSave hook. Supports completion, character counting, and
 * loading existing answers.
 */

import { useEffect, useRef } from "react";
import type { QuestionSegment } from "@/types/module";
import { useAutoSave } from "@/hooks/useAutoSave";

interface AnswerBoxProps {
  segment: QuestionSegment;
  moduleSlug: string;
  sectionIndex: number;
  segmentIndex: number;
  learningOutcomeId?: string | null;
  contentId?: string | null;
  isAuthenticated: boolean;
}

export default function AnswerBox({
  segment,
  moduleSlug,
  sectionIndex,
  segmentIndex,
  learningOutcomeId,
  contentId,
  isAuthenticated,
}: AnswerBoxProps) {
  const questionId = `${moduleSlug}:${sectionIndex}:${segmentIndex}`;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    text,
    setText,
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

  // Auto-expand textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [text]);

  const isOverLimit = segment.maxChars ? text.length > segment.maxChars : false;

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
          </div>
        ) : (
          /* Active editing state */
          <div>
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full border border-stone-200 rounded-lg px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 leading-relaxed text-stone-800 placeholder:text-stone-300 bg-white"
              placeholder="Type your answer..."
              style={{ minHeight: "120px" }}
              maxLength={segment.maxChars}
            />

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
                onClick={markComplete}
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
