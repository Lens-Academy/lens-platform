// web_frontend_next/src/components/module/VideoEmbed.tsx

import { useState, useRef, useEffect } from "react";
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
};

/**
 * Lazy-loading video embed that shows a thumbnail until clicked.
 * Only loads the YouTube iframe when the user clicks play.
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
}: VideoEmbedProps) {
  const [isActivated, setIsActivated] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isFirst = excerptNumber === 1;

  // YouTube thumbnail URL (hqdefault is always available)
  const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

  // Scroll into view when video is activated
  useEffect(() => {
    if (isActivated && containerRef.current) {
      containerRef.current.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  }, [isActivated]);

  // All clips start compact, expand when activated
  // Mobile-first: full width on mobile, constrained on desktop (sm: 640px+)
  const containerClasses = isActivated
    ? "w-full sm:w-[90%] sm:max-w-[1100px] mx-auto py-4 scroll-mt-20 transition-all duration-300"
    : "w-full px-4 sm:px-0 sm:max-w-content mx-auto py-4 scroll-mt-20 transition-all duration-300";

  // Label: "Watch" for first clip, "Watch Part N" for subsequent
  const label = isFirst ? "Watch" : `Watch Part ${excerptNumber}`;

  return (
    <div ref={containerRef} className={containerClasses}>
      {isActivated ? (
        <VideoPlayer
          videoId={videoId}
          start={start}
          end={end}
          autoplay
          onPlay={onPlay}
          onPause={onPause}
          onTimeUpdate={onTimeUpdate}
        />
      ) : (
        <div className="bg-stone-100 rounded-lg overflow-hidden shadow-sm">
          <button
            onClick={() => setIsActivated(true)}
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
      )}
    </div>
  );
}
