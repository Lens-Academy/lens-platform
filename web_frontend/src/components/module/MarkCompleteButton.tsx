// web_frontend_next/src/components/narrative-lesson/MarkCompleteButton.tsx

import { useState } from "react";
import { markComplete, type MarkCompleteResponse } from "@/api/progress";
import { useAuth } from "@/hooks/useAuth";

type MarkCompleteButtonProps = {
  isCompleted: boolean;
  onComplete: (response?: MarkCompleteResponse) => void;
  onNext?: () => void;
  hasNext?: boolean;
  // Props for calling the progress API
  contentId?: string;
  contentType?: "module" | "lo" | "lens" | "test";
  contentTitle?: string;
  moduleSlug?: string;
  // Custom button text (defaults to "Mark section complete")
  buttonText?: string;
  // Short sections show minimal completed state (just "Next" button)
  isShort?: boolean;
};

export default function MarkCompleteButton({
  isCompleted,
  onComplete,
  onNext,
  hasNext,
  contentId,
  contentType = "lens",
  contentTitle,
  moduleSlug,
  buttonText = "Mark section complete",
  isShort = false,
}: MarkCompleteButtonProps) {
  const { isAuthenticated } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleComplete = async () => {
    if (isSubmitting) return;

    // If we have content info, call the progress API
    if (contentId && contentTitle) {
      setIsSubmitting(true);
      try {
        const response = await markComplete(
          {
            content_id: contentId,
            content_type: contentType,
            content_title: contentTitle,
            module_slug: moduleSlug,
          },
          isAuthenticated,
        );
        onComplete(response);
      } catch (error) {
        console.error("[MarkCompleteButton] Failed to mark complete:", error);
        // Still call onComplete for local state update even if API fails
        onComplete();
      } finally {
        setIsSubmitting(false);
      }
    } else {
      // Fallback: just call onComplete without API call
      onComplete();
    }
  };

  if (isCompleted) {
    if (isShort) {
      // Short sections: no "Section completed" sign, just a "Next" button
      return hasNext && onNext ? (
        <div className="flex items-center justify-center py-6">
          <button
            onClick={onNext}
            className="flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-all active:scale-95 font-medium"
          >
            Next
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        </div>
      ) : null;
    }

    return (
      <div className="flex items-center justify-center py-6 gap-4">
        <div className="flex items-center gap-2 text-emerald-600">
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
          <span className="font-medium">Section completed</span>
        </div>
        {hasNext && onNext && (
          <button
            onClick={onNext}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-all active:scale-95 font-medium"
          >
            Next section
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center py-6">
      <button
        onClick={handleComplete}
        disabled={isSubmitting}
        className="flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-all active:scale-95 font-medium disabled:opacity-50"
      >
        {isSubmitting ? (
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
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
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
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
              d="M5 13l4 4L19 7"
            />
          </svg>
        )}
        {buttonText}
      </button>
    </div>
  );
}
