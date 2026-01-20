// web_frontend_next/src/utils/extractHeadings.ts

export type HeadingItem = {
  id: string;
  text: string;
  level: 2 | 3;
};

/**
 * Generate a URL-safe ID from heading text.
 * Exported for use in both TOC extraction and heading rendering.
 */
export function generateHeadingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 50);
}

/**
 * Extract h2 and h3 headings from markdown content.
 * Generates stable IDs from heading text for anchor linking.
 * Handles duplicate headings by appending -1, -2, etc. suffix.
 *
 * @param markdown - Markdown content to extract headings from
 * @param seenIds - Optional shared counter map for cross-content duplicate handling
 */
export function extractHeadings(
  markdown: string,
  seenIds: Map<string, number> = new Map()
): HeadingItem[] {
  const headings: HeadingItem[] = [];
  const lines = markdown.split("\n");

  for (const line of lines) {
    // Match ## or ### at start of line
    const match = line.match(/^(#{2,3})\s+(.+)$/);
    if (match) {
      const level = match[1].length as 2 | 3;
      const text = match[2].trim();
      // Skip empty headings
      if (!text) continue;

      const baseId = generateHeadingId(text);
      const count = seenIds.get(baseId) || 0;
      const id = count > 0 ? `${baseId}-${count}` : baseId;
      seenIds.set(baseId, count + 1);

      headings.push({ id, text, level });
    }
  }

  return headings;
}

/**
 * Extract headings from multiple markdown contents with a shared counter.
 * Use this when processing multiple article excerpts that should have
 * unique IDs across all of them.
 */
export function extractAllHeadings(markdownContents: string[]): HeadingItem[] {
  const seenIds = new Map<string, number>();
  return markdownContents.flatMap((content) => extractHeadings(content, seenIds));
}
