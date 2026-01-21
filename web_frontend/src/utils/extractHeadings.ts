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
  seenIds: Map<string, number> = new Map(),
): HeadingItem[] {
  const headings: HeadingItem[] = [];
  const lines = markdown.split("\n");

  // Debug: log the start of the content to see what we're receiving
  console.log(
    "[extractHeadings] Content preview (first 300 chars):",
    JSON.stringify(markdown.slice(0, 300)),
  );

  for (const line of lines) {
    let level: 2 | 3 | null = null;
    let text: string | null = null;

    // Match markdown ## or ### at start of line
    const mdMatch = line.match(/^(#{2,3})\s+(.+)$/);
    // Debug: log when we find a potential heading
    if (line.startsWith("##")) {
      console.log(
        "[extractHeadings] Line starts with ##:",
        JSON.stringify(line.slice(0, 60)),
        "Match:",
        !!mdMatch,
        "Level:",
        mdMatch?.[1]?.length,
      );
    }
    if (mdMatch) {
      level = mdMatch[1].length as 2 | 3;
      text = mdMatch[2].trim();
    }

    // Match HTML <h2> or <h3> tags
    if (!text) {
      const htmlMatch = line.match(/<h([23])[^>]*>([^<]+)<\/h[23]>/i);
      if (htmlMatch) {
        level = parseInt(htmlMatch[1]) as 2 | 3;
        text = htmlMatch[2].trim();
      }
    }

    // Skip if no match or empty heading
    if (!text || !level) continue;

    const baseId = generateHeadingId(text);
    const count = seenIds.get(baseId) || 0;
    const id = count > 0 ? `${baseId}-${count}` : baseId;
    seenIds.set(baseId, count + 1);

    headings.push({ id, text, level });
  }

  console.log(
    "[extractHeadings] Found",
    headings.length,
    "headings. H2:",
    headings.filter((h) => h.level === 2).length,
    "H3:",
    headings.filter((h) => h.level === 3).length,
  );
  return headings;
}

/**
 * Extract headings from multiple markdown contents with a shared counter.
 * Use this when processing multiple article excerpts that should have
 * unique IDs across all of them.
 */
export function extractAllHeadings(markdownContents: string[]): HeadingItem[] {
  const seenIds = new Map<string, number>();
  return markdownContents.flatMap((content) =>
    extractHeadings(content, seenIds),
  );
}
