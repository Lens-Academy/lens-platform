import { useEffect, useRef, useState } from "react";
import "youtube-video-element";

type VideoPlayerProps = {
  videoId: string;
  start: number;
  end: number;
  onEnded: () => void;
  /** Hide the continue button (for reviewing previous videos) */
  hideControls?: boolean;
  /** Activity tracking callbacks */
  onPlay?: () => void;
  onPause?: () => void;
  onTimeUpdate?: (currentTime: number) => void;
};

// Extend JSX to include the youtube-video custom element (React 19 style)
declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Required for JSX module augmentation
  namespace JSX {
    interface IntrinsicElements {
      "youtube-video": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          autoplay?: boolean;
          muted?: boolean;
          controls?: boolean;
        },
        HTMLElement
      >;
    }
  }
}

export default function VideoPlayer({
  videoId,
  start,
  end,
  onEnded,
  hideControls = false,
  onPlay: onPlayCallback,
  onPause: onPauseCallback,
  onTimeUpdate: onTimeUpdateCallback,
}: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const originalVolumeRef = useRef(1);
  const isDraggingRef = useRef(false);
  const isFadingRef = useRef(false); // Mirror of isFading for event callbacks
  const fadeIntervalRef = useRef<number | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);

  const [progress, setProgress] = useState(0);
  const [fragmentEnded, setFragmentEnded] = useState(false);
  const [isFading, setIsFading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [isPaused, setIsPaused] = useState(true);
  const [isFullVideo, setIsFullVideo] = useState(false);
  // Playback warning state (used by VPN warning feature)
  const [showPlaybackWarning, setShowPlaybackWarning] = useState(false);
  const playCheckTimeoutRef = useRef<number | null>(null);

  // Keep ref in sync with state for event callbacks
  useEffect(() => {
    isFadingRef.current = isFading;
  }, [isFading]);

  const duration = end - start;
  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}&t=${start}`;

  // Get video element reference from container (scoped query, not global)
  useEffect(() => {
    if (!containerRef.current) return;

    const video = containerRef.current.querySelector(
      "youtube-video"
    ) as HTMLVideoElement | null;
    if (!video) return;

    videoRef.current = video;

    const handleLoadedMetadata = () => {
      video.currentTime = start;
      // Don't auto-play - wait for user to click play
    };

    const handlePlay = () => {
      setIsPaused(false);
      setShowPlaybackWarning(false); // Reset warning when video actually starts
      onPlayCallback?.();
      // Don't clear the timeout here - let it run and check currentTime
      // This way we detect if YouTube blocks playback despite firing play event
    };

    // Detect when user clicks into the YouTube iframe by polling for focus
    // (Click events don't bubble out of cross-origin iframes)
    // Note: The youtube-video element creates the iframe in its shadow DOM,
    // so we need to look inside the shadow root
    const container = containerRef.current;
    let lastActiveWasIframe = false;
    let iframeFocusCheckInterval: number | null = null;
    let currentIframe: HTMLIFrameElement | null = null;

    const ytVideo = container.querySelector("youtube-video");

    iframeFocusCheckInterval = window.setInterval(() => {
      // Check if iframe exists - youtube-video puts it in shadow DOM
      if (!currentIframe) {
        const shadowRoot = ytVideo?.shadowRoot;
        currentIframe = shadowRoot?.querySelector("iframe") ?? null;
      }

      if (!currentIframe) return; // Still waiting for iframe

      // Check if youtube-video element is active (not the inner iframe - shadow DOM boundary)
      const isIframeActive = document.activeElement === ytVideo;

      // Detect transition: user just clicked into the video player
      if (isIframeActive && !lastActiveWasIframe) {
        // Skip if video is already playing (time is advancing)
        if (!video.paused && video.currentTime > start + 0.5) {
          lastActiveWasIframe = isIframeActive;
          return;
        }

        // User clicked into iframe, likely to play - start monitoring
        if (playCheckTimeoutRef.current) {
          clearTimeout(playCheckTimeoutRef.current);
        }
        setShowPlaybackWarning(false);

        // Capture current time to check if it advances
        const startTime = video.currentTime;

        playCheckTimeoutRef.current = window.setTimeout(() => {
          // If currentTime hasn't advanced, video is stuck (likely VPN/bot block)
          const currentTime = video.currentTime;
          if (Math.abs(currentTime - startTime) < 0.5) {
            setShowPlaybackWarning(true);
          }
        }, 2000);
      }

      lastActiveWasIframe = isIframeActive;
    }, 200);
    const handlePause = () => {
      setIsPaused(true);
      onPauseCallback?.();
      // Clear playback check - user paused intentionally
      if (playCheckTimeoutRef.current) {
        clearTimeout(playCheckTimeoutRef.current);
      }
    };
    const handleTimeUpdate = () => {
      onTimeUpdateCallback?.(video.currentTime);
    };

    // Track volume changes from user
    const handleVolumeChange = () => {
      if (!isFadingRef.current) {
        originalVolumeRef.current = video.volume;
      }
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("volumechange", handleVolumeChange);

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("volumechange", handleVolumeChange);
      // Clear iframe focus polling interval
      if (iframeFocusCheckInterval) {
        clearInterval(iframeFocusCheckInterval);
      }
      // Clear playback check timeout on unmount
      if (playCheckTimeoutRef.current) {
        clearTimeout(playCheckTimeoutRef.current);
      }
    };
  }, [start, onPlayCallback, onPauseCallback, onTimeUpdateCallback]);

  // High-frequency polling for smooth progress and fade timing
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Skip polling entirely if in full video mode or already ended
    if (isFullVideo || fragmentEnded) return;

    const pollInterval = setInterval(() => {
      const currentTime = video.currentTime;

      // If user seeks before fragment start, snap back
      if (currentTime < start - 0.5) {
        video.currentTime = start;
        return;
      }

      // Update progress (skip while dragging to avoid fighting)
      if (!isDraggingRef.current) {
        const elapsed = Math.max(0, currentTime - start);
        setProgress(Math.min(elapsed / duration, 1));
      }

      // Clear playback warning when video actually advances past start
      if (showPlaybackWarning && currentTime > start + 0.5) {
        setShowPlaybackWarning(false);
      }

      // Start fading audio 500ms before end
      const fadeStart = end - 0.5;

      if (currentTime >= fadeStart && !isFading) {
        setIsFading(true);
      }
    }, 50);

    return () => clearInterval(pollInterval);
  }, [
    start,
    end,
    duration,
    isFullVideo,
    fragmentEnded,
    isFading,
    showPlaybackWarning,
  ]);

  // Handle fade effect separately - triggered by isFading state
  useEffect(() => {
    if (!isFading || isFullVideo || fragmentEnded) return;

    const video = videoRef.current;
    if (!video) return;

    const fadeDuration = 1000; // 1 second
    const fadeSteps = 20;
    const fadeInterval = fadeDuration / fadeSteps;
    let step = 0;

    fadeIntervalRef.current = window.setInterval(() => {
      step++;
      video.volume = originalVolumeRef.current * (1 - step / fadeSteps);

      if (step >= fadeSteps) {
        if (fadeIntervalRef.current) clearInterval(fadeIntervalRef.current);
        video.pause();
        video.volume = originalVolumeRef.current;
        setProgress(1);
        setFragmentEnded(true);
        setIsFading(false);

        if (document.fullscreenElement) {
          document.exitFullscreen();
        }
      }
    }, fadeInterval);

    return () => {
      if (fadeIntervalRef.current) {
        clearInterval(fadeIntervalRef.current);
        fadeIntervalRef.current = null;
      }
    };
  }, [isFading, isFullVideo, fragmentEnded]);

  const handleReplay = () => {
    const video = videoRef.current;
    if (video) {
      setFragmentEnded(false);
      setIsFading(false);
      setProgress(0);
      video.volume = originalVolumeRef.current;
      video.currentTime = start;
      video.play();
    }
  };

  const handleWatchFullVideo = () => {
    setIsFullVideo(true);
    setIsFading(false);
    // Resume playback if paused
    const video = videoRef.current;
    if (video && video.paused) {
      video.volume = originalVolumeRef.current;
      video.play();
    }
  };

  const handleWatchClipOnly = () => {
    setIsFullVideo(false);
    setFragmentEnded(false);
    setIsFading(false);
    setProgress(0);
    const video = videoRef.current;
    if (video) {
      video.volume = originalVolumeRef.current;
      video.currentTime = start;
      video.play();
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const seekToPosition = (clientX: number) => {
    if (!progressBarRef.current || !videoRef.current) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const clickX = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percentage = clickX / rect.width;
    const newTime = start + percentage * duration;
    videoRef.current.currentTime = newTime;
    setProgress(percentage);
    if (fragmentEnded && percentage < 1) {
      setFragmentEnded(false);
      setIsFading(false);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    setIsDragging(true);
    seekToPosition(e.clientX);
  };

  // Handle drag and release globally
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      seekToPosition(e.clientX);
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seekToPosition uses refs and state that are stable
  }, [isDragging, start, duration]);

  const showControls = isHovering || isPaused || fragmentEnded;

  return (
    <div className="flex flex-col items-center gap-4 p-4">
      {/* Playback warning - shown when video appears stuck */}
      {showPlaybackWarning && (
        <div className="w-full mb-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 flex items-center gap-2">
          <span>
            Video not playing? If YouTube is asking to "Sign in to confirm
            you're not a robot", it could be that you have a VPN enabled. Try
            disabling that and reloading the page.
          </span>
          <button
            onClick={() => setShowPlaybackWarning(false)}
            className="ml-auto text-amber-400 hover:text-amber-600"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {/* Video + progress bar container with hover detection */}
      <div
        className="w-full"
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        {/* Video with native YouTube controls */}
        <div ref={containerRef} className="w-full aspect-video relative">
          <youtube-video src={youtubeUrl} controls className="w-full h-full" />

          {/* End-of-clip overlay (only in clip mode) */}
          {fragmentEnded && !isFullVideo && (
            <div
              className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-4 z-10 animate-fade-in"
              style={{
                animation: "fadeIn 0.5s ease-out",
              }}
            >
              <p className="text-white text-lg font-medium">Clip finished</p>
              <div className="flex gap-4">
                <button
                  onClick={handleReplay}
                  className="bg-white/20 text-white px-6 py-2 rounded-lg hover:bg-white/30 border border-white/40"
                >
                  Replay
                </button>
                {!hideControls && (
                  <button
                    onClick={onEnded}
                    className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700"
                  >
                    Continue
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Custom fragment progress bar below video (hidden in full video mode) */}
        {!isFullVideo && (
          <div
            className="flex items-center gap-3 pt-3 transition-opacity duration-200"
            style={{ opacity: showControls ? 1 : 0 }}
          >
            <div
              ref={progressBarRef}
              className="flex-1 rounded cursor-pointer relative select-none"
              style={{ height: "6px", backgroundColor: "#ddd" }}
              onMouseDown={handleMouseDown}
            >
              <div
                className="h-full rounded pointer-events-none"
                style={{
                  width: `${progress * 100}%`,
                  backgroundColor: "#3b82f6",
                }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full shadow pointer-events-none bg-blue-600 border-2 border-white"
                style={{ left: `calc(${progress * 100}% - 8px)` }}
              />
            </div>
            <span className="text-sm text-gray-600 whitespace-nowrap">
              {formatTime(progress * duration)} / {formatTime(duration)}
            </span>
          </div>
        )}
      </div>

      {/* Clip info and controls */}
      {!isFullVideo ? (
        <div className="text-center text-xs text-gray-400">
          Clip from {formatTime(start)} to {formatTime(end)}
          <span className="mx-1">·</span>
          <button
            onClick={handleWatchFullVideo}
            className="text-gray-400 hover:text-gray-600 underline"
          >
            Watch full video
          </button>
        </div>
      ) : (
        <div className="text-center text-xs text-gray-400">
          Watching full video
          <span className="mx-1">·</span>
          <button
            onClick={handleWatchClipOnly}
            className="text-gray-400 hover:text-gray-600 underline"
          >
            Watch clip only
          </button>
        </div>
      )}
    </div>
  );
}
