// web_frontend_next/src/components/narrative-lesson/MarkCompleteButton.tsx

type MarkCompleteButtonProps = {
  isCompleted: boolean;
  onComplete: () => void;
  onNext?: () => void;
  hasNext?: boolean;
};

export default function MarkCompleteButton({
  isCompleted,
  onComplete,
  onNext,
  hasNext,
}: MarkCompleteButtonProps) {
  if (isCompleted) {
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
        onClick={onComplete}
        className="flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-all active:scale-95 font-medium"
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
            d="M5 13l4 4L19 7"
          />
        </svg>
        Mark section complete
      </button>
    </div>
  );
}
