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
 * Find all occurrences of a substring in text (case-insensitive).
 * Returns array of start indices.
 */
function findAllOccurrences(text: string, anchor: string): number[] {
  const lowerText = text.toLowerCase();
  const lowerAnchor = anchor.toLowerCase();
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
 * Extract content from an article between two anchor texts.
 *
 * @param article - The full article content
 * @param fromAnchor - Text marking the start of the excerpt (inclusive)
 * @param toAnchor - Text marking the end of the excerpt (inclusive)
 * @param file - Source file path for error reporting
 * @returns Extracted content or error
 */
export function extractArticleExcerpt(
  article: string,
  fromAnchor: string,
  toAnchor: string,
  file: string
): ArticleExcerptResult {
  // Find all occurrences of start anchor (case-insensitive)
  const fromOccurrences = findAllOccurrences(article, fromAnchor);

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

  // Search for end anchor only AFTER the start anchor (case-insensitive)
  const afterStart = article.slice(startIndex);
  const toOccurrences = findAllOccurrences(afterStart, toAnchor);

  if (toOccurrences.length === 0) {
    return {
      error: {
        file,
        message: `End anchor '${toAnchor}' not found in article after start anchor`,
        suggestion: 'Check that the anchor text exists after the start anchor',
        severity: 'error',
      },
    };
  }

  if (toOccurrences.length > 1) {
    return {
      error: {
        file,
        message: `End anchor '${toAnchor}' found multiple times (${toOccurrences.length} occurrences) after start - ambiguous`,
        suggestion: 'Use a more specific anchor text that appears only once',
        severity: 'error',
      },
    };
  }

  // Calculate absolute end index (end of the anchor text)
  const relativeToIndex = toOccurrences[0];
  const endIndex = startIndex + relativeToIndex + toAnchor.length;

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
