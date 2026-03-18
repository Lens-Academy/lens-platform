// web_frontend_next/src/components/module/VideoEmbed.tsx

import { useState, useRef, useEffect, useCallback } from "react";
import VideoPlayer from "@/components/module/VideoPlayer";
import { formatDuration } from "@/utils/formatDuration";

type VideoEmbedProps = {
  videoId: string;
  start: number;
  end: number | null; // null = play to end of video
  excerptNumber?: number; // 1-indexed, defaults to 1 (first clip)
  title?: string;
  channel?: string | null;
  onPlay?: () => void;
  onPause?: () => void;
  onTimeUpdate?: (currentTime: number) => void;
  onTheaterChange?: (active: boolean) => void;
};

/**
 * Lazy-loading video embed that shows a thumbnail until clicked.
 * Only loads the YouTube iframe when the user clicks play.
 * Enters "theater mode" when activated: full-bleed dark background,
 * spacers above/below for vertical centering, scroll-snap alignment.
 */
export default function VideoEmbed({
  videoId,
  start,
  end,
  excerptNumber = 1,
  title,
  channel,
  onPlay,
  onPause,
  onTimeUpdate,
  onTheaterChange,
}: VideoEmbedProps) {
  const [isActivated, setIsActivated] = useState(false);
  const [isTheaterMode, setIsTheaterMode] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isFirst = excerptNumber === 1;

  // YouTube thumbnail URL (hqdefault is always available)
  const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

  const handleActivate = useCallback(() => {
    setIsActivated(true);
    setIsTheaterMode(true);
    onTheaterChange?.(true);
  }, [onTheaterChange]);

  const handlePlay = useCallback(() => {
    if (!isTheaterMode) {
      setIsTheaterMode(true);
      onTheaterChange?.(true);
    }
    onPlay?.();
  }, [isTheaterMode, onTheaterChange, onPlay]);

  const handleComplete = useCallback(() => {
    setIsTheaterMode(false);
    onTheaterChange?.(false);
  }, [onTheaterChange]);

  // Scroll into view when entering theater mode
  useEffect(() => {
    if (isTheaterMode && containerRef.current) {
      containerRef.current.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [isTheaterMode]);

  // Video container classes
  const videoContainerClasses = isActivated
    ? `${isTheaterMode ? "w-[98%]" : "w-[80%]"} max-w-[1600px] mx-auto scroll-mt-20 transition-all duration-300`
    : "w-full px-4 sm:px-0 sm:max-w-content mx-auto py-4 scroll-mt-20 transition-all duration-300";

  // Label: "Watch" for first clip, "Watch Part N" for subsequent
  const label = isFirst ? "Watch" : `Watch Part ${excerptNumber}`;

  // Full-bleed width: viewport minus sidebar (--sidebar-open-width set by ChatSidebar)
  const fullBleedWidth = "calc(100vw - var(--sidebar-open-width, 0px))";
  const fullBleedMargin =
    "calc((100vw - var(--sidebar-open-width, 0px)) / -2 + 50%)";

  if (isActivated) {
    // Theater wrapper is a flex column with fixed height = available viewport.
    // Spacers take fixed space, video container fills the rest via flex:1.
    const theaterHeight = isTheaterMode
      ? "calc(100dvh - var(--header-offset, 68px))"
      : "auto";
    return (
      <div
        ref={containerRef}
        style={{
          marginLeft: isTheaterMode ? fullBleedMargin : undefined,
          width: isTheaterMode ? fullBleedWidth : undefined,
          height: theaterHeight,
          display: isTheaterMode ? "flex" : undefined,
          flexDirection: isTheaterMode ? "column" : undefined,
          alignItems: isTheaterMode ? "center" : undefined,
          backgroundColor: isTheaterMode ? "rgb(15 15 15)" : "transparent",
          transition:
            "background-color 500ms ease, height 500ms cubic-bezier(0.22, 1, 0.36, 1), width 300ms ease-in-out, margin-left 300ms ease-in-out",
          scrollSnapAlign: isTheaterMode ? "center" : undefined,
          scrollMargin: isTheaterMode
            ? "var(--header-offset, 68px) 0 0 0"
            : undefined,
        }}
      >
        {/* Video container — flex:1 fills remaining space, contents shrink to fit */}
        <div
          className={videoContainerClasses}
          style={{
            flex: isTheaterMode ? "1 1 0" : undefined,
            minHeight: isTheaterMode ? 0 : undefined,
            overflow: isTheaterMode ? "hidden" : undefined,
            display: isTheaterMode ? "flex" : undefined,
            flexDirection: isTheaterMode ? "column" : undefined,
            justifyContent: isTheaterMode ? "center" : undefined,
          }}
        >
          <VideoPlayer
            videoId={videoId}
            start={start}
            end={end}
            autoplay
            onPlay={handlePlay}
            onPause={onPause}
            onTimeUpdate={onTimeUpdate}
            onComplete={handleComplete}
            theater={isTheaterMode}
          />
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={videoContainerClasses}>
      <div className="bg-stone-100 rounded-lg overflow-hidden shadow-sm">
        <button
          onClick={handleActivate}
          className="relative block w-full aspect-video group cursor-pointer"
          aria-label={label}
        >
          {/* Thumbnail */}
          <img
            src={thumbnailUrl}
            alt="Video thumbnail"
            className="w-full h-full object-cover"
          />

          {/* Dark overlay */}
          <div className="absolute inset-0 bg-black/40 group-hover:bg-black/50 transition-colors" />

          {/* Label text */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-white text-lg font-medium bg-black/60 px-4 py-2 rounded-lg group-hover:scale-105 transition-transform">
              {label}
            </div>
          </div>

          {/* Duration badge (only show when end time is specified) */}
          {end !== null && (
            <div className="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-2 py-1 rounded">
              {formatDuration(end - start)}
            </div>
          )}
        </button>

        {/* Title and channel below thumbnail (YouTube style) */}
        {(title || channel) && (
          <div className="px-3 py-2">
            {title && (
              <div className="text-sm font-medium text-stone-800 line-clamp-2">
                {title}
              </div>
            )}
            {channel && (
              <div className="text-xs text-stone-500 mt-0.5">{channel}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
