/**
 * TestSection - Container component for test sections in modules.
 *
 * Manages a state machine (not_started -> in_progress -> completed) that
 * controls the Begin screen, sequential question reveal, and completion flow.
 *
 * On mount, batch-loads existing responses to support resume:
 * - All complete -> state = "completed"
 * - Some complete -> state = "in_progress", resume at first unanswered
 * - None -> state = "not_started", show Begin screen
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import type {
  TestSection as TestSectionType,
  QuestionSegment,
} from "@/types/module";
import type { MarkCompleteResponse } from "@/api/progress";
import { getResponses } from "@/api/assessments";
import { markComplete } from "@/api/progress";
import TestQuestionCard from "./TestQuestionCard";

type TestState = "not_started" | "in_progress" | "completed";

interface TestSectionProps {
  section: TestSectionType;
  moduleSlug: string;
  sectionIndex: number;
  isAuthenticated: boolean;
  onTestStart: () => void;
  onTestComplete: () => void;
  onMarkComplete: (response?: MarkCompleteResponse) => void;
  onFeedbackTrigger?: (
    questionsAndAnswers: Array<{ question: string; answer: string }>,
  ) => void;
}

interface QuestionInfo {
  segment: QuestionSegment;
  segmentIndex: number;
}

export default function TestSection({
  section,
  moduleSlug,
  sectionIndex,
  isAuthenticated,
  onTestStart,
  onTestComplete,
  onMarkComplete,
  onFeedbackTrigger,
}: TestSectionProps) {
  const [testState, setTestState] = useState<TestState>("not_started");
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [completedQuestions, setCompletedQuestions] = useState<Set<number>>(
    new Set(),
  );
  const [isLoading, setIsLoading] = useState(true);

  // Extract question segments with their original segment indices
  const questions: QuestionInfo[] = useMemo(() => {
    const result: QuestionInfo[] = [];
    section.segments.forEach((seg, idx) => {
      if (seg.type === "question") {
        result.push({ segment: seg as QuestionSegment, segmentIndex: idx });
      }
    });
    return result;
  }, [section.segments]);

  // Load existing responses on mount for resume support
  useEffect(() => {
    let cancelled = false;

    async function loadResponses() {
      try {
        // Build questionIds for all questions
        const responsePromises = questions.map((q) => {
          const questionId = `${moduleSlug}:${sectionIndex}:${q.segmentIndex}`;
          return getResponses(
            { moduleSlug, questionId },
            isAuthenticated,
          );
        });

        const results = await Promise.all(responsePromises);
        if (cancelled) return;

        // Determine which questions have completed responses
        const completed = new Set<number>();
        let firstUnanswered = -1;

        results.forEach((result, qIndex) => {
          const hasCompletedResponse = result.responses.some(
            (r) => r.completed_at !== null,
          );
          if (hasCompletedResponse) {
            completed.add(qIndex);
          } else if (firstUnanswered === -1) {
            firstUnanswered = qIndex;
          }
        });

        if (cancelled) return;

        setCompletedQuestions(completed);

        if (completed.size === questions.length) {
          // All questions answered -- completed state
          setTestState("completed");
        } else if (completed.size > 0) {
          // Some answered -- resume in progress
          setTestState("in_progress");
          setCurrentQuestionIndex(
            firstUnanswered !== -1 ? firstUnanswered : 0,
          );
          onTestStart();
        } else {
          // No answers -- show Begin screen
          setTestState("not_started");
        }
      } catch {
        // On error, default to not_started
        setTestState("not_started");
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadResponses();

    return () => {
      cancelled = true;
    };
  }, [questions, moduleSlug, sectionIndex, isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle Begin button click
  const handleBegin = useCallback(() => {
    setTestState("in_progress");
    setCurrentQuestionIndex(0);
    onTestStart();
  }, [onTestStart]);

  // Handle question completion
  const handleQuestionComplete = useCallback(
    (questionIndex: number) => {
      const newCompleted = new Set(completedQuestions);
      newCompleted.add(questionIndex);
      setCompletedQuestions(newCompleted);

      if (newCompleted.size === questions.length) {
        // All questions answered -- complete the test
        setTestState("completed");
        onTestComplete();

        // Trigger feedback if enabled
        if (onFeedbackTrigger) {
          // Fetch all answers from API
          Promise.all(
            questions.map((q) => {
              const questionId = `${moduleSlug}:${sectionIndex}:${q.segmentIndex}`;
              return getResponses(
                { moduleSlug, questionId },
                isAuthenticated,
              );
            }),
          )
            .then((results) => {
              const pairs = questions.map((q, idx) => {
                // API returns newest-first; find the completed response
                const completed = results[idx].responses.find(
                  (r) => r.completed_at !== null,
                );
                return {
                  question: q.segment.userInstruction,
                  answer: completed?.answer_text || "",
                };
              });
              onFeedbackTrigger(pairs);
            })
            .catch(() => {
              // Still trigger feedback with whatever we have
              const pairs = questions.map((q) => ({
                question: q.segment.userInstruction,
                answer: "(could not load answer)",
              }));
              onFeedbackTrigger(pairs);
            });
        }

        // Mark test section as complete via progress API
        const contentId = `test:${moduleSlug}:${sectionIndex}`;
        markComplete(
          {
            content_id: contentId,
            content_type: "test",
            content_title: section.meta?.title || "Test",
            module_slug: moduleSlug,
          },
          isAuthenticated,
        )
          .then((response) => {
            onMarkComplete(response);
          })
          .catch(() => {
            // Still mark locally complete even if API fails
            onMarkComplete();
          });
      } else {
        // Advance to next unanswered question
        let nextIndex = questionIndex + 1;
        while (nextIndex < questions.length && newCompleted.has(nextIndex)) {
          nextIndex++;
        }
        if (nextIndex < questions.length) {
          setCurrentQuestionIndex(nextIndex);
        }
      }
    },
    [
      completedQuestions,
      questions,
      onTestComplete,
      onMarkComplete,
      onFeedbackTrigger,
      moduleSlug,
      sectionIndex,
      section.meta?.title,
      isAuthenticated,
    ],
  );

  // Loading state
  if (isLoading) {
    return (
      <div className="py-8 px-4">
        <div className="max-w-content mx-auto">
          <div className="h-24 bg-stone-100 rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }

  // Begin screen (not_started)
  if (testState === "not_started") {
    return (
      <div className="py-12 px-4">
        <div className="max-w-content mx-auto text-center">
          <p className="text-stone-600 text-lg mb-6">
            {questions.length} question{questions.length !== 1 ? "s" : ""}
          </p>
          <button
            onClick={handleBegin}
            className="px-8 py-2.5 bg-stone-800 text-white rounded-lg hover:bg-stone-700 transition-colors font-medium"
          >
            Begin
          </button>
        </div>
      </div>
    );
  }

  // In-progress or completed: render all questions
  return (
    <div className="py-6 px-4">
      <div className="max-w-content mx-auto">
        {questions.map((q, qIndex) => (
          <TestQuestionCard
            key={q.segmentIndex}
            question={q.segment}
            questionIndex={qIndex}
            questionCount={questions.length}
            isActive={testState === "in_progress" && qIndex === currentQuestionIndex}
            isCompleted={completedQuestions.has(qIndex)}
            isRevealed={
              qIndex <= currentQuestionIndex || completedQuestions.has(qIndex)
            }
            moduleSlug={moduleSlug}
            sectionIndex={sectionIndex}
            segmentIndex={q.segmentIndex}
            learningOutcomeId={section.learningOutcomeId}
            contentId={section.contentId}
            isAuthenticated={isAuthenticated}
            onComplete={() => handleQuestionComplete(qIndex)}
          />
        ))}
      </div>
    </div>
  );
}
