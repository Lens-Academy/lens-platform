// web_frontend/src/components/lesson-prototypes/prototype-d/SideBySideLesson.tsx

import { useState } from "react";
import type { PrototypeLesson, ContentBlock } from "../shared/types";
import { usePrototypeLesson } from "../shared/usePrototypeLesson";
import { SimpleChatBox } from "../shared/SimpleChatBox";
import { MarkdownBlock } from "../shared/MarkdownBlock";
import { AdaptiveVideoContainer } from "./AdaptiveVideoContainer";

type SideBySideLessonProps = {
  lesson: PrototypeLesson;
  sessionId: number | null;
};

export function SideBySideLesson({ lesson, sessionId }: SideBySideLessonProps) {
  const { getChatState, sendChatMessage, completedBlocks, markBlockCompleted } =
    usePrototypeLesson({ sessionId });

  // Track which video is showing side-by-side chat
  const [activeVideoChat, setActiveVideoChat] = useState<{
    videoBlockId: string;
    chatBlockId: string;
  } | null>(null);

  const handleVideoCheckpoint = (
    videoBlockId: string,
    nextChatBlockId: string
  ) => {
    setActiveVideoChat({ videoBlockId, chatBlockId: nextChatBlockId });
  };

  const handleChatComplete = (blockId: string) => {
    markBlockCompleted(blockId);
    // If this was a video-attached chat, close the side panel
    if (activeVideoChat?.chatBlockId === blockId) {
      setActiveVideoChat(null);
    }
  };

  const renderBlock = (block: ContentBlock, index: number) => {
    const prevBlock = lesson.blocks[index - 1];
    const nextBlock = lesson.blocks[index + 1];
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
        const nextChatBlock = nextBlock?.type === "chat" ? nextBlock : null;
        const isShowingSideChat = activeVideoChat?.videoBlockId === block.id;

        return (
          <div
            key={block.id}
            className={`max-w-[1100px] mx-auto my-8 ${isLocked ? "opacity-30 pointer-events-none" : ""}`}
          >
            <div className="flex gap-4">
              {/* Video (shrinks when chat is active) */}
              <AdaptiveVideoContainer
                videoId={block.videoId}
                start={block.start}
                end={block.end}
                checkpoints={nextChatBlock ? [block.end - 5] : []}
                onCheckpointReached={() => {
                  if (nextChatBlock) {
                    handleVideoCheckpoint(block.id, nextChatBlock.id);
                  }
                }}
                onResume={() => setActiveVideoChat(null)}
                onEnded={() => markBlockCompleted(block.id)}
                isPausedForChat={isShowingSideChat}
              />

              {/* Side chat panel (slides in) */}
              {isShowingSideChat && nextChatBlock && (
                <div className="w-[40%] animate-slide-in-right">
                  <div className="bg-gray-50 rounded-lg p-4 h-full flex flex-col">
                    {nextChatBlock.prompt && (
                      <p className="text-gray-600 italic mb-3 text-sm">
                        {nextChatBlock.prompt}
                      </p>
                    )}
                    <SimpleChatBox
                      chatState={getChatState(nextChatBlock.id)}
                      onSendMessage={(content) =>
                        sendChatMessage(nextChatBlock.id, content)
                      }
                      placeholder="Share your thoughts..."
                      compact
                      className="flex-1"
                    />
                    {getChatState(nextChatBlock.id).messages.length > 0 && (
                      <button
                        onClick={() => handleChatComplete(nextChatBlock.id)}
                        className="mt-2 text-sm text-blue-600 hover:text-blue-800 underline"
                      >
                        Done discussing
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      }

      case "chat": {
        // Skip if this chat is being shown as side-by-side with video
        if (activeVideoChat?.chatBlockId === block.id) {
          return null;
        }

        // Skip if already completed via side-by-side
        if (completedBlocks.has(block.id)) {
          return null;
        }

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
    }
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="sticky top-0 bg-white border-b border-gray-200 z-10">
        <div className="max-w-[1100px] mx-auto px-6 py-4">
          <h1 className="text-xl font-semibold">{lesson.title}</h1>
          <p className="text-sm text-gray-500">
            Prototype D: Side-by-Side Video Chat
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

      {/* Animation styles */}
      <style>{`
        @keyframes slideInRight {
          from {
            opacity: 0;
            transform: translateX(20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        .animate-slide-in-right {
          animation: slideInRight 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}
