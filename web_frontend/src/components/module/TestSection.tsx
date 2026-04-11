/**
 * TestSection - Container component for test sections in modules.
 *
 * Manages a state machine (not_started -> in_progress -> completed) that
 * controls the Begin screen, sequential item reveal, and completion flow.
 *
 * Tracks a unified list of "assessable items" -- both question and roleplay
 * segments. On mount, batch-loads existing responses/history to support resume:
 * - All complete -> state = "completed"
 * - Some complete -> state = "in_progress", resume at first incomplete
 * - None -> state = "not_started", show Begin screen
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import type {
  TestSection as TestSectionType,
  QuestionSegment,
  RoleplaySegment,
} from "@/types/module";
import type { MarkCompleteResponse } from "@/api/progress";
import { getResponses } from "@/api/questions";
import { getRoleplayHistory } from "@/api/roleplay";
import { markComplete } from "@/api/progress";
import TestQuestionCard from "./TestQuestionCard";
import TestRoleplayCard from "./TestRoleplayCard";

type TestState = "not_started" | "in_progress" | "completed";

type AssessableItem =
  | { type: "question"; segment: QuestionSegment; segmentIndex: number }
  | { type: "roleplay"; segment: RoleplaySegment; segmentIndex: number };

interface TestSectionProps {
  section: TestSectionType;
  moduleSlug: string;
  sectionIndex: number;
  isAuthenticated: boolean;
  onTestStart: () => void;
  onTestTakingComplete: () => void;
  onMarkComplete: (response?: MarkCompleteResponse) => void;
  onFeedbackTrigger?: (
    questionsAndAnswers: Array<{ question: string; answer: string }>,
  ) => void;
}

export default function TestSection({
  section,
  moduleSlug,
  sectionIndex,
  isAuthenticated,
  onTestStart,
  onTestTakingComplete,
  onMarkComplete,
  onFeedbackTrigger,
}: TestSectionProps) {
  const [testState, setTestState] = useState<TestState>("not_started");
  const [currentItemIndex, setCurrentItemIndex] = useState(0);
  const [completedItems, setCompletedItems] = useState<Set<number>>(new Set());
  const [resumeItemIndex, setResumeItemIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // Extract assessable items (questions + roleplays) with their original segment indices
  const assessableItems: AssessableItem[] = useMemo(() => {
    const result: AssessableItem[] = [];
    section.segments.forEach((seg, idx) => {
      if (seg.type === "question") {
        result.push({
          type: "question",
          segment: seg as QuestionSegment,
          segmentIndex: idx,
        });
      } else if (seg.type === "roleplay") {
        result.push({
          type: "roleplay",
          segment: seg as RoleplaySegment,
          segmentIndex: idx,
        });
      }
    });
    return result;
  }, [section.segments]);

  // Convenience: extract just the question items for feedback
  const questionItems = useMemo(
    () =>
      assessableItems.filter(
        (item): item is AssessableItem & { type: "question" } =>
          item.type === "question",
      ),
    [assessableItems],
  );

  // Load existing responses/history on mount for resume support
  useEffect(() => {
    let cancelled = false;

    async function loadResponses() {
      try {
        // Load completion state for each assessable item
        const settledResults = await Promise.allSettled(
          assessableItems.map((item) => {
            if (item.type === "question") {
              const questionId = `${moduleSlug}:${sectionIndex}:${item.segmentIndex}`;
              return getResponses({ moduleSlug, questionId }, isAuthenticated);
            } else {
              return getRoleplayHistory(moduleSlug, item.segment.id);
            }
          }),
        );

        if (cancelled) return;

        // Determine which items are completed
        const completed = new Set<number>();
        let firstIncomplete = -1;

        settledResults.forEach((result, itemIndex) => {
          if (result.status === "fulfilled") {
            const item = assessableItems[itemIndex];
            let isComplete = false;

            if (item.type === "question") {
              // Question: check for completed response
              const qResult = result.value as Awaited<
                ReturnType<typeof getResponses>
              >;
              isComplete = qResult.responses.some(
                (r) => r.completed_at !== null,
              );
            } else {
              // Roleplay: check for completedAt
              const rResult = result.value as Awaited<
                ReturnType<typeof getRoleplayHistory>
              >;
              isComplete = rResult.completedAt !== null;
            }

            if (isComplete) {
              completed.add(itemIndex);
            } else if (firstIncomplete === -1) {
              firstIncomplete = itemIndex;
            }
          } else if (firstIncomplete === -1) {
            firstIncomplete = itemIndex;
          }
        });

        if (cancelled) return;

        setCompletedItems(completed);
        setResumeItemIndex(firstIncomplete !== -1 ? firstIncomplete : 0);

        if (completed.size === assessableItems.length) {
          // All items complete
          setTestState("completed");
        } else {
          // Not started or partially complete -- show Begin/Resume screen
          // Don't auto-lock navigation; let the user opt in
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
  }, [assessableItems, moduleSlug, sectionIndex, isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle Begin/Resume button click
  const handleBegin = useCallback(() => {
    setTestState("in_progress");
    setCurrentItemIndex(completedItems.size > 0 ? resumeItemIndex : 0);
    onTestStart();
  }, [onTestStart, completedItems.size, resumeItemIndex]);

  // Handle item completion (question or roleplay)
  const handleItemComplete = useCallback(
    (itemIndex: number) => {
      const newCompleted = new Set(completedItems);
      newCompleted.add(itemIndex);
      setCompletedItems(newCompleted);

      if (newCompleted.size === assessableItems.length) {
        // All items complete -- finish the test
        setTestState("completed");
        onTestTakingComplete();

        // Trigger feedback if enabled (only include question answers)
        if (onFeedbackTrigger && questionItems.length > 0) {
          Promise.all(
            questionItems.map((q) => {
              const questionId = `${moduleSlug}:${sectionIndex}:${q.segmentIndex}`;
              return getResponses({ moduleSlug, questionId }, isAuthenticated);
            }),
          )
            .then((results) => {
              const pairs = questionItems.map((q, idx) => {
                const completed = results[idx].responses.find(
                  (r) => r.completed_at !== null,
                );
                return {
                  question: q.segment.content,
                  answer: completed?.answer_text || "",
                };
              });
              onFeedbackTrigger(pairs);
            })
            .catch(() => {
              const pairs = questionItems.map((q) => ({
                question: q.segment.content,
                answer: "(could not load answer)",
              }));
              onFeedbackTrigger(pairs);
            });
        }

        // Mark test section as complete via progress API
        // When feedback is enabled, defer markComplete to the Continue button
        if (!onFeedbackTrigger) {
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
              onMarkComplete();
            });
        }
      } else {
        // Advance to next incomplete item
        let nextIndex = itemIndex + 1;
        while (
          nextIndex < assessableItems.length &&
          newCompleted.has(nextIndex)
        ) {
          nextIndex++;
        }
        if (nextIndex < assessableItems.length) {
          setCurrentItemIndex(nextIndex);
        }
      }
    },
    [
      completedItems,
      assessableItems,
      questionItems,
      onTestTakingComplete,
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

  // Build a human-readable count for the Begin screen
  const questionCount = questionItems.length;
  const roleplayCount = assessableItems.length - questionCount;

  // Begin/Resume screen (not_started)
  if (testState === "not_started") {
    const isResume = completedItems.size > 0;
    const itemDescParts: string[] = [];
    if (questionCount > 0) {
      itemDescParts.push(
        `${questionCount} question${questionCount !== 1 ? "s" : ""}`,
      );
    }
    if (roleplayCount > 0) {
      itemDescParts.push(
        `${roleplayCount} roleplay${roleplayCount !== 1 ? "s" : ""}`,
      );
    }
    const itemDesc = itemDescParts.join(" and ");

    return (
      <div className="py-12 px-4">
        <div className="max-w-content mx-auto text-center">
          <p className="text-stone-600 text-lg mb-6">
            {isResume
              ? `${completedItems.size} of ${assessableItems.length} completed`
              : itemDesc}
          </p>
          <button
            onClick={handleBegin}
            className="px-8 py-2.5 bg-stone-800 text-white rounded-lg hover:bg-stone-700 transition-colors font-medium"
          >
            {isResume ? "Resume" : "Begin"}
          </button>
        </div>
      </div>
    );
  }

  // In-progress or completed: render all assessable items
  return (
    <div className="py-6 px-4">
      <div className="max-w-content mx-auto">
        {assessableItems.map((item, itemIndex) => {
          const isActive =
            testState === "in_progress" && itemIndex === currentItemIndex;
          const isCompleted = completedItems.has(itemIndex);
          const isRevealed =
            itemIndex <= currentItemIndex || completedItems.has(itemIndex);

          if (item.type === "question") {
            return (
              <TestQuestionCard
                key={item.segmentIndex}
                question={item.segment}
                questionIndex={itemIndex}
                questionCount={assessableItems.length}
                isActive={isActive}
                isCompleted={isCompleted}
                isRevealed={isRevealed}
                moduleSlug={moduleSlug}
                sectionIndex={sectionIndex}
                segmentIndex={item.segmentIndex}
                isAuthenticated={isAuthenticated}
                onComplete={() => handleItemComplete(itemIndex)}
              />
            );
          } else {
            return (
              <TestRoleplayCard
                key={item.segmentIndex}
                segment={item.segment}
                moduleSlug={moduleSlug}
                itemIndex={itemIndex}
                itemCount={assessableItems.length}
                isActive={isActive}
                isCompleted={isCompleted}
                isRevealed={isRevealed}
                onComplete={() => handleItemComplete(itemIndex)}
              />
            );
          }
        })}
      </div>
    </div>
  );
}
