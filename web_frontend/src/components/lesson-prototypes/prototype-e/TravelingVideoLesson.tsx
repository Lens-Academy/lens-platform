// web_frontend/src/components/lesson-prototypes/prototype-e/TravelingVideoLesson.tsx

import { useState } from "react";
import type { PrototypeLesson, ContentBlock } from "../shared/types";
import { usePrototypeLesson } from "../shared/usePrototypeLesson";
import { SimpleChatBox } from "../shared/SimpleChatBox";
import { MarkdownBlock } from "../shared/MarkdownBlock";
import { ScrollVideoPlayer } from "../prototype-a/ScrollVideoPlayer";

type TravelingVideoLessonProps = {
  lesson: PrototypeLesson;
  sessionId: number | null;
};

export function TravelingVideoLesson({
  lesson,
  sessionId,
}: TravelingVideoLessonProps) {
  const { getChatState, sendChatMessage, completedBlocks, markBlockCompleted } =
    usePrototypeLesson({ sessionId });

  // Track which video is currently active (first video by default)
  const videoBlocks = lesson.blocks.filter(b => b.type === 'video');
  const [activeVideoId, setActiveVideoId] = useState<string | null>(
    videoBlocks.length > 0 ? videoBlocks[0].id : null
  );

  const handleChatComplete = (blockId: string) => {
    markBlockCompleted(blockId);
  };

  const handleVideoEnded = (blockId: string) => {
    markBlockCompleted(blockId);

    // Find the next video block and activate it
    const currentIndex = videoBlocks.findIndex(b => b.id === blockId);
    if (currentIndex < videoBlocks.length - 1) {
      setActiveVideoId(videoBlocks[currentIndex + 1].id);
    }
  };

  const renderBlock = (block: ContentBlock, index: number) => {
    const prevBlock = lesson.blocks[index - 1];
    const isAfterChat = prevBlock?.type === "chat";
    const isLocked = isAfterChat && !completedBlocks.has(prevBlock.id);

    switch (block.type) {
      case "markdown":
        return (
          <div
            key={block.id}
            className={`transition-opacity duration-300 ${isLocked ? "opacity-30 pointer-events-none" : ""}`}
          >
            <MarkdownBlock
              content={block.content}
              className="max-w-[700px] mx-auto"
            />
          </div>
        );

      case "video": {
        const isActive = activeVideoId === block.id;
        const duration = block.end - block.start;

        return (
          <div
            key={block.id}
            className={`max-w-[900px] mx-auto my-8 ${isLocked ? "opacity-30 pointer-events-none" : ""}`}
          >
            <div className="relative">
              <ScrollVideoPlayer
                videoId={block.videoId}
                start={block.start}
                end={block.end}
                onEnded={() => handleVideoEnded(block.id)}
              />

              {/* Dark overlay for inactive videos */}
              {!isActive && (
                <button
                  onClick={() => setActiveVideoId(block.id)}
                  className="absolute inset-0 bg-gray-900/70 flex items-center justify-center cursor-pointer hover:bg-gray-900/60 transition-colors"
                >
                  <div className="text-center text-white">
                    <span className="text-4xl">▶</span>
                    <p className="mt-2">
                      Watch section ({Math.floor(block.start / 60)}:{String(block.start % 60).padStart(2, '0')} - {Math.floor(block.end / 60)}:{String(block.end % 60).padStart(2, '0')})
                    </p>
                  </div>
                </button>
              )}
            </div>

            <p className="text-center text-sm text-gray-500 mt-1">
              Segment: {Math.floor(block.start / 60)}:{String(block.start % 60).padStart(2, '0')} - {Math.floor(block.end / 60)}:{String(block.end % 60).padStart(2, '0')} ({duration}s)
            </p>
          </div>
        );
      }

      case "chat":
        return (
          <div
            key={block.id}
            className="max-w-[700px] mx-auto my-8 border-l-4 border-blue-500 pl-4"
          >
            {block.prompt && (
              <p className="text-gray-600 italic mb-3">{block.prompt}</p>
            )}
            <SimpleChatBox
              chatState={getChatState(block.id)}
              onSendMessage={(content) => sendChatMessage(block.id, content)}
              placeholder="Share your thoughts..."
            />
            {getChatState(block.id).messages.length > 0 &&
              !completedBlocks.has(block.id) && (
                <button
                  onClick={() => handleChatComplete(block.id)}
                  className="mt-3 text-sm text-blue-600 hover:text-blue-800 underline"
                >
                  Continue reading
                </button>
              )}
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="sticky top-0 bg-white border-b border-gray-200 z-20">
        <div className="max-w-[900px] mx-auto px-6 py-4">
          <h1 className="text-xl font-semibold">{lesson.title}</h1>
          <p className="text-sm text-gray-500">
            Prototype E: Segmented Video (different time ranges per slot)
          </p>
        </div>
      </header>

      {/* Content */}
      <main className="px-6 py-8">
        <div className="space-y-8">
          {lesson.blocks.map((block, index) => renderBlock(block, index))}
        </div>

        {/* End marker */}
        <div className="max-w-[700px] mx-auto mt-16 pt-8 border-t border-gray-200 text-center">
          <p className="text-gray-500">End of lesson</p>
        </div>
      </main>
    </div>
  );
}
