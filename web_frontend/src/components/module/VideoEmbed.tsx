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
  const [showLoading, setShowLoading] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isFirst = excerptNumber === 1;

  // YouTube thumbnail: try maxresdefault (1280px), fall back to hqdefault (480px)
  const [thumbRes, setThumbRes] = useState<"maxresdefault" | "hqdefault">(
    "maxresdefault",
  );
  const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/${thumbRes}.jpg`;

  const handleActivate = useCallback(() => {
    setIsActivated(true);
    setIsTheaterMode(true);
    onTheaterChange?.(true);
  }, [onTheaterChange]);

  // Warm up YouTube connections on hover (same technique as lite-youtube-embed)
  const preconnected = useRef(false);
  const warmConnections = useCallback(() => {
    if (preconnected.current) return;
    preconnected.current = true;
    const origins = [
      "https://www.youtube-nocookie.com",
      "https://www.youtube.com",
      "https://www.google.com",
    ];
    for (const origin of origins) {
      const link = document.createElement("link");
      link.rel = "preconnect";
      link.href = origin;
      document.head.append(link);
    }
  }, []);

  const handlePlay = useCallback(() => {
    setHasPlayed(true);
    setShowLoading(false);
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

  // Show loading indicator if video hasn't played after 1 second
  useEffect(() => {
    if (!isActivated || hasPlayed) return;
    const timer = setTimeout(() => setShowLoading(true), 1000);
    return () => clearTimeout(timer);
  }, [isActivated, hasPlayed]);

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
          className={`${videoContainerClasses} relative`}
          style={{
            flex: isTheaterMode ? "1 1 0" : undefined,
            minHeight: isTheaterMode ? 0 : undefined,
            overflow: isTheaterMode ? "hidden" : undefined,
            display: isTheaterMode ? "flex" : undefined,
            flexDirection: isTheaterMode ? "column" : undefined,
            justifyContent: isTheaterMode ? "center" : undefined,
          }}
        >
          {/* Loading indicator while YouTube iframe initializes */}
          {showLoading && !hasPlayed && (
            <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
              <div className="text-white/70 text-sm flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Loading video…
              </div>
            </div>
          )}
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
      <div className="rounded-lg overflow-hidden shadow-sm bg-black">
        <button
          onClick={handleActivate}
          onPointerOver={warmConnections}
          onFocus={warmConnections}
          className="relative block w-full aspect-video group cursor-pointer"
          aria-label={label}
        >
          {/* Thumbnail */}
          <img
            src={thumbnailUrl}
            alt="Video thumbnail"
            className="w-full h-full object-cover"
            onError={() => {
              if (thumbRes === "maxresdefault") setThumbRes("hqdefault");
            }}
          />

          {/* Top gradient + title (YouTube's exact gradient) */}
          {title && (
            <div
              className="absolute top-0 left-0 right-0 px-4 pt-3 pb-8 text-left"
              style={{
                backgroundImage:
                  "linear-gradient(180deg, rgb(0 0 0 / 67%) 0%, rgb(0 0 0 / 54%) 14%, rgb(0 0 0 / 15%) 54%, rgb(0 0 0 / 5%) 72%, rgb(0 0 0 / 0%) 94%)",
              }}
            >
              <div className="text-white text-lg font-medium text-shadow-sm">
                {title}
              </div>
              {channel && (
                <div className="text-white text-base mt-0.5 text-shadow-sm">
                  {channel}
                </div>
              )}
            </div>
          )}

          {/* YouTube red play button */}
          <div className="absolute inset-0 flex items-center justify-center">
            <svg
              className="w-[68px] h-[48px]"
              viewBox="0 0 68 48"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M66.52 7.74c-.78-2.93-2.49-5.41-5.42-6.19C55.79.13 34 0 34 0S12.21.13 6.9 1.55c-2.93.78-4.63 3.26-5.42 6.19C.06 13.05 0 24 0 24s.06 10.95 1.48 16.26c.78 2.93 2.49 5.41 5.42 6.19C12.21 47.87 34 48 34 48s21.79-.13 27.1-1.55c2.93-.78 4.64-3.26 5.42-6.19C67.94 34.95 68 24 68 24s-.06-10.95-1.48-16.26z"
                fill="red"
              />
              <path d="M45 24 27 14v20" fill="white" />
            </svg>
          </div>

          {/* Duration badge (only show when end time is specified) */}
          {end !== null && (
            <div className="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-2 py-1 rounded">
              {formatDuration(end - start)}
            </div>
          )}
        </button>
      </div>
    </div>
  );
}
