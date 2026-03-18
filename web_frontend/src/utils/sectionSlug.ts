// web_frontend/src/utils/sectionSlug.ts
import type { ModuleSection } from "@/types/module";
import { generateHeadingId } from "./extractHeadings";

/**
 * Get a URL-safe slug for a module section.
 * Uses the section title if available, falls back to "section-N".
 */
export function getSectionSlug(section: ModuleSection, index: number): string {
  const title = section.meta?.title ?? null;

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
  slug: string,
): number {
  return sections.findIndex(
    (section, index) => getSectionSlug(section, index) === slug,
  );
}
