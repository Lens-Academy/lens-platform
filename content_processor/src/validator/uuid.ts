// src/validator/uuid.ts
import type { ContentError } from '../index.js';

/**
 * UUID v4 format regex: 8-4-4-4-12 hex characters
 * e.g., 550e8400-e29b-41d4-a716-446655440000
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate that a string is a valid UUID format.
 */
export function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export interface UuidEntry {
  uuid: string;
  file: string;
  field: string; // 'contentId', 'id', etc.
}

export interface UuidValidationResult {
  errors: ContentError[];
}

/**
 * Validate a collection of UUIDs for format and uniqueness.
 */
export function validateUuids(entries: UuidEntry[]): UuidValidationResult {
  const errors: ContentError[] = [];
  const seenUuids = new Map<string, UuidEntry>(); // uuid -> first occurrence

  for (const entry of entries) {
    const lowerUuid = entry.uuid.toLowerCase();

    // Format validation
    if (!isValidUuid(entry.uuid)) {
      errors.push({
        file: entry.file,
        message: `Invalid UUID format for ${entry.field}: '${entry.uuid}'`,
        suggestion: 'UUID must be in format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (8-4-4-4-12 hex characters)',
        severity: 'error',
      });
      continue; // Skip duplicate check for invalid UUIDs
    }

    // Duplicate detection
    const existing = seenUuids.get(lowerUuid);
    if (existing) {
      // Allow same-file, same-field duplicates (e.g., contentId shared across submodule groups)
      if (existing.file !== entry.file || existing.field !== entry.field) {
        errors.push({
          file: entry.file,
          message: `Duplicate UUID '${entry.uuid}' - also used in ${existing.file} (${existing.field})`,
          suggestion: 'Each UUID must be unique across the entire vault',
          severity: 'error',
        });
      }
    } else {
      seenUuids.set(lowerUuid, entry);
    }
  }

  return { errors };
}
