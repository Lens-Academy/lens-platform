// src/bundler/article.ts
import type { ContentError } from '../index.js';

export interface ArticleExcerptResult {
  content?: string;
  startIndex?: number;
  endIndex?: number;
  error?: ContentError;
}

export interface CollapsedExcerpt {
  content: string;
  collapsed_before?: string;
  collapsed_after?: string;
  error?: ContentError;
}

export interface ExcerptInput {
  from: string;
  to: string;
}

/**
 * Normalize smart/curly quotes to their straight equivalents.
 * This handles mismatches between content authored in rich text editors
 * (which produce curly quotes) and source articles (which may use straight quotes).
 */
function normalizeQuotes(text: string): string {
  return text
    .replaceAll('\u2018', "'")  // left single quote
    .replaceAll('\u2019', "'")  // right single quote (smart apostrophe)
    .replaceAll('\u201C', '"')  // left double quote
    .replaceAll('\u201D', '"'); // right double quote
}

/**
 * Find all occurrences of a substring in text (case-insensitive, quote-normalized).
 * Returns array of start indices in the ORIGINAL text.
 */
function findAllOccurrences(text: string, anchor: string): number[] {
  const lowerText = normalizeQuotes(text.toLowerCase());
  const lowerAnchor = normalizeQuotes(anchor.toLowerCase());
  const indices: number[] = [];
  let pos = 0;

  while (true) {
    const idx = lowerText.indexOf(lowerAnchor, pos);
    if (idx === -1) break;
    indices.push(idx);
    pos = idx + 1;
  }

  return indices;
}

/**
 * Strip frontmatter from article content.
 * Frontmatter is enclosed in --- markers at the start of the file.
 */
function stripFrontmatter(article: string): string {
  const match = article.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return match ? match[1].trim() : article.trim();
}

/**
 * Extract content from an article between two anchor texts.
 *
 * Both anchors are optional:
 * - Only fromAnchor → extract from anchor to end of article
 * - Only toAnchor → extract from start of article to anchor
 * - Neither → extract entire article (stripping frontmatter)
 *
 * @param article - The full article content
 * @param fromAnchor - Text marking the start of the excerpt (inclusive), undefined means start
 * @param toAnchor - Text marking the end of the excerpt (inclusive), undefined means end
 * @param file - Source file path for error reporting
 * @returns Extracted content or error
 */
export function extractArticleExcerpt(
  article: string,
  fromAnchor: string | undefined,
  toAnchor: string | undefined,
  file: string
): ArticleExcerptResult {
  // If no anchors, return entire article (strip frontmatter)
  if (!fromAnchor && !toAnchor) {
    const content = stripFrontmatter(article);
    return {
      content,
      startIndex: 0,
      endIndex: article.length,
    };
  }

  // Get article body (strip frontmatter) for extraction
  const body = stripFrontmatter(article);

  // If only toAnchor, extract from start to anchor
  if (!fromAnchor && toAnchor) {
    const toOccurrences = findAllOccurrences(body, toAnchor);

    if (toOccurrences.length === 0) {
      return {
        error: {
          file,
          message: `End anchor '${toAnchor}' not found in article`,
          suggestion: 'Check that the anchor text exists exactly in the article',
          severity: 'error',
        },
      };
    }

    if (toOccurrences.length > 1) {
      return {
        error: {
          file,
          message: `End anchor '${toAnchor}' found multiple times (${toOccurrences.length} occurrences) - ambiguous`,
          suggestion: 'Use a more specific anchor text that appears only once',
          severity: 'error',
        },
      };
    }

    const endIndex = toOccurrences[0] + toAnchor.length;
    const content = body.slice(0, endIndex);

    return {
      content,
      startIndex: 0,
      endIndex,
    };
  }

  // If only fromAnchor, extract from anchor to end
  if (fromAnchor && !toAnchor) {
    const fromOccurrences = findAllOccurrences(body, fromAnchor);

    if (fromOccurrences.length === 0) {
      return {
        error: {
          file,
          message: `Start anchor '${fromAnchor}' not found in article`,
          suggestion: 'Check that the anchor text exists exactly in the article',
          severity: 'error',
        },
      };
    }

    if (fromOccurrences.length > 1) {
      return {
        error: {
          file,
          message: `Start anchor '${fromAnchor}' found multiple times (${fromOccurrences.length} occurrences) - ambiguous`,
          suggestion: 'Use a more specific anchor text that appears only once',
          severity: 'error',
        },
      };
    }

    const startIndex = fromOccurrences[0];
    const content = body.slice(startIndex);

    return {
      content,
      startIndex,
      endIndex: body.length,
    };
  }

  // Both anchors provided - find content between them
  // At this point we know both fromAnchor and toAnchor are defined (not undefined)
  const fromAnchorStr = fromAnchor as string;
  const toAnchorStr = toAnchor as string;

  const fromOccurrences = findAllOccurrences(article, fromAnchorStr);

  if (fromOccurrences.length === 0) {
    return {
      error: {
        file,
        message: `Start anchor '${fromAnchorStr}' not found in article`,
        suggestion: 'Check that the anchor text exists exactly in the article',
        severity: 'error',
      },
    };
  }

  if (fromOccurrences.length > 1) {
    return {
      error: {
        file,
        message: `Start anchor '${fromAnchorStr}' found multiple times (${fromOccurrences.length} occurrences) - ambiguous`,
        suggestion: 'Use a more specific anchor text that appears only once',
        severity: 'error',
      },
    };
  }

  const startIndex = fromOccurrences[0];

  // Search for end anchor only AFTER the start anchor (case-insensitive)
  const afterStart = article.slice(startIndex);
  const toOccurrences = findAllOccurrences(afterStart, toAnchorStr);

  if (toOccurrences.length === 0) {
    return {
      error: {
        file,
        message: `End anchor '${toAnchorStr}' not found in article after start anchor`,
        suggestion: 'Check that the anchor text exists after the start anchor',
        severity: 'error',
      },
    };
  }

  if (toOccurrences.length > 1) {
    return {
      error: {
        file,
        message: `End anchor '${toAnchorStr}' found multiple times (${toOccurrences.length} occurrences) after start - ambiguous`,
        suggestion: 'Use a more specific anchor text that appears only once',
        severity: 'error',
      },
    };
  }

  // Calculate absolute end index (end of the anchor text)
  const relativeToIndex = toOccurrences[0];
  const endIndex = startIndex + relativeToIndex + toAnchorStr.length;

  // Extract the content between (and including) the anchors
  const content = article.slice(startIndex, endIndex);

  return {
    content,
    startIndex,
    endIndex,
  };
}

/**
 * Bundle multiple excerpts from an article with collapsed content information.
 *
 * @param article - The full article content
 * @param excerpts - Array of excerpt specifications { from, to }
 * @param file - Source file path for error reporting
 * @returns Array of excerpts with collapsed_before/collapsed_after fields
 */
export function bundleArticleWithCollapsed(
  article: string,
  excerpts: ExcerptInput[],
  file: string
): CollapsedExcerpt[] {
  // First, extract all excerpts and their positions
  const extractedExcerpts: Array<{
    content: string;
    startIndex: number;
    endIndex: number;
    error?: ContentError;
  }> = [];

  for (const excerpt of excerpts) {
    const result = extractArticleExcerpt(article, excerpt.from, excerpt.to, file);

    if (result.error) {
      extractedExcerpts.push({
        content: '',
        startIndex: -1,
        endIndex: -1,
        error: result.error,
      });
    } else {
      extractedExcerpts.push({
        content: result.content!,
        startIndex: result.startIndex!,
        endIndex: result.endIndex!,
      });
    }
  }

  // Build the result with collapsed content
  const results: CollapsedExcerpt[] = [];

  for (let i = 0; i < extractedExcerpts.length; i++) {
    const extracted = extractedExcerpts[i];

    if (extracted.error) {
      results.push({
        content: '',
        error: extracted.error,
      });
      continue;
    }

    const result: CollapsedExcerpt = {
      content: extracted.content,
    };

    // Calculate collapsed_before (content between previous excerpt end and this excerpt start)
    if (i > 0) {
      const prevExcerpt = extractedExcerpts[i - 1];
      if (!prevExcerpt.error && prevExcerpt.endIndex < extracted.startIndex) {
        const collapsedBefore = article.slice(prevExcerpt.endIndex, extracted.startIndex).trim();
        if (collapsedBefore.length > 0) {
          result.collapsed_before = collapsedBefore;
        }
      }
    }

    // Calculate collapsed_after (content after this excerpt to next excerpt or end)
    // Only set for the last excerpt
    if (i === extractedExcerpts.length - 1) {
      const collapsedAfter = article.slice(extracted.endIndex).trim();
      if (collapsedAfter.length > 0) {
        result.collapsed_after = collapsedAfter;
      }
    }

    results.push(result);
  }

  return results;
}
