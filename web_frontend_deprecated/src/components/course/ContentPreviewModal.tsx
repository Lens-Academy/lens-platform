/**
 * Modal for previewing article/video content from course overview.
 */

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { getLesson, getSession, createSession } from "../../api/lessons";
import ContentPanel from "../unified-lesson/ContentPanel";
import type { Stage, ArticleData } from "../../types/unified-lesson";

type ContentPreviewModalProps = {
  lessonSlug: string;
  stageIndex: number;
  sessionId: number | null;
  onClose: () => void;
};

export default function ContentPreviewModal({
  lessonSlug,
  stageIndex,
  sessionId,
  onClose,
}: ContentPreviewModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [article, setArticle] = useState<ArticleData | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);

        // Get lesson to find stage type
        const lesson = await getLesson(lessonSlug);
        const targetStage = lesson.stages[stageIndex];

        if (!targetStage || targetStage.type === "chat") {
          setError("Cannot preview this content");
          return;
        }

        setStage(targetStage);

        // Get content via session API
        let sid = sessionId;
        if (!sid) {
          // Create temporary session to get content
          sid = await createSession(lessonSlug);
        }

        const session = await getSession(sid, stageIndex);
        setArticle(session.article);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load content");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [lessonSlug, stageIndex, sessionId]);

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
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-white rounded-lg shadow-xl flex flex-col mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h3 className="text-lg font-medium text-slate-900">
            {stage?.type === "article" ? "Article Preview" : "Video Preview"}
          </h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading && <div className="text-slate-500">Loading...</div>}
          {error && <div className="text-red-500">{error}</div>}
          {!loading && !error && stage && (
            <ContentPanel
              stage={stage}
              article={article}
              onVideoEnded={() => {}}
              onNextClick={() => {}}
              isReviewing={true}
            />
          )}
        </div>
      </div>
    </div>
  );
}
