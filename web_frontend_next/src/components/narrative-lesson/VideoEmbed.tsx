// web_frontend_next/src/components/narrative-lesson/VideoEmbed.tsx
"use client";

import VideoPlayer from "@/components/unified-lesson/VideoPlayer";

type VideoEmbedProps = {
  videoId: string;
  start: number;
  end: number;
  onEnded?: () => void;
};

/**
 * Wraps VideoPlayer at 80% width with gray card styling.
 * Reuses the existing VideoPlayer component entirely.
 */
export default function VideoEmbed({
  videoId,
  start,
  end,
  onEnded,
}: VideoEmbedProps) {
  return (
    <div className="w-[80%] max-w-[900px] mx-auto py-4">
      <div className="bg-stone-100 rounded-lg overflow-hidden shadow-sm">
        <VideoPlayer
          videoId={videoId}
          start={start}
          end={end}
          onEnded={onEnded ?? (() => {})}
        />
      </div>
    </div>
  );
}
