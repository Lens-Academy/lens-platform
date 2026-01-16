// web_frontend/src/components/unified-lesson/ContentPanel.tsx
import { useState, useCallback, useEffect } from "react";
import {
  useFloating,
  useClick,
  useDismiss,
  useInteractions,
  offset,
  flip,
  shift,
  FloatingPortal,
} from "@floating-ui/react";
import type {
  Stage,
  PreviousStageInfo,
  ArticleData,
} from "../../types/unified-lesson";
import ArticlePanel from "./ArticlePanel";
import VideoPlayer from "./VideoPlayer";
import OptionalBanner from "./OptionalBanner";
import IntroductionBlock from "./IntroductionBlock";

function BlurredVideoThumbnail({ videoId }: { videoId: string }) {
  const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
  return (
    <div className="h-full flex items-center justify-center bg-white overflow-hidden relative">
      <img
        src={thumbnailUrl}
        alt="Video thumbnail"
        className="max-w-full max-h-full object-contain blur-sm"
      />
      <div className="absolute inset-0 flex items-center justify-center z-20">
        <div className="bg-white rounded-lg px-6 py-4 shadow-lg text-center">
          <svg
            className="w-8 h-8 mx-auto mb-2 text-gray-600"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z"
              clipRule="evenodd"
            />
          </svg>
          <p className="text-gray-600 text-sm">Please chat with the AI tutor</p>
        </div>
      </div>
    </div>
  );
}

function ChatFallbackPlaceholder() {
  return (
    <div className="h-full flex items-center justify-center bg-gray-50 p-8">
      <div className="text-center max-w-md">
        <div className="text-6xl mb-4">💬</div>
        <h2 className="text-xl font-semibold text-gray-800 mb-2">
          Discussion Time
        </h2>
        <p className="text-gray-600">
          Use the chat on the left to discuss what you've learned.
        </p>
      </div>
    </div>
  );
}

type ContentPanelProps = {
  stage: Stage | null;
  article?: ArticleData | null;
  onVideoEnded: () => void;
  onNextClick: () => void;
  onSkipOptional?: () => void;
  isReviewing?: boolean;
  isPreviewing?: boolean; // Viewing future stage
  // For chat stages: show previous content (blurred or visible)
  previousArticle?: ArticleData | null;
  previousStage?: PreviousStageInfo | null;
  showUserPreviousContent?: boolean;
  // Video activity tracking callbacks
  onVideoPlay?: () => void;
  onVideoPause?: () => void;
  onVideoTimeUpdate?: (currentTime: number) => void;
  // Error state for content loading
  contentError?: string | null;
  onRetryContent?: () => void;
  // Introduction note (Lens Academy context)
  introduction?: string;
};

export default function ContentPanel({
  stage,
  article,
  onVideoEnded,
  onNextClick,
  onSkipOptional,
  isReviewing = false,
  isPreviewing = false,
  previousArticle,
  previousStage,
  showUserPreviousContent = true,
  onVideoPlay,
  onVideoPause,
  onVideoTimeUpdate,
  contentError,
  onRetryContent,
  introduction,
}: ContentPanelProps) {
  // Track if user has scrolled to bottom of article
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const handleScrolledToBottom = useCallback(() => {
    setHasScrolledToBottom(true);
  }, []);

  // Track if article content fits without scrolling
  const [contentFits, setContentFits] = useState<boolean | null>(null);
  const handleContentFitsChange = useCallback((fits: boolean) => {
    setContentFits(fits);
  }, []);

  // Reset scroll/content state when article changes
  useEffect(() => {
    setContentFits(null);
    setHasScrolledToBottom(false);
  }, [article?.content]);

  // Popover for "haven't scrolled yet" confirmation
  const [skipPopoverOpen, setSkipPopoverOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open: skipPopoverOpen,
    onOpenChange: setSkipPopoverOpen,
    placement: "top",
    middleware: [offset(8), flip(), shift({ padding: 8 })],
  });
  const click = useClick(context);
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([
    click,
    dismiss,
  ]);

  const handleReadButtonClick = () => {
    // Allow advancing if scrolled to bottom OR if content fits without scrolling
    if (hasScrolledToBottom || contentFits === true) {
      onNextClick();
    }
    // If not scrolled, the popover opens via useClick
  };

  // Done reading button with popover
  // Skip popover if already scrolled to bottom OR if content fits without scrolling
  const skipPopover = hasScrolledToBottom || contentFits === true;
  /* eslint-disable react-hooks/refs -- floating-ui's setReference/setFloating are callback refs (functions), not ref.current access */
  const buttonRef = skipPopover ? undefined : refs.setReference;
  const buttonProps = skipPopover ? {} : getReferenceProps();

  const doneReadingButton = (
    <>
      <button
        ref={buttonRef}
        onClick={handleReadButtonClick}
        {...buttonProps}
        className="w-full py-2 rounded-lg bg-gray-300 text-black hover:bg-gray-400"
        data-testid="done-reading-button"
      >
        Done reading
      </button>
      {skipPopoverOpen && !skipPopover && (
        <FloatingPortal>
          <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()} className="bg-white border border-gray-200 rounded-lg shadow-lg p-4 z-50 max-w-xs">
            <p className="text-sm text-gray-700 mb-3">
              It looks like you haven't reached the bottom of the article yet.
              What would you like to do?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setSkipPopoverOpen(false);
                  onNextClick();
                }}
                className="flex-1 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded"
              >
                Skip anyway
              </button>
              <button
                onClick={() => setSkipPopoverOpen(false)}
                className="flex-1 px-3 py-1.5 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded"
              >
                Keep reading
              </button>
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  );

  // Done watching button
  const doneWatchingButton = (
    <button
      onClick={onNextClick}
      className="w-full py-2 rounded-lg bg-gray-300 text-black hover:bg-gray-400"
    >
      Done watching
    </button>
  );

  // Footer placeholder
  const footerPlaceholder = <div className="py-2 invisible">Placeholder</div>;

  // Content type detection
  const isArticleStage = stage?.type === "article";
  const isVideoStage = stage?.type === "video";
  const isChatStage = stage?.type === "chat";

  const isChatAfterArticle =
    isChatStage && previousStage?.type === "article" && !!previousArticle;
  const isChatAfterVideo =
    isChatStage && previousStage?.type === "video" && !!previousStage?.videoId;
  const isChatFallback =
    isChatStage && !isChatAfterArticle && !isChatAfterVideo;

  const showArticleContent = isArticleStage || isChatAfterArticle;
  const showVideoContent = isVideoStage || isChatAfterVideo;

  // Current stage = not reviewing past, not previewing future
  const isCurrentStage = !isReviewing && !isPreviewing;

  // Article-specific
  // Show error state, loading state, or actual content
  const articleToShow = isArticleStage
    ? (article ?? (contentError ? null : { content: "Loading..." }))
    : previousArticle;
  const articleBlurred = isChatAfterArticle && !showUserPreviousContent;
  const articleShowButton = isArticleStage && isCurrentStage;
  const showContentError = isArticleStage && contentError && !article;

  // Video-specific
  const videoId = isVideoStage ? stage.videoId : previousStage?.videoId;
  const videoStart = isVideoStage ? stage.from : (previousStage?.from ?? 0);
  const videoEnd = isVideoStage
    ? stage.to || 9999
    : (previousStage?.to ?? 9999);
  const videoBlurred = isChatAfterVideo && !showUserPreviousContent;

  // Optional banner (only for article/video stages when current)
  const isOptional = stage && "optional" in stage && stage.optional === true;
  const showOptionalBanner =
    isOptional &&
    isCurrentStage &&
    onSkipOptional &&
    (isArticleStage || isVideoStage);
  const optionalBannerStageType = isArticleStage ? "article" : "video";

  // Footer content decision
  // - Article (current, sticky): done reading button
  // - Video (current): done watching button
  // - Everything else: placeholder
  const useArticleStickyFooter = articleShowButton && contentFits !== true;

  let footerContent: React.ReactNode;
  if (isArticleStage && useArticleStickyFooter) {
    footerContent = doneReadingButton;
  } else if (isVideoStage && isCurrentStage) {
    footerContent = doneWatchingButton;
  } else {
    footerContent = footerPlaceholder;
  }

  // Content area based on stage type
  let contentArea: React.ReactNode = null;

  // Show error state with retry button
  if (showContentError) {
    contentArea = (
      <div className="h-full flex items-center justify-center bg-gray-50 p-8">
        <div className="text-center max-w-md">
          <div className="text-5xl mb-4">⚠️</div>
          <h2 className="text-xl font-semibold text-gray-800 mb-2">
            Content Failed to Load
          </h2>
          <p className="text-gray-600 mb-4">{contentError}</p>
          {onRetryContent && (
            <button
              onClick={onRetryContent}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
            >
              Try Again
            </button>
          )}
        </div>
      </div>
    );
  } else if (showArticleContent && articleToShow) {
    // Inline button for short articles
    const useInlineButton = articleShowButton && contentFits === true;
    const afterContent = useInlineButton ? (
      <div className="max-w-[620px] mx-auto px-6 pb-6">{doneReadingButton}</div>
    ) : undefined;

    contentArea = (
      <ArticlePanel
        article={articleToShow}
        blurred={articleBlurred}
        onScrolledToBottom={
          articleShowButton ? handleScrolledToBottom : undefined
        }
        onContentFitsChange={
          articleShowButton ? handleContentFitsChange : undefined
        }
        afterContent={afterContent}
        introduction={isArticleStage ? introduction : undefined}
      />
    );
  } else if (showVideoContent && videoId) {
    if (videoBlurred) {
      contentArea = <BlurredVideoThumbnail videoId={videoId} />;
    } else {
      const showVideoIntro = isVideoStage && introduction;
      contentArea = (
        <div className="h-full flex flex-col">
          {/* Introduction section - scrollable if long */}
          {showVideoIntro && (
            <div className="flex-shrink-0 max-h-[30%] overflow-y-auto px-4 pt-4">
              <div className="max-w-[800px] mx-auto">
                <IntroductionBlock text={introduction} />
              </div>
            </div>
          )}
          {/* Video centered in remaining space */}
          <div className="flex-1 flex flex-col justify-center min-h-0">
            <VideoPlayer
              videoId={videoId}
              start={videoStart}
              end={videoEnd}
              onEnded={isVideoStage && isCurrentStage ? onVideoEnded : () => {}}
              hideControls={isChatAfterVideo}
              onPlay={isVideoStage && isCurrentStage ? onVideoPlay : undefined}
              onPause={isVideoStage && isCurrentStage ? onVideoPause : undefined}
              onTimeUpdate={
                isVideoStage && isCurrentStage ? onVideoTimeUpdate : undefined
              }
            />
          </div>
        </div>
      );
    }
  } else if (isChatFallback) {
    contentArea = <ChatFallbackPlaceholder />;
  }

  // Guard clause: no stage means lesson complete
  if (!stage) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Lesson complete!</p>
      </div>
    );
  }

  // Single return with consistent structure
  return (
    <div className="h-full flex flex-col">
      {showOptionalBanner && (
        <div className="px-4 pt-4 max-w-[620px] mx-auto w-full">
          <OptionalBanner
            stageType={optionalBannerStageType}
            onSkip={onSkipOptional!}
          />
        </div>
      )}
      <div className="flex-1 overflow-hidden">{contentArea}</div>
      <div className="p-4 border-t border-gray-200 bg-white">
        <div className="max-w-[620px] mx-auto">{footerContent}</div>
      </div>
    </div>
  );
}
