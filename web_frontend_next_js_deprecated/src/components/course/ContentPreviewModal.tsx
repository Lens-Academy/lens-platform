/**
 * Modal for previewing article/video content from course overview.
 *
 * TODO: Reimplement for new module system. The old implementation used the
 * unified lesson stages API which has been replaced with the narrative module
 * sections format.
 */

import { useEffect } from "react";
import { X } from "lucide-react";

type ContentPreviewModalProps = {
  moduleSlug: string;
  stageIndex: number;
  sessionId: number | null;
  onClose: () => void;
};

export default function ContentPreviewModal({
  moduleSlug,
  stageIndex,
  onClose,
}: ContentPreviewModalProps) {
  // Close on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-white rounded-lg shadow-xl flex flex-col mx-4 p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-slate-900">
            Content Preview
          </h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {/* Placeholder content */}
        <div className="text-slate-600 text-center py-8">
          <p className="mb-4">
            Content preview is not yet available in the new module format.
          </p>
          <p className="text-sm text-slate-400">
            Module: {moduleSlug}, Section: {stageIndex + 1}
          </p>
        </div>

        <button
          onClick={onClose}
          className="mt-4 w-full py-2 px-4 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}
