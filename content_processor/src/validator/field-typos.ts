// src/validator/field-typos.ts
import type { ContentError } from '../index.js';

/**
 * Known valid field names across all content types.
 * Used to detect likely typos via Levenshtein distance.
 */
const KNOWN_FIELDS = [
  // Common fields
  'content',
  'instructions',
  'source',
  'optional',
  'from',
  'to',
  'id',
  'slug',
  'title',
  // Article metadata
  'author',
  'sourceUrl',
  // Video metadata
  'channel',
  'url',
  // Chat segment fields
  'hidePreviousContentFromUser',
  'hidePreviousContentFromTutor',
];

/**
 * Calculate the Levenshtein (edit) distance between two strings.
 * This measures the minimum number of single-character edits
 * (insertions, deletions, substitutions) needed to change one string into another.
 */
function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];

  // Initialize first column (delete operations)
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  // Initialize first row (insert operations)
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Detect likely typos in field names by comparing against known fields.
 *
 * @param fields - Object mapping field names to their values
 * @param file - File path for error reporting
 * @param line - Line number for error reporting
 * @returns Array of warning ContentError objects for likely typos
 */
export function detectFieldTypos(
  fields: Record<string, string>,
  file: string,
  line: number
): ContentError[] {
  const warnings: ContentError[] = [];

  for (const fieldName of Object.keys(fields)) {
    // Skip if it's a known valid field (case-sensitive match)
    if (KNOWN_FIELDS.includes(fieldName)) {
      continue;
    }

    // Find the closest known field by Levenshtein distance
    let closest = '';
    let minDistance = Infinity;

    for (const known of KNOWN_FIELDS) {
      const dist = levenshtein(fieldName.toLowerCase(), known.toLowerCase());
      if (dist < minDistance && dist <= 2) {
        // Only suggest if distance <= 2 (likely typo)
        minDistance = dist;
        closest = known;
      }
    }

    // Only warn if we found a close match (likely typo)
    if (closest) {
      warnings.push({
        file,
        line,
        message: `Unrecognized field '${fieldName}'`,
        suggestion: `Did you mean '${closest}'?`,
        severity: 'warning',
      });
    }
  }

  return warnings;
}
