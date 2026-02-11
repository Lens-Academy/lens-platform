// src/parser/video-transcript.ts
import type { ContentError } from '../index.js';
import { parseFrontmatter } from './frontmatter.js';
import { validateFrontmatter } from '../validator/validate-frontmatter.js';

export interface ParsedVideoTranscript {
  title: string;
  channel: string;
  url: string;
}

export interface VideoTranscriptParseResult {
  transcript: ParsedVideoTranscript | null;
  errors: ContentError[];
}

export function parseVideoTranscript(content: string, file: string): VideoTranscriptParseResult {
  const errors: ContentError[] = [];

  const frontmatterResult = parseFrontmatter(content, file);
  if (frontmatterResult.error) {
    errors.push(frontmatterResult.error);
    return { transcript: null, errors };
  }

  const { frontmatter } = frontmatterResult;

  // Validate frontmatter against schema (typo detection + required fields)
  const frontmatterErrors = validateFrontmatter(frontmatter, 'video-transcript', file);
  errors.push(...frontmatterErrors);

  const hasRequiredError = frontmatterErrors.some(e => e.severity === 'error');
  if (hasRequiredError) {
    return { transcript: null, errors };
  }

  // Check text fields for wikilinks (not url — that's a URL)
  const textFields = ['title', 'channel'] as const;
  for (const field of textFields) {
    const value = String(frontmatter[field]);
    if (/\[\[.+?\]\]/.test(value)) {
      errors.push({
        file,
        line: 2,
        message: `Field '${field}' contains a wikilink — use plain text`,
        suggestion: `Remove [[...]] from '${field}'`,
        severity: 'error',
      });
    }
  }

  const transcript: ParsedVideoTranscript = {
    title: String(frontmatter.title),
    channel: String(frontmatter.channel),
    url: String(frontmatter.url),
  };

  return { transcript, errors };
}
