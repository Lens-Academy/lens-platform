// src/parser/video-transcript.ts
import type { ContentError } from '../index.js';
import { parseFrontmatter } from './frontmatter.js';
import { detectFrontmatterTypos } from '../validator/field-typos.js';

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

  // Check for frontmatter field typos
  const VALID_VT_FIELDS = ['title', 'channel', 'url'];
  errors.push(...detectFrontmatterTypos(frontmatter, VALID_VT_FIELDS, file));

  // Validate required fields
  const requiredFields = ['title', 'channel', 'url'] as const;
  let hasRequiredError = false;

  for (const field of requiredFields) {
    const value = frontmatter[field];
    if (value === undefined || value === null) {
      errors.push({
        file,
        line: 2,
        message: `Missing required field: ${field}`,
        suggestion: `Add '${field}' to frontmatter`,
        severity: 'error',
      });
      hasRequiredError = true;
    } else if (typeof value === 'string' && value.trim() === '') {
      errors.push({
        file,
        line: 2,
        message: `Field '${field}' must not be empty`,
        suggestion: `Provide a value for '${field}'`,
        severity: 'error',
      });
      hasRequiredError = true;
    }
  }

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
