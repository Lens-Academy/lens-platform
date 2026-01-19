// web_frontend_next/src/components/narrative-lesson/VideoEmbed.tsx
"use client";

import { useState } from "react";
import VideoPlayer from "@/components/unified-lesson/VideoPlayer";

type VideoEmbedProps = {
  videoId: string;
  start: number;
  end: number;
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
  onEnded,
  onPlay,
  onPause,
  onTimeUpdate,
}: VideoEmbedProps) {
  const [isActivated, setIsActivated] = useState(false);

  // YouTube thumbnail URL (hqdefault is always available)
  const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="w-[80%] max-w-[900px] mx-auto py-4">
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
        ) : (
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
              {formatTime(end - start)}
            </div>
          </button>
        )}
      </div>
    </div>
  );
}
