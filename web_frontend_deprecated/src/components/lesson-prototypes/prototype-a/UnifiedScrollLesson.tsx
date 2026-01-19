// web_frontend/src/components/lesson-prototypes/prototype-a/UnifiedScrollLesson.tsx

import type { PrototypeLesson, ContentBlock } from "../shared/types";
import { usePrototypeLesson } from "../shared/usePrototypeLesson";
import { SimpleChatBox } from "../shared/SimpleChatBox";
import { MarkdownBlock } from "../shared/MarkdownBlock";
import { ScrollVideoPlayer } from "./ScrollVideoPlayer";

type UnifiedScrollLessonProps = {
  lesson: PrototypeLesson;
  sessionId: number | null;
};

export function UnifiedScrollLesson({
  lesson,
  sessionId,
}: UnifiedScrollLessonProps) {
  const { getChatState, sendChatMessage, completedBlocks, markBlockCompleted } =
    usePrototypeLesson({ sessionId });

  const handleChatComplete = (blockId: string) => {
    markBlockCompleted(blockId);
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

      case "video":
        return (
          <div
            key={block.id}
            className={`max-w-[900px] mx-auto my-8 ${isLocked ? "opacity-30 pointer-events-none" : ""}`}
          >
            <ScrollVideoPlayer
              videoId={block.videoId}
              start={block.start}
              end={block.end}
              onEnded={() => markBlockCompleted(block.id)}
            />
          </div>
        );

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
                  Continue reading →
                </button>
              )}
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="sticky top-0 bg-white border-b border-gray-200 z-10">
        <div className="max-w-[900px] mx-auto px-6 py-4">
          <h1 className="text-xl font-semibold">{lesson.title}</h1>
          <p className="text-sm text-gray-500">Prototype A: Unified Scroll</p>
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
