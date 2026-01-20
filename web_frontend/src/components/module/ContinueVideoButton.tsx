// web_frontend_next/src/components/module/ContinueVideoButton.tsx

import { formatDuration } from "@/utils/formatDuration";

type ContinueVideoButtonProps = {
  durationSeconds: number;
  onClick: () => void;
};

/**
 * Compact button for subsequent video clips within a section.
 * Styled similar to MarkCompleteButton but blue.
 */
export default function ContinueVideoButton({
  durationSeconds,
  onClick,
}: ContinueVideoButtonProps) {
  return (
    <div className="flex items-center justify-center py-6">
      <button
        onClick={onClick}
        className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors font-medium"
        aria-label={`Continue video, ${formatDuration(durationSeconds)}`}
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
        Continue video ({formatDuration(durationSeconds)})
      </button>
    </div>
  );
}
