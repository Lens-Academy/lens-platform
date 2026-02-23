/**
 * TestQuestionCard - Individual question wrapper for test sections.
 *
 * Handles three visual states:
 * - Hidden: question not yet revealed
 * - Active: question is being answered (renders AnswerBox)
 * - Collapsed: question answered, shows single-line "Answered" indicator
 *
 * Timer tracking starts when question becomes active.
 */

import { useEffect, useRef } from "react";
import type { QuestionSegment } from "@/types/module";
import AnswerBox from "@/components/module/AnswerBox";

interface TestQuestionCardProps {
  question: QuestionSegment;
  questionIndex: number;
  questionCount: number;
  isActive: boolean;
  isCompleted: boolean;
  isRevealed: boolean;
  moduleSlug: string;
  sectionIndex: number;
  segmentIndex: number;
  isAuthenticated: boolean;
  onComplete: () => void;
  initialText?: string;
  initialResponseId?: number | null;
  initialCompleted?: boolean;
}

export default function TestQuestionCard({
  question,
  questionIndex,
  questionCount,
  isActive,
  isCompleted,
  isRevealed,
  moduleSlug,
  sectionIndex,
  segmentIndex,
  isAuthenticated,
  onComplete,
}: TestQuestionCardProps) {
  // Timer tracking
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);

  // Start timer when question becomes active and revealed
  useEffect(() => {
    if (isActive && isRevealed && !isCompleted) {
      timerRef.current = setInterval(() => {
        elapsedRef.current += 1;
      }, 1000);

      return () => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      };
    }
  }, [isActive, isRevealed, isCompleted]);

  // Not yet revealed - render nothing
  if (!isRevealed) {
    return null;
  }

  // Completed and not active - collapsed state (unless feedback enabled)
  if (isCompleted && !isActive && !question.feedback) {
    return (
      <div className="py-3 px-4 flex items-center gap-3 text-stone-500">
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-600 shrink-0">
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
        </div>
        <span className="text-sm">
          Question {questionIndex + 1} of {questionCount}
        </span>
        <span className="text-xs text-emerald-600">Answered</span>
      </div>
    );
  }

  // Active and revealed - render AnswerBox
  return (
    <div className="py-2">
      <div className="px-4 mb-1 text-xs text-stone-400">
        Question {questionIndex + 1} of {questionCount}
      </div>
      <AnswerBox
        segment={question}
        moduleSlug={moduleSlug}
        sectionIndex={sectionIndex}
        segmentIndex={segmentIndex}
        isAuthenticated={isAuthenticated}
        onComplete={onComplete}
      />
    </div>
  );
}
