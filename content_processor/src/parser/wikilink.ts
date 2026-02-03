// src/parser/wikilink.ts
import { join, dirname, normalize } from 'path';

export interface WikilinkParts {
  path: string;
  display?: string;
  isEmbed?: boolean;  // true for ![[embed]] syntax
}

// Matches [[path]], [[path|display]], ![[embed]], ![[embed|display]]
const WIKILINK_PATTERN = /^!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/;

export function parseWikilink(text: string): WikilinkParts | null {
  const match = text.match(WIKILINK_PATTERN);
  if (!match) return null;

  return {
    path: match[1].trim(),
    display: match[2]?.trim(),
    isEmbed: text.startsWith('!'),
  };
}

export function resolveWikilinkPath(linkPath: string, sourceFile: string): string {
  // Use Node's path module - normalize handles .. and . segments
  return normalize(join(dirname(sourceFile), linkPath)).replace(/\\/g, '/');
}
