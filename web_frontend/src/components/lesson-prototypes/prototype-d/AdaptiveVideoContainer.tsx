// web_frontend/src/components/lesson-prototypes/prototype-d/AdaptiveVideoContainer.tsx

import { useEffect, useRef, useState } from "react";
// youtube-video-element is already imported and typed in unified-lesson/VideoPlayer.tsx
// The JSX intrinsic element declaration is shared across the app
import "youtube-video-element";

type AdaptiveVideoContainerProps = {
  videoId: string;
  start: number;
  end: number;
  checkpoints: number[];
  onCheckpointReached: (timestamp: number) => void;
  onResume: () => void;
  onEnded: () => void;
  isPausedForChat: boolean;
};

export function AdaptiveVideoContainer({
  videoId,
  start,
  end,
  checkpoints,
  onCheckpointReached,
  onResume,
  onEnded,
  isPausedForChat,
}: AdaptiveVideoContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [currentTime, setCurrentTime] = useState(start);
  const passedCheckpoints = useRef<Set<number>>(new Set());

  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}&t=${start}`;
  const duration = end - start;
  const progress = Math.min(Math.max((currentTime - start) / duration, 0), 1);

  useEffect(() => {
    if (!containerRef.current) return;

    const video = containerRef.current.querySelector(
      "youtube-video"
    ) as HTMLVideoElement | null;
    if (!video) return;
    videoRef.current = video;

    const handleLoadedMetadata = () => {
      video.currentTime = start;
    };

    const handleTimeUpdate = () => {
      const time = video.currentTime;
      setCurrentTime(time);

      // Check checkpoints first (before end detection)
      for (const cp of checkpoints) {
        if (time >= cp && !passedCheckpoints.current.has(cp)) {
          passedCheckpoints.current.add(cp);
          video.pause();
          onCheckpointReached(cp);
          return; // Don't check end if checkpoint fired
        }
      }

      // Check end (only if no checkpoint fired)
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
    };
  }, [start, end, checkpoints, onCheckpointReached, onEnded]);

  // Pause/resume based on chat state
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPausedForChat && !video.paused) {
      video.pause();
    }
  }, [isPausedForChat]);

  const handleResumeClick = () => {
    const video = videoRef.current;
    if (video) {
      video.play();
      onResume();
    }
  };

  return (
    <div
      ref={containerRef}
      className={`transition-all duration-500 ease-in-out ${
        isPausedForChat ? "w-[60%]" : "w-full"
      }`}
    >
      <div className="aspect-video relative rounded-lg overflow-hidden bg-black">
        <youtube-video src={youtubeUrl} controls className="w-full h-full" />

        {/* Paused overlay with resume button */}
        {isPausedForChat && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
            <button
              onClick={handleResumeClick}
              className="bg-white/90 hover:bg-white text-gray-800 px-4 py-2 rounded-lg font-medium shadow-lg"
            >
              Resume Video
            </button>
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-gray-700 rounded-full mt-2">
        <div
          className="h-full bg-blue-500 rounded-full transition-all"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </div>
  );
}
