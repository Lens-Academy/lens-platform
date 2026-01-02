// web_frontend/src/components/unified-lesson/ContentPanel.tsx
import { useState, useCallback } from "react";
import type { Stage, PreviousStageInfo } from "../../types/unified-lesson";
import ArticlePanel from "../article/ArticlePanel";
import VideoPlayer from "../lesson/VideoPlayer";

type ContentPanelProps = {
  stage: Stage | null;
  articleContent?: string;
  onVideoEnded: () => void;
  onNextClick: () => void;
  isReviewing?: boolean;
  // For chat stages: show previous content (blurred or visible)
  previousContent?: string | null;
  previousStage?: PreviousStageInfo | null;
  includePreviousContent?: boolean;
};

export default function ContentPanel({
  stage,
  articleContent,
  onVideoEnded,
  onNextClick,
  isReviewing = false,
  previousContent,
  previousStage,
  includePreviousContent = true,
}: ContentPanelProps) {
  // Track if user has scrolled to bottom of article
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const handleScrolledToBottom = useCallback(() => {
    setHasScrolledToBottom(true);
  }, []);

  if (!stage) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Lesson complete!</p>
      </div>
    );
  }

  if (stage.type === "chat") {
    // Show previous content (blurred or visible) during chat stages
    const blurred = !includePreviousContent;

    if (previousStage?.type === "article" && previousContent) {
      return (
        <div className="h-full overflow-hidden">
          <ArticlePanel content={previousContent} blurred={blurred} />
        </div>
      );
    }

    if (previousStage?.type === "video" && previousStage.videoId) {
      // Show YouTube thumbnail (blurred or visible)
      const thumbnailUrl = `https://img.youtube.com/vi/${previousStage.videoId}/maxresdefault.jpg`;
      return (
        <div className="h-full flex items-center justify-center bg-white overflow-hidden relative">
          <img
            src={thumbnailUrl}
            alt="Video thumbnail"
            className={`max-w-full max-h-full object-contain ${blurred ? "blur-sm" : ""}`}
          />
          {blurred && (
            <div className="absolute inset-0 flex items-center justify-center z-20">
              <div className="bg-white rounded-lg px-6 py-4 shadow-lg text-center">
                <svg className="w-8 h-8 mx-auto mb-2 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
                </svg>
                <p className="text-gray-600 text-sm">Please chat with the AI tutor</p>
              </div>
            </div>
          )}
        </div>
      );
    }

    // Fallback: no previous content available
    return (
      <div className="h-full flex items-center justify-center bg-gray-50 p-8">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-4">💬</div>
          <h2 className="text-xl font-semibold text-gray-800 mb-2">Discussion Time</h2>
          <p className="text-gray-600">
            Use the chat on the left to discuss what you've learned.
          </p>
        </div>
      </div>
    );
  }

  if (stage.type === "article") {
    return (
      <div className="h-full flex flex-col">
        <div className="flex-1 overflow-hidden">
          <ArticlePanel
            content={articleContent || "Loading..."}
            blurred={false}
            onScrolledToBottom={handleScrolledToBottom}
          />
        </div>
        {!isReviewing && (
          <div className="p-4 border-t bg-white">
            <button
              onClick={onNextClick}
              disabled={!hasScrolledToBottom}
              className={`w-full py-2 rounded-lg ${
                hasScrolledToBottom
                  ? "bg-blue-600 text-white hover:bg-blue-700"
                  : "bg-gray-300 text-gray-500 cursor-not-allowed"
              }`}
            >
              I've read the article
            </button>
          </div>
        )}
      </div>
    );
  }

  if (stage.type === "video") {
    return (
      <div className="h-full flex flex-col justify-center">
        <VideoPlayer
          videoId={stage.videoId}
          start={stage.from}
          end={stage.to || 9999}
          onEnded={isReviewing ? () => {} : onVideoEnded}
        />
      </div>
    );
  }

  return null;
}
