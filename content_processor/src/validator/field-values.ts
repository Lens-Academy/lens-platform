// src/validator/field-values.ts
import type { ContentError } from '../index.js';

/**
 * Fields that should only contain boolean values ('true' or 'false').
 */
const BOOLEAN_FIELDS = new Set([
  'optional',
  'hidePreviousContentFromUser',
  'hidePreviousContentFromTutor',
]);

/**
 * Validate field values, checking for appropriate types.
 * Currently validates that boolean fields contain 'true' or 'false'.
 *
 * @param fields - Object mapping field names to their values
 * @param file - File path for error reporting
 * @param line - Line number for error reporting
 * @returns Array of warning ContentError objects for invalid values
 */
export function validateFieldValues(
  fields: Record<string, string>,
  file: string,
  line: number
): ContentError[] {
  const warnings: ContentError[] = [];

  for (const [name, value] of Object.entries(fields)) {
    // Check if this is a boolean field
    if (BOOLEAN_FIELDS.has(name)) {
      const normalizedValue = value.toLowerCase();
      if (normalizedValue !== 'true' && normalizedValue !== 'false') {
        warnings.push({
          file,
          line,
          message: `Field '${name}' has non-boolean value '${value}'`,
          suggestion: "Expected 'true' or 'false'",
          severity: 'warning',
        });
      }
    }
  }

  return warnings;
}
