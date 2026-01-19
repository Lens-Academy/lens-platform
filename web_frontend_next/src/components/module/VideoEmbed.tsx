// web_frontend_next/src/components/module/VideoEmbed.tsx
"use client";

import { useState, useRef, useEffect } from "react";
import VideoPlayer from "@/components/module/VideoPlayer";
import ContinueVideoButton from "@/components/module/ContinueVideoButton";
import { formatDuration } from "@/utils/formatDuration";

type VideoEmbedProps = {
  videoId: string;
  start: number;
  end: number;
  isFirstInSection?: boolean; // defaults to true for backward compat
  onEnded?: () => void;
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
  isFirstInSection,
  onEnded,
  onPlay,
  onPause,
  onTimeUpdate,
}: VideoEmbedProps) {
  const [isActivated, setIsActivated] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isFirst = isFirstInSection ?? true;

  // YouTube thumbnail URL (hqdefault is always available)
  const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

  // Scroll into view when video is activated (for continue button clicks)
  // VideoPlayer manages its own dimensions, so scroll position is correct immediately
  useEffect(() => {
    if (isActivated && !isFirst && containerRef.current) {
      containerRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [isActivated, isFirst]);

  return (
    <div ref={containerRef} className="w-[80%] max-w-[900px] mx-auto py-4 scroll-mt-20">
      <div className="bg-stone-100 rounded-lg overflow-hidden shadow-sm">
        {isActivated ? (
          <VideoPlayer
            videoId={videoId}
            start={start}
            end={end}
            autoplay
            onEnded={onEnded ?? (() => {})}
            onPlay={onPlay}
            onPause={onPause}
            onTimeUpdate={onTimeUpdate}
          />
        ) : isFirst ? (
          <button
            onClick={() => setIsActivated(true)}
            className="relative w-full aspect-video group cursor-pointer"
            aria-label="Play video"
          >
            {/* Thumbnail */}
            <img
              src={thumbnailUrl}
              alt="Video thumbnail"
              className="w-full h-full object-cover"
            />

            {/* Dark overlay on hover */}
            <div className="absolute inset-0 bg-black/20 group-hover:bg-black/40 transition-colors" />

            {/* Play button */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-16 h-16 bg-red-600 rounded-full flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                <svg
                  className="w-8 h-8 text-white ml-1"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            </div>

            {/* Duration badge */}
            <div className="absolute bottom-3 right-3 bg-black/80 text-white text-sm px-2 py-1 rounded">
              {formatDuration(end - start)}
            </div>
          </button>
        ) : (
          <ContinueVideoButton
            durationSeconds={end - start}
            onClick={() => setIsActivated(true)}
          />
        )}
      </div>
    </div>
  );
}
