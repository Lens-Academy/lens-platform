// src/validator/duplicates.ts
import type { ContentError } from '../index.js';

export interface SlugEntry {
  slug: string;
  file: string;
}

/**
 * Detect duplicate slugs across module entries.
 * Returns an error for each occurrence after the first.
 *
 * @param entries - Array of slug entries to check for duplicates
 * @returns Array of ContentError objects for duplicate slugs
 */
export function detectDuplicateSlugs(entries: SlugEntry[]): ContentError[] {
  const errors: ContentError[] = [];
  const seenSlugs = new Map<string, string>(); // slug -> first occurrence file

  for (const entry of entries) {
    const existing = seenSlugs.get(entry.slug);

    if (existing) {
      errors.push({
        file: entry.file,
        message: `Duplicate slug '${entry.slug}' - also defined in ${existing}`,
        suggestion: `Each module must have a unique slug. The slug '${entry.slug}' is already used in ${existing}`,
        severity: 'error',
      });
    } else {
      seenSlugs.set(entry.slug, entry.file);
    }
  }

  return errors;
}
