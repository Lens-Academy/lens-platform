import React, { useEffect, useRef, useState } from "react";
import type { EmbedSegment } from "../../types/module";

interface EmbedSectionProps {
  segment: EmbedSegment;
  onActivity?: () => void;
}

export function EmbedSection({ segment, onActivity }: EmbedSectionProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    // Blur-based focus tracking
    const handleBlur = () => {
      // If the newly active element isn't an iframe, we might just have blurred the window.
      // Set a small timeout so document.activeElement has time to update to the iframe.
      if (document.activeElement?.tagName === "IFRAME") {
         // Verify it's OUR iframe by checking if it's inside our wrapper
         if (wrapperRef.current?.contains(document.activeElement)) {
           setIsActive(true);
           onActivity?.(); // Inform the overarching timer the user is active
         }
      }

      setTimeout(() => {
        if (
          document.activeElement && 
          document.activeElement.tagName === "IFRAME"
        ) {
          // Verify it's OUR iframe by checking if it's inside our wrapper
          if (wrapperRef.current?.contains(document.activeElement)) {
            setIsActive(true);
            onActivity?.(); // Inform the overarching timer the user is active
          }
        } else {
          setIsActive(false);
        }
      }, 0);
    };

    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, [onActivity]);

  const defaultHeight = segment.height ?? "600px";

  return (
    <div
      ref={wrapperRef}
      className={`relative w-full rounded-lg overflow-hidden border-2 transition-colors my-6 ${
        isActive ? "border-lens-orange-500 shadow-md" : "border-slate-200"
      }`}
      style={{ height: defaultHeight }}
    >
      <iframe
        src={segment.url}
        style={{ width: "100%", height: "100%", border: "none" }}
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        // By intentionally omitting sandbox="..." entirely, we let the embed run as freely as possible 
        // to support interactive SPA logic like React.
        // We only append it if specifically requested by the creator in the Obsidian frontmatter.
        sandbox={segment.sandbox ? segment.sandbox : undefined}
        title="Embedded content"
      />
    </div>
  );
}
