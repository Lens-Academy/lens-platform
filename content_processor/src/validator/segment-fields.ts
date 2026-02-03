// src/validator/segment-fields.ts
import type { ContentError } from '../index.js';

/**
 * Define which fields are valid for each segment type.
 * This allows us to warn when a field appears in the wrong segment type.
 */
const VALID_FIELDS_BY_SEGMENT_TYPE: Record<string, Set<string>> = {
  text: new Set(['content', 'optional']),
  chat: new Set([
    'instructions',
    'optional',
    'hidePreviousContentFromUser',
    'hidePreviousContentFromTutor',
  ]),
  'article-excerpt': new Set(['from', 'to', 'optional']),
  'video-excerpt': new Set(['from', 'to', 'optional']),
};

/**
 * Fields that are specific to excerpt segments (not valid in text/chat).
 */
const EXCERPT_ONLY_FIELDS = new Set(['from', 'to']);

/**
 * Validate that fields are appropriate for the segment type.
 * Warns about fields that belong to different segment types.
 *
 * @param segmentType - The type of segment (text, chat, article-excerpt, video-excerpt)
 * @param fields - Object mapping field names to their values
 * @param file - File path for error reporting
 * @param line - Line number for error reporting
 * @returns Array of warning ContentError objects for misplaced fields
 */
export function validateSegmentFields(
  segmentType: string,
  fields: Record<string, string>,
  file: string,
  line: number
): ContentError[] {
  const warnings: ContentError[] = [];
  const validFields = VALID_FIELDS_BY_SEGMENT_TYPE[segmentType];

  if (!validFields) {
    // Unknown segment type - validation handled elsewhere
    return warnings;
  }

  for (const fieldName of Object.keys(fields)) {
    if (!validFields.has(fieldName)) {
      // Check if this is a field that belongs to a different segment type
      if (EXCERPT_ONLY_FIELDS.has(fieldName)) {
        warnings.push({
          file,
          line,
          message: `Field '${fieldName}' is not valid in ${segmentType} segment`,
          suggestion: `'${fieldName}' is only valid in article-excerpt or video-excerpt segments`,
          severity: 'warning',
        });
      }
      // Note: We don't warn about completely unknown fields here
      // That's handled by field-typos.ts
    }
  }

  return warnings;
}
