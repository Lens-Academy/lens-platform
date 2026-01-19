// web_frontend/src/components/lesson-prototypes/prototype-b/StickyVideoLesson.tsx

import { useState, useRef, useEffect, useCallback } from "react";
import type { PrototypeLesson, ContentBlock } from "../shared/types";
import { usePrototypeLesson } from "../shared/usePrototypeLesson";
import { SimpleChatBox } from "../shared/SimpleChatBox";
import { MarkdownBlock } from "../shared/MarkdownBlock";
import "youtube-video-element";

type StickyVideoLessonProps = {
  lesson: PrototypeLesson;
  sessionId: number | null;
};

// Constants for video sizing
const HEADER_HEIGHT = 65;
const MAX_VIDEO_HEIGHT = 500;
const MIN_VIDEO_HEIGHT = 240;

export function StickyVideoLesson({
  lesson,
  sessionId,
}: StickyVideoLessonProps) {
  const { getChatState, sendChatMessage, completedBlocks, markBlockCompleted } =
    usePrototypeLesson({ sessionId });

  // Video state
  const [videoBlock, setVideoBlock] = useState<ContentBlock & { type: "video" } | null>(null);
  const [videoHeight, setVideoHeight] = useState(MAX_VIDEO_HEIGHT);
  const [isSticky, setIsSticky] = useState(false);
  const [spacerMounted, setSpacerMounted] = useState(false);
  const [spacerTop, setSpacerTop] = useState(0);

  // Track where video is expanded - null means original position, string means after that block ID
  const [expandedAfterBlockId, setExpandedAfterBlockId] = useState<string | null>(null);

  const videoWrapperRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const expandedSpacerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mainRef = useRef<HTMLElement>(null);

  // Track when spacer is mounted
  const spacerCallbackRef = useCallback((el: HTMLDivElement | null) => {
    spacerRef.current = el;
    setSpacerMounted(!!el);
  }, []);

  // Track expanded spacer and update position after DOM settles
  const expandedSpacerCallbackRef = useCallback((el: HTMLDivElement | null) => {
    expandedSpacerRef.current = el;
    if (el) {
      // Wait for multiple frames to ensure DOM has fully settled
      const updatePosition = () => setSpacerTop(el.offsetTop);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          updatePosition();
          // Also update after transitions complete
          setTimeout(updatePosition, 300);
          setTimeout(updatePosition, 500);
        });
      });
    }
  }, []);

  // Calculate spacer position after mount or when expanded position changes
  useEffect(() => {
    const updateSpacerTop = () => {
      if (expandedAfterBlockId && expandedSpacerRef.current) {
        setSpacerTop(expandedSpacerRef.current.offsetTop);
      } else if (spacerMounted && spacerRef.current) {
        setSpacerTop(spacerRef.current.offsetTop);
      }
    };

    // Need multiple attempts because DOM may not be ready immediately
    updateSpacerTop();
    const timer1 = setTimeout(updateSpacerTop, 0);
    const timer2 = setTimeout(updateSpacerTop, 50);
    const timer3 = setTimeout(updateSpacerTop, 100);
    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, [spacerMounted, expandedAfterBlockId]);

  // Find the video block
  useEffect(() => {
    const video = lesson.blocks.find(
      (block): block is ContentBlock & { type: "video" } => block.type === "video"
    );
    if (video) {
      setVideoBlock(video);
    }
  }, [lesson.blocks]);

  // Get video element reference
  useEffect(() => {
    if (!videoWrapperRef.current || !videoBlock) return;

    const video = videoWrapperRef.current.querySelector(
      "youtube-video"
    ) as HTMLVideoElement | null;
    videoRef.current = video;

    if (video) {
      const handleLoadedMetadata = () => {
        video.currentTime = videoBlock.start;
      };
      video.addEventListener("loadedmetadata", handleLoadedMetadata);
      return () => video.removeEventListener("loadedmetadata", handleLoadedMetadata);
    }
  }, [videoBlock]);

  // Scroll handler for sticky detection and progressive shrinking
  useEffect(() => {
    const handleScroll = () => {
      // Use the expanded spacer if we're expanded, otherwise use original
      const activeSpacerRef = expandedAfterBlockId ? expandedSpacerRef : spacerRef;
      if (!activeSpacerRef.current) return;

      const spacerRect = activeSpacerRef.current.getBoundingClientRect();
      const spacerTopPos = spacerRect.top;

      // Video becomes sticky when its natural position would be above the header
      const shouldBeSticky = spacerTopPos < HEADER_HEIGHT;
      setIsSticky(shouldBeSticky);

      if (shouldBeSticky) {
        // Calculate how far we've scrolled past where the video would naturally be
        const scrollPast = HEADER_HEIGHT - spacerTopPos;

        // Shrink 1:1 with scroll so bottom edge stays aligned with content
        const newHeight = MAX_VIDEO_HEIGHT - scrollPast;
        setVideoHeight(Math.max(newHeight, MIN_VIDEO_HEIGHT));
      } else {
        setVideoHeight(MAX_VIDEO_HEIGHT);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => window.removeEventListener("scroll", handleScroll);
  }, [expandedAfterBlockId]);


  const handleExpandVideo = useCallback((afterBlockId: string) => {
    setExpandedAfterBlockId(afterBlockId);
    setVideoHeight(MAX_VIDEO_HEIGHT);
    setIsSticky(false);

    // Play the video if paused
    if (videoRef.current && videoRef.current.paused) {
      videoRef.current.play();
    }

    // Scroll so the video is near the top after a short delay for DOM to settle
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (expandedSpacerRef.current) {
            const spacerRect = expandedSpacerRef.current.getBoundingClientRect();
            const scrollTarget = window.scrollY + spacerRect.top - HEADER_HEIGHT - 20;
            window.scrollTo({ top: scrollTarget, behavior: 'smooth' });
          }
        }, 350);
      });
    });
  }, []);

  const youtubeUrl = videoBlock
    ? `https://www.youtube.com/watch?v=${videoBlock.videoId}&t=${videoBlock.start}`
    : "";

  const handleChatComplete = (blockId: string) => {
    markBlockCompleted(blockId);
  };

  const renderBlock = (block: ContentBlock, index: number) => {
    const prevBlock = lesson.blocks[index - 1];
    const isAfterChat = prevBlock?.type === "chat";
    const isLocked = isAfterChat && !completedBlocks.has(prevBlock.id);

    // Check if we should render the expanded video spacer after this block
    const shouldRenderExpandedSpacer = expandedAfterBlockId === block.id;

    const blockContent = (() => {
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
          // Render original spacer - hidden when expanded elsewhere, visible when at home
          return (
            <div
              key={block.id}
              ref={spacerCallbackRef}
              className="max-w-[900px] mx-auto my-8"
              style={{
                height: expandedAfterBlockId ? 0 : MAX_VIDEO_HEIGHT,
                overflow: 'hidden',
                transition: 'height 0.3s ease-out'
              }}
            />
          );

        case "chat":
          return (
            <div
              key={block.id}
              className={`max-w-[700px] mx-auto my-8 ${isLocked ? "opacity-30 pointer-events-none" : ""}`}
            >
              <div className="border-l-4 border-blue-500 pl-4">
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

              {/* Watch next section button - shows when video is shrunk */}
              {videoHeight < MAX_VIDEO_HEIGHT * 0.7 && expandedAfterBlockId !== block.id && (
                <div className="mt-6 text-center">
                  <button
                    onClick={() => handleExpandVideo(block.id)}
                    className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    <span>▶</span>
                    <span>Watch next section</span>
                  </button>
                </div>
              )}
            </div>
          );
      }
    })();

    // If this block has the expanded spacer after it, render both
    if (shouldRenderExpandedSpacer) {
      return (
        <>
          {blockContent}
          <div
            key={`expanded-spacer-${block.id}`}
            ref={expandedSpacerCallbackRef}
            className="max-w-[900px] mx-auto my-8"
            style={{ height: MAX_VIDEO_HEIGHT }}
          />
        </>
      );
    }

    return blockContent;
  };

  // Calculate video dimensions maintaining 16:9 aspect ratio
  const currentHeight = isSticky ? videoHeight : MAX_VIDEO_HEIGHT;
  const videoWidth = currentHeight * (16 / 9);

  // Calculate video position - either in its natural spot or sticky at top
  const videoStyle: React.CSSProperties = isSticky
    ? {
        position: "fixed",
        top: HEADER_HEIGHT,
        left: "50%",
        transform: "translateX(-50%)",
        width: videoWidth,
        height: videoHeight,
        zIndex: 10,
      }
    : {
        position: "absolute",
        top: spacerTop,
        left: "50%",
        transform: "translateX(-50%)",
        width: videoWidth,
        height: MAX_VIDEO_HEIGHT,
      };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="sticky top-0 bg-white border-b border-gray-200 z-20">
        <div className="max-w-[900px] mx-auto px-6 py-4">
          <h1 className="text-xl font-semibold">{lesson.title}</h1>
          <p className="text-sm text-gray-500">
            Prototype B: Shrinking Sticky Video
          </p>
        </div>
      </header>

      {/* Content */}
      <main ref={mainRef} className="px-6 py-8">
        <div className="space-y-8 relative">
          {/* Single video element - positioned absolutely or fixed */}
          {videoBlock && spacerMounted && (
            <div
              ref={videoWrapperRef}
              className="bg-black rounded-lg overflow-hidden"
              style={videoStyle}
            >
              <youtube-video
                src={youtubeUrl}
                controls
                className="w-full h-full"
              />

              {/* Watch next section overlay when minimized */}
              {isSticky && videoHeight < MAX_VIDEO_HEIGHT * 0.5 && (
                <button
                  onClick={() => {
                    // Find the last chat block that's visible
                    const chatBlocks = lesson.blocks.filter(b => b.type === 'chat');
                    if (chatBlocks.length > 0) {
                      handleExpandVideo(chatBlocks[chatBlocks.length - 1].id);
                    }
                  }}
                  className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/40 transition-colors"
                >
                  <span className="bg-white/90 px-4 py-2 rounded-lg text-sm font-medium">
                    ▶ Watch next section
                  </span>
                </button>
              )}
            </div>
          )}

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
