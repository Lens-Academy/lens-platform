/**
 * Convert a filename (with optional path prefix and .md extension) to a URL slug.
 * "Lenses/Four Background Claims.md" → "four-background-claims"
 */
export function fileNameToSlug(fileName: string): string {
  // Strip directory prefix — take only the final path segment
  const base = fileName.split('/').pop() ?? fileName;
  const slug = base
    .replace(/\.md$/i, '')        // strip .md
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // remove non-alphanumeric (keep spaces and hyphens)
    .replace(/[\s-]+/g, '-')      // spaces/hyphens → single hyphen
    .replace(/^-+|-+$/g, '');     // trim leading/trailing hyphens
  return slug || 'untitled';      // guard against empty result
}
