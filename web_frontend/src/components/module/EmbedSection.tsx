import React, { useEffect, useRef, useState } from "react";
import type { EmbedSegment } from "../../types/module";

interface EmbedSectionProps {
  segment: EmbedSegment;
  onActivity?: () => void;
}

export function EmbedSection({ segment, onActivity }: EmbedSectionProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    // Focus polling is the most reliable way to track interaction inside an iframe
    // as it bypasses the "bubbling" issues where iframe clicks are swallowed.
    const pollInterval = setInterval(() => {
      const isIframeFocused = document.activeElement === iframeRef.current;
      
      if (isIframeFocused && !isActive) {
        setIsActive(true);
        console.log("💓 [Heartbeat] Interaction detected in Embed:", segment.url);
        onActivity?.();
      } else if (!isIframeFocused && isActive) {
        setIsActive(false);
      }

      // If already active and still focused, continue pinging activity
      if (isIframeFocused) {
        onActivity?.();
      }
    }, 3000); // Poll every 3 seconds

    return () => clearInterval(pollInterval);
  }, [onActivity, isActive, segment.url]);

  const style: React.CSSProperties = {
    height: segment.height || "600px",
    width: segment.width || "100%",
    aspectRatio: segment.aspectRatio || "auto",
  };

  return (
    <div className="w-full flex justify-center my-8 group">
      <div
        ref={wrapperRef}
        className={`relative rounded-xl overflow-hidden border transition-all duration-300 ${
          isActive 
            ? "border-slate-300 shadow-2xl scale-[1.002]" 
            : "border-slate-200 shadow-sm group-hover:border-slate-300"
        }`}
        style={style}
      >
        {/* Premium Focus Indicator */}
        <div className={`absolute top-3 right-3 z-10 px-2 py-1 bg-white/90 backdrop-blur-sm border border-slate-200 rounded-md text-[10px] font-bold uppercase tracking-wider text-slate-500 transition-opacity duration-300 pointer-events-none ${
          isActive ? "opacity-100" : "opacity-0"
        }`}>
          Interactive Mode Active
        </div>

        <iframe
          ref={iframeRef}
          src={segment.url}
          className="w-full h-full border-none"
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          sandbox={segment.sandbox || undefined}
          title="Embedded content"
        />
      </div>
    </div>
  );
}
