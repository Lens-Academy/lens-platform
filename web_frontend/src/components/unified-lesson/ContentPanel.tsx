// web_frontend/src/components/unified-lesson/ContentPanel.tsx
import type { Stage } from "../../types/unified-lesson";
import ArticlePanel from "../article/ArticlePanel";
import VideoPlayer from "../lesson/VideoPlayer";

type ContentPanelProps = {
  stage: Stage | null;
  articleContent?: string;
  onVideoEnded: () => void;
  onNextClick: () => void;
};

export default function ContentPanel({
  stage,
  articleContent,
  onVideoEnded,
  onNextClick,
}: ContentPanelProps) {
  if (!stage) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Lesson complete!</p>
      </div>
    );
  }

  if (stage.type === "chat") {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-gray-50 p-8">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-4">💬</div>
          <h2 className="text-xl font-semibold text-gray-800 mb-2">Discussion Time</h2>
          <p className="text-gray-600 mb-6">
            Use the chat on the left to discuss what you've learned.
          </p>
          <button
            onClick={onNextClick}
            className="text-gray-500 hover:text-gray-700 underline text-sm"
          >
            Skip to next section
          </button>
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
          />
        </div>
        <div className="p-4 border-t bg-white">
          <button
            onClick={onNextClick}
            className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700"
          >
            Continue
          </button>
        </div>
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
          onEnded={onVideoEnded}
          onSkip={onNextClick}
        />
      </div>
    );
  }

  return null;
}
