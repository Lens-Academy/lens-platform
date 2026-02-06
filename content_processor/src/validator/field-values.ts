// src/validator/field-values.ts
import type { ContentError } from '../index.js';

/**
 * Valid slug pattern: lowercase letters, numbers, and hyphens only.
 * Must not start or end with a hyphen.
 */
const VALID_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Validate slug format.
 *
 * Valid slugs must:
 * - Contain only lowercase letters, numbers, and hyphens
 * - Not start or end with a hyphen
 * - Not contain spaces or special characters
 *
 * @param slug - The slug value to validate
 * @param file - File path for error reporting
 * @param line - Line number for error reporting
 * @returns ContentError if invalid, null if valid
 */
export function validateSlugFormat(
  slug: string,
  file: string,
  line: number
): ContentError | null {
  // Check for uppercase letters first (more specific message)
  if (/[A-Z]/.test(slug)) {
    return {
      file,
      line,
      message: `Invalid slug format '${slug}': contains uppercase letters`,
      suggestion: `Use lowercase only. Try '${slug.toLowerCase()}'`,
      severity: 'error',
    };
  }

  // Check for leading hyphen
  if (slug.startsWith('-')) {
    return {
      file,
      line,
      message: `Invalid slug format '${slug}': cannot start with a hyphen`,
      suggestion: 'Remove the leading hyphen',
      severity: 'error',
    };
  }

  // Check for trailing hyphen
  if (slug.endsWith('-')) {
    return {
      file,
      line,
      message: `Invalid slug format '${slug}': cannot end with a hyphen`,
      suggestion: 'Remove the trailing hyphen',
      severity: 'error',
    };
  }

  // Check general pattern (lowercase, numbers, hyphens only)
  if (!VALID_SLUG_PATTERN.test(slug)) {
    return {
      file,
      line,
      message: `Invalid slug format '${slug}': must contain only lowercase letters, numbers, and hyphens`,
      suggestion: 'Use only a-z, 0-9, and hyphens (-)',
      severity: 'error',
    };
  }

  return null;
}

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
