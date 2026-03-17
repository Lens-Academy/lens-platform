import { useEffect, useRef, useState } from "react";
import "youtube-video-element";

type VideoPlayerProps = {
  videoId: string;
  start: number;
  end: number | null; // null = play to end of video (no clip mode)
  /** Auto-play video when loaded (passed to youtube-video element) */
  autoplay?: boolean;
  /** Activity tracking callbacks */
  onPlay?: () => void;
  onPause?: () => void;
  onTimeUpdate?: (currentTime: number) => void;
  onComplete?: () => void;
  /** Theater mode: allow video to shrink within flex container */
  theater?: boolean;
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
          playsinline?: boolean;
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
  autoplay = false,
  onPlay: onPlayCallback,
  onPause: onPauseCallback,
  onTimeUpdate: onTimeUpdateCallback,
  onComplete: onCompleteCallback,
  theater = false,
}: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const originalVolumeRef = useRef(1);
  const isDraggingRef = useRef(false);
  const isFadingRef = useRef(false); // Mirror of isFading for event callbacks
  const fadeIntervalRef = useRef<number | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);

  const [progress, setProgress] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [fragmentEnded, setFragmentEnded] = useState(false);
  const [isFading, setIsFading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  // When end is null, we're in full video mode (no clipping)
  const [isFullVideo, setIsFullVideo] = useState(end === null);

  // Track if this is a clip (has explicit end time)
  const isClip = end !== null;

  // Keep ref in sync with state for event callbacks
  useEffect(() => {
    isFadingRef.current = isFading;
  }, [isFading]);

  // Duration is only meaningful for clips (when end is specified)
  const duration = isClip ? end - start : 0;
  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}&t=${start}`;

  // Get video element reference from container (scoped query, not global)
  useEffect(() => {
    if (!containerRef.current) return;

    const video = containerRef.current.querySelector(
      "youtube-video",
    ) as HTMLVideoElement | null;
    if (!video) return;

    videoRef.current = video;

    const handleLoadedMetadata = () => {
      // Start time is handled by &t= in the URL
      // Don't seek here - it would pause the video that YouTube auto-started
    };

    const handlePlay = () => {
      onPlayCallback?.();
    };
    const handlePause = () => {
      onPauseCallback?.();
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

    const handleEnded = () => {
      onCompleteCallback?.();
    };

    // Auto-rotate to landscape on fullscreen (Android)
    const handleFullscreenChange = () => {
      if (document.fullscreenElement) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- lock() exists on Android but not in TS lib types
        (screen.orientation as any)?.lock?.("landscape").catch(() => {});
      }
      // orientation lock auto-releases on fullscreen exit
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("volumechange", handleVolumeChange);
    video.addEventListener("ended", handleEnded);
    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("volumechange", handleVolumeChange);
      video.removeEventListener("ended", handleEnded);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [start, onPlayCallback, onPauseCallback, onTimeUpdateCallback, onCompleteCallback]);

  // High-frequency polling for smooth progress and fade timing
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Skip polling entirely if in full video mode, no clip end, or already ended
    if (isFullVideo || fragmentEnded || !isClip) return;

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

      // Start fading audio 500ms before end (or immediately if seeked past end)
      // Only check if we're past the start point (guards against incorrect
      // currentTime values during initial seek)
      // Note: end is guaranteed non-null here due to isClip check above
      const fadeStart = (end as number) - 0.5;

      if (currentTime >= start && currentTime >= fadeStart && !isFading) {
        setIsFading(true);
      }
    }, 50);

    return () => clearInterval(pollInterval);
  }, [start, end, duration, isFullVideo, fragmentEnded, isFading, isClip]);

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
        onCompleteCallback?.();

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
  }, [isFading, isFullVideo, fragmentEnded, onCompleteCallback]);

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
    const video = videoRef.current;
    if (video) {
      video.volume = originalVolumeRef.current;
      const inRange = end !== null && video.currentTime >= start && video.currentTime < end;
      if (inRange) {
        const elapsed = video.currentTime - start;
        setProgress(elapsed / duration);
      } else {
        setProgress(0);
        video.currentTime = start;
      }
      video.play();
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const wasPlayingRef = useRef(false);
  const lastSeekTimeRef = useRef(0);

  const getPercentageFromX = (clientX: number) => {
    if (!progressBarRef.current) return null;
    const rect = progressBarRef.current.getBoundingClientRect();
    const clickX = Math.max(0, Math.min(clientX - rect.left, rect.width));
    return clickX / rect.width;
  };

  const seekToPercentage = (percentage: number) => {
    if (!videoRef.current) return;
    const newTime = start + percentage * duration;
    videoRef.current.currentTime = newTime;
    setProgress(percentage);
    if (fragmentEnded && percentage < 1) {
      setFragmentEnded(false);
      setIsFading(false);
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    const pct = getPercentageFromX(e.clientX);
    if (pct === null) return;
    // Pause video for responsive scrubbing (like YouTube's native bar)
    const video = videoRef.current;
    wasPlayingRef.current = video ? !video.paused : false;
    video?.pause();
    isDraggingRef.current = true;
    setIsDragging(true);
    seekToPercentage(pct);
  };

  // Handle drag and release globally
  useEffect(() => {
    if (!isDragging) return;

    const handlePointerMove = (e: PointerEvent) => {
      const pct = getPercentageFromX(e.clientX);
      if (pct === null) return;
      setProgress(pct);
      // Throttle actual seeks to ~100ms so the player can keep up
      const now = Date.now();
      if (now - lastSeekTimeRef.current > 100) {
        lastSeekTimeRef.current = now;
        const newTime = start + pct * duration;
        if (videoRef.current) videoRef.current.currentTime = newTime;
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      const pct = getPercentageFromX(e.clientX);
      if (pct !== null) seekToPercentage(pct);
      isDraggingRef.current = false;
      setIsDragging(false);
      // Resume playback if it was playing before drag
      if (wasPlayingRef.current) videoRef.current?.play();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- uses refs and state that are stable
  }, [isDragging, start, duration]);

  // Detect touch-primary device (mobile/tablet)
  useEffect(() => {
    setIsMobile(window.matchMedia("(pointer: coarse)").matches);
  }, []);

  const showControls = isMobile || isHovering || fragmentEnded;

  // In theater mode, measure the hover wrapper and compute the largest 16:9
  // rect that fits both its width and height (minus space for controls).
  const hoverRef = useRef<HTMLDivElement>(null);
  const [theaterSize, setTheaterSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    if (!theater || !hoverRef.current) {
      setTheaterSize(null);
      return;
    }
    const el = hoverRef.current;
    const observer = new ResizeObserver(([entry]) => {
      const { width: aw, height: ah } = entry.contentRect;
      const videoH = ah;
      // Largest 16:9 rect fitting aw x videoH
      let w = aw;
      let h = w * 9 / 16;
      if (h > videoH) {
        h = videoH;
        w = h * 16 / 9;
      }
      setTheaterSize({ w: Math.floor(w), h: Math.floor(h) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [theater]);

  return (
    <div className={`flex flex-col items-center gap-3 ${theater ? "flex-1 min-h-0 justify-center" : ""}`}>
      {/* Video + progress bar container with hover detection */}
      <div
        ref={hoverRef}
        className={`w-full ${theater ? "flex-1 min-h-0 flex flex-col items-center justify-center" : ""}`}
      >
        {/* Video with native YouTube controls */}
        <div
          ref={containerRef}
          className={`relative rounded-xl overflow-hidden ${theater ? "" : "w-full aspect-video"}`}
          onMouseEnter={() => setIsHovering(true)}
          onMouseLeave={() => setIsHovering(false)}
          style={
            theater && theaterSize
              ? { width: theaterSize.w, height: theaterSize.h }
              : undefined
          }
        >
          <youtube-video
            src={youtubeUrl}
            controls
            autoplay={autoplay}
            playsinline
            className="w-full h-full"
          />

          {/* End-of-clip overlay (only in clip mode) */}
          {fragmentEnded && !isFullVideo && (
            <div
              className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-4 z-10 animate-fade-in"
              style={{
                animation: "fadeIn 0.5s ease-out",
              }}
            >
              <p className="text-white text-lg font-medium">Clip finished</p>
              <button
                onClick={handleReplay}
                className="bg-white/20 text-white px-6 py-2 rounded-lg hover:bg-white/30 border border-white/40"
              >
                Replay
              </button>
            </div>
          )}

          {/* Desktop-only overlays (absolute positioned inside video) */}
          {!isMobile && isClip && (
            <div
              className="absolute left-1/2 -translate-x-1/2 z-20 transition-opacity duration-200"
              style={{ bottom: 88, opacity: showControls ? 1 : 0, pointerEvents: showControls ? "auto" : "none" }}
            >
              <div className="bg-black/60 backdrop-blur-sm rounded-lg px-4 py-2 shadow-lg text-sm text-white/80 whitespace-nowrap flex items-center gap-2">
                <button
                  onClick={() => isFullVideo ? handleWatchClipOnly() : handleWatchFullVideo()}
                  className="inline-flex items-center gap-1.5 text-white/80 hover:text-white"
                >
                  <span className={!isFullVideo ? "text-white" : "text-white/40"}>Recommended Clip</span>
                  <span className="relative inline-block w-8 h-4 rounded-full bg-white/20">
                    <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all duration-200 ${isFullVideo ? "left-[18px]" : "left-0.5"}`} />
                  </span>
                  <span className={isFullVideo ? "text-white" : "text-white/40"}>Full Video</span>
                </button>
                <span className={`transition-opacity duration-200 flex items-center gap-2 ${isFullVideo ? "opacity-0 pointer-events-none" : ""}`}>
                  <span className="text-white/40">·</span>
                  {formatTime(progress * duration)} / {formatTime(duration)}
                  <span className="text-white/40">·</span>
                  Clip {formatTime(start)}–{formatTime(end as number)}
                </span>
              </div>
            </div>
          )}

          {!isMobile && isClip && !isFullVideo && (
            <div
              className="absolute left-0 right-0 px-3 transition-opacity duration-200 z-20"
              style={{ bottom: 64, opacity: showControls ? 1 : 0, pointerEvents: showControls ? "auto" : "none" }}
            >
              <div className="flex items-center gap-3">
                <div
                  ref={progressBarRef}
                  className="flex-1 rounded cursor-pointer relative select-none"
                  style={{ height: "6px", backgroundColor: "rgba(255,255,255,0.3)", touchAction: "none" }}
                  onPointerDown={handlePointerDown}
                >
                  <div
                    className="h-full rounded pointer-events-none"
                    style={{
                      width: `${progress * 100}%`,
                      backgroundColor: "var(--color-lens-gold-400)",
                    }}
                  />
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full shadow pointer-events-none border-2 border-white"
                    style={{ backgroundColor: "var(--color-lens-gold-500)", left: `calc(${progress * 100}% - 8px)` }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Mobile-only controls (below video, always visible) */}
        {isMobile && isClip && (
          <div className="flex flex-col gap-2 mt-2 w-full" style={theater && theaterSize ? { width: theaterSize.w } : undefined}>
            {!isFullVideo && (
              <div className="px-1">
                <div
                  ref={progressBarRef}
                  className="rounded cursor-pointer relative select-none"
                  style={{ height: "8px", backgroundColor: "rgba(255,255,255,0.15)", touchAction: "none" }}
                  onPointerDown={handlePointerDown}
                >
                  <div
                    className="h-full rounded pointer-events-none"
                    style={{
                      width: `${progress * 100}%`,
                      backgroundColor: "var(--color-lens-gold-400)",
                    }}
                  />
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full shadow pointer-events-none border-2 border-white"
                    style={{ backgroundColor: "var(--color-lens-gold-500)", left: `calc(${progress * 100}% - 10px)` }}
                  />
                </div>
              </div>
            )}
            <div className="flex items-center justify-center">
              <div className="text-sm text-white/60 flex items-center gap-2">
                <button
                  onClick={() => isFullVideo ? handleWatchClipOnly() : handleWatchFullVideo()}
                  className="inline-flex items-center gap-1.5 text-white/60 active:text-white"
                >
                  <span className={!isFullVideo ? "text-white" : "text-white/40"}>Recommended Clip</span>
                  <span className="relative inline-block w-8 h-4 rounded-full bg-white/20">
                    <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all duration-200 ${isFullVideo ? "left-[18px]" : "left-0.5"}`} />
                  </span>
                  <span className={isFullVideo ? "text-white" : "text-white/40"}>Full Video</span>
                </button>
                <span className={`transition-opacity duration-200 flex items-center gap-2 ${isFullVideo ? "opacity-0 pointer-events-none" : ""}`}>
                  <span className="text-white/30">·</span>
                  {formatTime(progress * duration)} / {formatTime(duration)}
                  <span className="text-white/30">·</span>
                  Clip {formatTime(start)}–{formatTime(end as number)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
