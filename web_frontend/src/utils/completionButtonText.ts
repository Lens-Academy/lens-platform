// web_frontend/src/utils/completionButtonText.ts
import type { ModuleSection } from "@/types/module";

/**
 * Get total text character count for a section.
 * Used to determine if a section is "short" for button text purposes.
 */
export function getSectionTextLength(section: ModuleSection): number {
  if (section.type === "text") {
    return section.content.length;
  }
  if (section.type === "page") {
    return (
      section.segments
        ?.filter((s): s is { type: "text"; content: string } => s.type === "text")
        .reduce((acc, s) => acc + s.content.length, 0) ?? 0
    );
  }
  // Video/article sections have embedded content - not considered "short"
  return Infinity;
}

/**
 * Determine completion button text based on section type and length.
 * Short text/page sections get friendlier text like "Get started" or "Continue".
 */
export function getCompletionButtonText(
  section: ModuleSection,
  sectionIndex: number,
): string {
  const isTextOrPage = section.type === "text" || section.type === "page";
  if (!isTextOrPage) return "Mark section complete";

  const isShort = getSectionTextLength(section) < 1500;
  if (!isShort) return "Mark section complete";

  return sectionIndex === 0 ? "Get started" : "Continue";
}
