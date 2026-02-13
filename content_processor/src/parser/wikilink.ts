// src/parser/wikilink.ts
import { join, dirname, normalize } from 'path';
import { levenshtein } from '../validator/field-typos.js';

export interface WikilinkParts {
  path: string;
  display?: string;
  isEmbed?: boolean;  // true for ![[embed]] syntax
  error?: string;     // syntax error message
  correctedPath?: string; // suggested fix for path traversal
}

// Matches [[path]], [[path|display]], ![[embed]], ![[embed|display]]
const WIKILINK_PATTERN = /^!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/;

/**
 * Check if a path contains a path traversal attack.
 *
 * We allow:
 * - Single `../` at the start for legitimate relative references (e.g., ../Lenses/foo.md)
 * - Paths with dots in filenames (e.g., file.name.with.dots.md)
 * - Single dot directories (e.g., ./relative/path)
 *
 * We block:
 * - Multiple consecutive `../` (e.g., ../../.. or ../../../etc/passwd)
 * - Windows-style `..\\` (always suspicious in markdown)
 * - `../` after a non-traversal path segment (e.g., articles/../../../secrets)
 */
function containsPathTraversal(path: string): boolean {
  // Block any Windows-style path traversal (..\ is suspicious in markdown context)
  if (path.includes('..\\')) {
    return true;
  }

  // Block multiple consecutive ../ at the start (../../ or more)
  if (/^(\.\.[/]){2,}/.test(path)) {
    return true;
  }

  // Block ../ appearing after a non-traversal path segment
  // e.g., "articles/../../../secrets" - the ../ after "articles/" is suspicious
  // This catches cases like "foo/../bar/../../../etc"
  if (/[^./][/]\.\./.test(path)) {
    return true;
  }

  return false;
}

// Patterns for detecting malformed wikilinks
const MISSING_CLOSING_PATTERN = /^!?\[\[[^\]]+\](?!\])$/;  // [[foo] but not [[foo]]
const MISSING_OPENING_PATTERN = /^(?<!!)\[(?!\[)[^\]]*\]\]$/;  // [foo]] but not [[foo]]
const EMPTY_WIKILINK_PATTERN = /^!?\[\[\s*\]\]$/;  // [[]] or ![[]] with optional whitespace

export function parseWikilink(text: string): WikilinkParts | null {
  // Check for empty wikilink first (before general pattern match)
  if (EMPTY_WIKILINK_PATTERN.test(text)) {
    return {
      path: '',
      error: 'Empty wikilink',
      isEmbed: text.startsWith('!'),
    };
  }

  // Check for missing closing bracket: [[foo] (one closing bracket, not two)
  if (MISSING_CLOSING_PATTERN.test(text)) {
    return {
      path: '',
      error: 'Missing closing bracket ]]',
      isEmbed: text.startsWith('!'),
    };
  }

  // Check for missing opening bracket: [foo]] (one opening bracket, not two)
  if (MISSING_OPENING_PATTERN.test(text)) {
    return {
      path: '',
      error: 'Missing opening bracket [[',
    };
  }

  const match = text.match(WIKILINK_PATTERN);
  if (!match) return null;

  const path = match[1].trim();

  // Check for empty path after trimming (whitespace-only content)
  if (!path) {
    return {
      path: '',
      error: 'Empty wikilink',
      isEmbed: text.startsWith('!'),
    };
  }

  // Block clearly malicious path traversal (Windows-style, mid-path escapes)
  if (path.includes('..\\') || /[^./][/]\.\./.test(path)) {
    return null;
  }

  // For multiple ../ at start: likely a mistake, suggest correction
  if (/^(\.\.[/]){2,}/.test(path)) {
    const corrected = path.replace(/^(\.\.[/])+/, '../');
    return {
      path,
      display: match[2]?.trim(),
      isEmbed: text.startsWith('!'),
      error: `Path has too many '../' segments`,
      correctedPath: corrected,
    };
  }

  return {
    path,
    display: match[2]?.trim(),
    isEmbed: text.startsWith('!'),
  };
}

export function resolveWikilinkPath(linkPath: string, sourceFile: string): string {
  // Use Node's path module - normalize handles .. and . segments
  return normalize(join(dirname(sourceFile), linkPath)).replace(/\\/g, '/');
}

/**
 * Check if a wikilink path contains a relative path indicator (slash).
 * We always expect source:: paths to be relative (e.g., ../Lenses/foo.md),
 * never just a filename (e.g., foo.md).
 */
export function hasRelativePath(path: string): boolean {
  return path.includes('/');
}

/**
 * Find a file in the files Map, trying with and without .md extension.
 * Returns the key that exists in the map, or null if not found.
 */
export function findFileWithExtension(path: string, files: Map<string, string>): string | null {
  // Try exact match first
  if (files.has(path)) {
    return path;
  }

  // Try adding .md extension
  const withMd = path + '.md';
  if (files.has(withMd)) {
    return withMd;
  }

  return null;
}

/**
 * Extract the filename (without extension) from a path.
 */
function getFilename(path: string): string {
  const parts = path.split('/');
  const filename = parts[parts.length - 1];
  return filename.replace(/\.md$/, '');
}

/**
 * Extract the directory from a path.
 */
function getDirectory(path: string): string {
  const parts = path.split('/');
  if (parts.length > 1) {
    return parts.slice(0, -1).join('/');
  }
  return '';
}

export interface SimilarFileMatch {
  path: string;
  distance: number;
}

/**
 * Check if a directory matches the expected directory.
 * Handles both exact match and nested directories (e.g., "foo/Lenses" matches "Lenses").
 */
function isInExpectedDir(fileDir: string, expectedDir: string): boolean {
  const fileDirLower = fileDir.toLowerCase();
  const expectedDirLower = expectedDir.toLowerCase();
  return fileDirLower === expectedDirLower ||
         fileDirLower.endsWith('/' + expectedDirLower) ||
         fileDirLower.startsWith(expectedDirLower + '/');
}

/**
 * Find files with similar names to the not-found path.
 *
 * @param notFoundPath - The path that was not found
 * @param files - Map of all files
 * @param expectedDir - Optional directory to filter by (e.g., "Lenses", "articles")
 *                      When provided, ONLY matches from this directory are returned.
 * @param maxDistance - Maximum Levenshtein distance to consider (default: 3)
 * @returns Array of similar file paths, sorted by relevance
 */
export function findSimilarFiles(
  notFoundPath: string,
  files: Map<string, string>,
  expectedDir?: string,
  maxDistance: number = 3
): string[] {
  const searchFilename = getFilename(notFoundPath).toLowerCase();
  const searchDir = getDirectory(notFoundPath).toLowerCase();

  const matchesInExpectedDir: SimilarFileMatch[] = [];
  const matchesInSameDir: SimilarFileMatch[] = [];
  const otherMatches: SimilarFileMatch[] = [];

  for (const filePath of files.keys()) {
    const fileFilename = getFilename(filePath).toLowerCase();
    const fileDir = getDirectory(filePath);

    // Calculate distance on filename
    const distance = levenshtein(searchFilename, fileFilename);

    if (distance <= maxDistance) {
      const match = { path: filePath, distance };

      // Categorize by directory
      if (expectedDir && isInExpectedDir(fileDir, expectedDir)) {
        matchesInExpectedDir.push(match);
      } else if (fileDir.toLowerCase() === searchDir) {
        matchesInSameDir.push(match);
      } else {
        otherMatches.push(match);
      }
    }
  }

  // Sort each category by distance
  const sortByDistance = (a: SimilarFileMatch, b: SimilarFileMatch) => a.distance - b.distance;
  matchesInExpectedDir.sort(sortByDistance);
  matchesInSameDir.sort(sortByDistance);
  otherMatches.sort(sortByDistance);

  // When expectedDir is provided, ONLY return matches from that directory
  // This prevents suggesting files from wrong directories
  if (expectedDir && matchesInExpectedDir.length > 0) {
    return matchesInExpectedDir.slice(0, 3).map(m => m.path);
  }

  // If no expected dir or no matches there, try same directory
  if (matchesInSameDir.length > 0) {
    return matchesInSameDir.slice(0, 3).map(m => m.path);
  }

  // If expectedDir was provided but no matches found, don't suggest from wrong directories
  if (expectedDir) {
    return [];
  }

  // Fallback to any matches (only when no expected directory specified)
  return otherMatches.slice(0, 3).map(m => m.path);
}

/**
 * Compute relative path from source file to target file.
 * E.g., from "Learning Outcomes/lo1.md" to "Lenses/lens.md" -> "../Lenses/lens.md"
 */
function computeRelativePath(targetPath: string, sourceFile: string): string {
  const sourceDir = dirname(sourceFile);
  const sourceParts = sourceDir ? sourceDir.split('/') : [];
  const targetParts = targetPath.split('/');

  // Find common prefix
  let commonLength = 0;
  while (
    commonLength < sourceParts.length &&
    commonLength < targetParts.length - 1 &&
    sourceParts[commonLength] === targetParts[commonLength]
  ) {
    commonLength++;
  }

  // Build relative path
  const upCount = sourceParts.length - commonLength;
  const ups = Array(upCount).fill('..');
  const remaining = targetParts.slice(commonLength);

  return [...ups, ...remaining].join('/');
}

/**
 * Format a "Did you mean...?" suggestion from similar files.
 *
 * @param similarFiles - Array of absolute paths (from vault root)
 * @param sourceFile - The file where the error occurred (to compute relative paths)
 */
export function formatSuggestion(similarFiles: string[], sourceFile: string): string | undefined {
  if (similarFiles.length === 0) {
    return undefined;
  }

  // Convert absolute paths to relative paths from source file
  const relativePaths = similarFiles.map(f => computeRelativePath(f, sourceFile));

  if (relativePaths.length === 1) {
    return `Did you mean '${relativePaths[0]}'?`;
  }

  return `Did you mean one of: ${relativePaths.map(f => `'${f}'`).join(', ')}?`;
}
