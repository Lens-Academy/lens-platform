// web_frontend_next/src/utils/extractHeadings.ts

export type HeadingItem = {
  id: string;
  text: string;
  level: number;
};

export type NormalizedHeadingItem = HeadingItem & {
  displayLevel: number;
};

/**
 * Strip inline markdown formatting from text.
 * Converts *italic*, **bold**, `code`, ~~strikethrough~~, [links](url) to plain text.
 */
function stripInlineMarkdown(text: string): string {
  return (
    text
      // Links: [text](url) → text
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Bold+italic: ***text*** or ___text___
      .replace(/\*{3}(.+?)\*{3}/g, "$1")
      .replace(/_{3}(.+?)_{3}/g, "$1")
      // Bold: **text** or __text__
      .replace(/\*{2}(.+?)\*{2}/g, "$1")
      .replace(/_{2}(.+?)_{2}/g, "$1")
      // Italic: *text* or _text_
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/_(.+?)_/g, "$1")
      // Inline code: `text`
      .replace(/`(.+?)`/g, "$1")
      // Strikethrough: ~~text~~
      .replace(/~~(.+?)~~/g, "$1")
      // Backslash escapes: \X → X
      .replace(/\\(.)/g, "$1")
  );
}

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

  for (const line of lines) {
    let level: number | null = null;
    let text: string | null = null;

    // Match markdown #, ##, or ### at start of line
    const mdMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (mdMatch) {
      level = mdMatch[1].length;
      text = stripInlineMarkdown(mdMatch[2].trim());
    }

    // Match HTML <h1>, <h2>, or <h3> tags
    if (!text) {
      const htmlMatch = line.match(/<h([123])[^>]*>([^<]+)<\/h[123]>/i);
      if (htmlMatch) {
        level = parseInt(htmlMatch[1]);
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

  return headings;
}

/**
 * Normalize heading levels using a stack-based algorithm (Obsidian-style).
 * Maps raw markdown levels to display levels so a document starting with ##
 * renders that as level 1 instead of wasting indentation levels.
 *
 * Algorithm: for each heading, pop stack entries with rawLevel >= current,
 * then displayLevel = stack.top.displayLevel + 1 (or 1 if empty).
 */
export function normalizeHeadingLevels(
  headings: HeadingItem[],
): NormalizedHeadingItem[] {
  const stack: { rawLevel: number; displayLevel: number }[] = [];

  return headings.map((heading) => {
    while (
      stack.length > 0 &&
      stack[stack.length - 1].rawLevel >= heading.level
    ) {
      stack.pop();
    }

    const displayLevel =
      stack.length > 0 ? stack[stack.length - 1].displayLevel + 1 : 1;

    stack.push({ rawLevel: heading.level, displayLevel });

    return { ...heading, displayLevel };
  });
}

/**
 * Extract headings from multiple markdown contents with a shared counter.
 * Use this when processing multiple article excerpts that should have
 * unique IDs across all of them. Returns normalized headings with displayLevel.
 */
export function extractAllHeadings(
  markdownContents: string[],
): NormalizedHeadingItem[] {
  const seenIds = new Map<string, number>();
  const headings = markdownContents.flatMap((content) =>
    extractHeadings(content, seenIds),
  );
  return normalizeHeadingLevels(headings);
}
