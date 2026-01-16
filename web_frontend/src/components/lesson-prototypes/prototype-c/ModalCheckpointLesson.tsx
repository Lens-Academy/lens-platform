// web_frontend/src/components/lesson-prototypes/prototype-c/ModalCheckpointLesson.tsx

import { useState, useRef, useEffect } from "react";
import type { PrototypeLesson, ContentBlock } from "../shared/types";
import { usePrototypeLesson } from "../shared/usePrototypeLesson";
import { SimpleChatBox } from "../shared/SimpleChatBox";
import { MarkdownBlock } from "../shared/MarkdownBlock";
import { CheckpointModal } from "./CheckpointModal";
// youtube-video-element is already imported and typed in unified-lesson/VideoPlayer.tsx
// The JSX intrinsic element declaration is shared across the app
import "youtube-video-element";

type ModalCheckpointLessonProps = {
  lesson: PrototypeLesson;
  sessionId: number | null;
};

export function ModalCheckpointLesson({
  lesson,
  sessionId,
}: ModalCheckpointLessonProps) {
  const { getChatState, sendChatMessage, completedBlocks, markBlockCompleted } =
    usePrototypeLesson({ sessionId });

  const [modalChat, setModalChat] = useState<{
    blockId: string;
    prompt?: string;
  } | null>(null);
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

  const handleVideoCheckpoint = (chatBlockId: string, prompt?: string) => {
    setModalChat({ blockId: chatBlockId, prompt });
  };

  const handleModalClose = () => {
    if (modalChat) {
      markBlockCompleted(modalChat.blockId);
    }
    setModalChat(null);

    // Resume any paused videos
    videoRefs.current.forEach((video) => {
      if (video.paused) video.play();
    });
  };

  const handleChatComplete = (blockId: string) => {
    markBlockCompleted(blockId);
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
        const youtubeUrl = `https://www.youtube.com/watch?v=${block.videoId}&t=${block.start}`;

        return (
          <div
            key={block.id}
            className={`max-w-[900px] mx-auto my-8 ${isLocked ? "opacity-30 pointer-events-none" : ""}`}
          >
            <VideoWithCheckpoint
              youtubeUrl={youtubeUrl}
              start={block.start}
              end={block.end}
              onCheckpoint={() => {
                if (nextChatBlock) {
                  handleVideoCheckpoint(nextChatBlock.id, nextChatBlock.prompt);
                }
              }}
              onEnded={() => markBlockCompleted(block.id)}
              registerRef={(el) => {
                if (el) videoRefs.current.set(block.id, el);
              }}
            />
          </div>
        );
      }

      case "chat": {
        // Skip if this chat is triggered by video (shown in modal)
        const prevIsVideo = prevBlock?.type === "video";
        if (prevIsVideo) {
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
            />
            {getChatState(block.id).messages.length > 0 &&
              !completedBlocks.has(block.id) && (
                <button
                  onClick={() => handleChatComplete(block.id)}
                  className="mt-3 text-sm text-blue-600 hover:text-blue-800 underline"
                >
                  Continue
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
        <div className="max-w-[900px] mx-auto px-6 py-4">
          <h1 className="text-xl font-semibold">{lesson.title}</h1>
          <p className="text-sm text-gray-500">
            Prototype C: Modal Checkpoints
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

      {/* Chat modal */}
      {modalChat && (
        <CheckpointModal
          isOpen={true}
          prompt={modalChat.prompt}
          chatState={getChatState(modalChat.blockId)}
          onSendMessage={(content) =>
            sendChatMessage(modalChat.blockId, content)
          }
          onClose={handleModalClose}
        />
      )}
    </div>
  );
}

// Helper component for video with checkpoint detection
function VideoWithCheckpoint({
  youtubeUrl,
  start,
  end,
  onCheckpoint,
  onEnded,
  registerRef,
}: {
  youtubeUrl: string;
  start: number;
  end: number;
  onCheckpoint: () => void;
  onEnded: () => void;
  registerRef: (el: HTMLVideoElement | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const checkpointFired = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const video = containerRef.current.querySelector(
      "youtube-video"
    ) as HTMLVideoElement | null;
    if (!video) return;

    registerRef(video);

    const handleLoadedMetadata = () => {
      video.currentTime = start;
    };

    const handleTimeUpdate = () => {
      const time = video.currentTime;

      // Fire checkpoint near end
      if (time >= end - 2 && !checkpointFired.current) {
        checkpointFired.current = true;
        video.pause();
        onCheckpoint();
      }

      // Fire ended
      if (time >= end - 0.5) {
        video.pause();
        onEnded();
      }
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("timeupdate", handleTimeUpdate);

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      registerRef(null);
    };
  }, [start, end, onCheckpoint, onEnded, registerRef]);

  return (
    <div ref={containerRef} className="aspect-video rounded-lg overflow-hidden">
      <youtube-video src={youtubeUrl} controls className="w-full h-full" />
    </div>
  );
}
