// src/validator/validate-frontmatter.ts
import type { ContentError } from '../index.js';
import { CONTENT_SCHEMAS } from '../content-schema.js';
import { detectFrontmatterTypos } from './field-typos.js';

/**
 * Generic frontmatter validation against the schema for a content type.
 * Checks required fields (present + non-empty) and detects typos.
 *
 * Note: This does NOT handle type-specific validation like slug format
 * or id-must-be-string. Parsers still handle those themselves.
 */
export function validateFrontmatter(
  frontmatter: Record<string, unknown>,
  contentType: string,
  file: string,
): ContentError[] {
  const schema = CONTENT_SCHEMAS[contentType];
  if (!schema) return [];

  const errors: ContentError[] = [];

  // Detect typos in field names
  errors.push(...detectFrontmatterTypos(frontmatter, schema.allFields, file));

  // Check required fields
  for (const field of schema.requiredFields) {
    const value = frontmatter[field];
    if (value === undefined || value === null) {
      errors.push({
        file,
        line: 2,
        message: `Missing required field: ${field}`,
        suggestion: `Add '${field}' to frontmatter`,
        severity: 'error',
      });
    } else if (typeof value === 'string' && value.trim() === '') {
      errors.push({
        file,
        line: 2,
        message: `Field '${field}' must not be empty`,
        suggestion: `Provide a value for '${field}'`,
        severity: 'error',
      });
    }
  }

  return errors;
}
