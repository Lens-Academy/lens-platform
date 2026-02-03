// src/parser/sections.ts
import type { ContentError } from '../index.js';

export interface ParsedSection {
  type: string;
  title: string;
  rawType: string;
  fields: Record<string, string>;
  body: string;
  line: number;
}

export interface SectionsResult {
  sections: ParsedSection[];
  errors: ContentError[];
}

// Valid section types per file type (exported for use by other parsers)
export const MODULE_SECTION_TYPES = new Set(['learning outcome', 'page', 'uncategorized']);
export const LO_SECTION_TYPES = new Set(['lens', 'test']);
// Lens sections: input headers are `### Article:`, `### Video:`, `### Text:`
// Output types are `lens-article`, `lens-video`, `text` (v2 format)
export const LENS_SECTION_TYPES = new Set(['text', 'article', 'video']);

// Map input section names to output types for Lens files
export const LENS_OUTPUT_TYPE: Record<string, string> = {
  'text': 'text',
  'article': 'lens-article',
  'video': 'lens-video',
};

// Header pattern is parameterized by level (1-4)
function makeSectionPattern(level: number): RegExp {
  const hashes = '#'.repeat(level);
  // Match: ^#{level} <type>: <title>$
  // Captures: group 1 = type, group 2 = title
  return new RegExp(`^${hashes}\\s+([^:]+):\\s*(.*)$`, 'i');
}

export function parseSections(
  content: string,
  headerLevel: 1 | 2 | 3 | 4,
  validTypes: Set<string>,
  file: string = ''
): SectionsResult {
  const SECTION_HEADER_PATTERN = makeSectionPattern(headerLevel);
  const lines = content.split('\n');
  const sections: ParsedSection[] = [];
  const errors: ContentError[] = [];

  let currentSection: ParsedSection | null = null;
  let currentBody: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    const headerMatch = line.match(SECTION_HEADER_PATTERN);

    if (headerMatch) {
      // Save previous section
      if (currentSection) {
        currentSection.body = currentBody.join('\n');
        parseFields(currentSection);
        sections.push(currentSection);
      }

      const rawType = headerMatch[1].trim();
      const normalizedType = rawType.toLowerCase();
      const title = headerMatch[2].trim();

      if (!validTypes.has(normalizedType)) {
        errors.push({
          file,
          line: lineNum,
          message: `Unknown section type: ${rawType}`,
          suggestion: `Valid types: ${[...validTypes].join(', ')}`,
          severity: 'error',
        });
      }

      currentSection = {
        type: normalizedType.replaceAll(' ', '-'),
        title,
        rawType,
        fields: {},
        body: '',
        line: lineNum,
      };
      currentBody = [];
    } else if (currentSection) {
      currentBody.push(line);
    }
  }

  // Don't forget last section
  if (currentSection) {
    currentSection.body = currentBody.join('\n');
    parseFields(currentSection);
    sections.push(currentSection);
  }

  return { sections, errors };
}

const FIELD_PATTERN = /^(\w+)::\s*(.*)$/;

function parseFields(section: ParsedSection): void {
  for (const line of section.body.split('\n')) {
    const match = line.match(FIELD_PATTERN);
    if (match) {
      section.fields[match[1]] = match[2];
    }
  }
}
