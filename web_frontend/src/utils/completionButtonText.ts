// web_frontend/src/utils/completionButtonText.ts
import type { ModuleSection } from "@/types/module";

/**
 * Get total text character count for a section.
 * Used to determine if a section is "short" for button text purposes.
 */
export function getSectionTextLength(section: ModuleSection): number {
  if (section.type === "test") {
    return 0;
  }
  // Lens sections: count text + article content
  const segments = section.segments ?? [];
  const textLength = segments
    .filter((s): s is { type: "text"; content: string } => s.type === "text")
    .reduce((acc, s) => acc + s.content.length, 0);
  const articleLength = segments
    .filter((s) => s.type === "article")
    .reduce(
      (acc, s) => acc + ("content" in s ? (s.content as string).length : 0),
      0,
    );
  const videoLength = segments.some((s) => s.type === "video") ? Infinity : 0;
  return textLength + articleLength + videoLength;
}

/**
 * Determine completion button text based on section type and length.
 * Short text/page sections get friendlier text like "Get started" or "Continue".
 */
export function getCompletionButtonText(
  section: ModuleSection,
  sectionIndex: number,
): string {
  if (section.type === "test") return "";

  // If section has article or video segments, it's substantial content
  const hasArticleOrVideo = section.segments?.some(
    (s) => s.type === "article" || s.type === "video",
  );
  if (hasArticleOrVideo) return "Mark section complete";

  const isShort = getSectionTextLength(section) < 1750;
  if (!isShort) return "Mark section complete";

  if (hasChatSegment(section)) return "Continue";
  return sectionIndex === 0 ? "Get started" : "Continue";
}

function hasChatSegment(section: ModuleSection): boolean {
  if (section.type === "lens") {
    return section.segments?.some((s) => s.type === "chat") ?? false;
  }
  return false;
}
