// web_frontend/src/components/lesson-prototypes/prototype-a/ScrollVideoPlayer.tsx

import { useEffect, useRef, useState } from "react";
// youtube-video-element is already imported and typed in unified-lesson/VideoPlayer.tsx
// The JSX intrinsic element declaration is shared across the app
import "youtube-video-element";

type ScrollVideoPlayerProps = {
  videoId: string;
  start: number;
  end: number;
  checkpoints?: number[]; // Timestamps to pause at
  onCheckpointReached?: (timestamp: number) => void;
  onEnded?: () => void;
  isPaused?: boolean; // External pause control
};

export function ScrollVideoPlayer({
  videoId,
  start,
  end,
  checkpoints = [],
  onCheckpointReached,
  onEnded,
  isPaused = false,
}: ScrollVideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const passedCheckpoints = useRef<Set<number>>(new Set());

  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}&t=${start}`;
  const duration = end - start;

  // Get video element and set up listeners
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

      // Check if we hit a checkpoint
      for (const checkpoint of checkpoints) {
        if (
          time >= checkpoint &&
          !passedCheckpoints.current.has(checkpoint) &&
          time < checkpoint + 1
        ) {
          passedCheckpoints.current.add(checkpoint);
          video.pause();
          onCheckpointReached?.(checkpoint);
          return;
        }
      }

      // Check if we hit the end
      if (time >= end - 0.5) {
        video.pause();
        onEnded?.();
      }
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("timeupdate", handleTimeUpdate);

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("timeupdate", handleTimeUpdate);
    };
  }, [start, end, checkpoints, onCheckpointReached, onEnded]);

  // Handle external pause control
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPaused && !video.paused) {
      video.pause();
    }
  }, [isPaused]);

  const progress = Math.min((currentTime - start) / duration, 1);

  return (
    <div ref={containerRef} className="w-full">
      <div className="aspect-video relative rounded-lg overflow-hidden">
        <youtube-video src={youtubeUrl} controls className="w-full h-full" />
      </div>
      {/* Progress bar */}
      <div className="h-1 bg-gray-200 rounded-full mt-2">
        <div
          className="h-full bg-blue-600 rounded-full transition-all"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </div>
  );
}
