// web_frontend/src/utils/sectionSlug.ts
import type { ModuleSection } from "@/types/module";
import { generateHeadingId } from "./extractHeadings";

/**
 * Get a URL-safe slug for a module section.
 * Uses the section title if available, falls back to "section-N".
 */
export function getSectionSlug(section: ModuleSection, index: number): string {
  let title: string | null = null;

  switch (section.type) {
    case "lens-article":
    case "lens-video":
      title = section.meta?.title ?? null;
      break;
    case "page":
      title = section.meta?.title ?? null;
      break;
    case "article":
    case "video":
      title = section.meta?.title ?? null;
      break;
    case "chat":
      title = section.meta?.title ?? null;
      break;
    case "text":
      // Text sections don't have titles
      title = null;
      break;
  }

  if (title && title.trim()) {
    return generateHeadingId(title);
  }

  // Fallback: section-1, section-2, etc. (1-indexed for human readability)
  return `section-${index + 1}`;
}

/**
 * Find section index by slug.
 * Returns -1 if not found.
 */
export function findSectionBySlug(
  sections: ModuleSection[],
  slug: string
): number {
  return sections.findIndex(
    (section, index) => getSectionSlug(section, index) === slug
  );
}
