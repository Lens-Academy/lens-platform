// src/parser/sections.ts
import type { ContentError } from '../index.js';
import { levenshtein } from '../validator/field-typos.js';

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
// Lens sections: input headers are `### Article:`, `### Video:`, `### Page:`
// Output types are `lens-article`, `lens-video`, `page` (v2 format)
export const LENS_SECTION_TYPES = new Set(['page', 'article', 'video']);

// All known structural header types (sections + segments) for markdown heading detection
const ALL_STRUCTURAL_TYPES = new Set([
  // Section types
  'learning outcome', 'page', 'uncategorized', 'lens', 'test', 'module', 'meeting', 'article', 'video',
  // Segment types
  'text', 'chat', 'article-excerpt', 'video-excerpt',
]);

// Fields that commonly contain markdown with headings
const MARKDOWN_CONTENT_FIELDS = new Set(['content', 'instructions']);

// Map input section names to output types for Lens files
export const LENS_OUTPUT_TYPE: Record<string, string> = {
  'page': 'page',
  'article': 'lens-article',
  'video': 'lens-video',
};

// Header pattern is parameterized by level (1-4)
function makeSectionPattern(level: number): RegExp {
  const hashes = '#'.repeat(level);
  // Match: ^#{level} <type>  OR  ^#{level} <type>: <optional title>
  // Captures: group 1 = type, group 2 = title (may be undefined)
  return new RegExp(`^${hashes}\\s+([^:]+?)(?::\\s*(.*))?$`, 'i');
}

// Note: unrecognized headers are now caught by makeSectionPattern matching all
// ### headers, with unknown types reported as "Unknown section type" errors.

export function parseSections(
  content: string,
  headerLevel: 1 | 2 | 3 | 4,
  validTypes: Set<string>,
  file: string = ''
): SectionsResult {
  const SECTION_HEADER_PATTERN = makeSectionPattern(headerLevel);
  // Build patterns for adjacent levels to detect wrong heading level
  const wrongLevelPatterns: { pattern: RegExp; level: number }[] = [];
  for (const adjLevel of [headerLevel - 1, headerLevel + 1]) {
    if (adjLevel >= 1 && adjLevel <= 4) {
      wrongLevelPatterns.push({ pattern: makeSectionPattern(adjLevel as 1|2|3|4), level: adjLevel });
    }
  }
  const lines = content.split('\n');
  const sections: ParsedSection[] = [];
  const errors: ContentError[] = [];

  let currentSection: ParsedSection | null = null;
  let currentBody: string[] = [];
  let preHeaderWarned = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    const headerMatch = line.match(SECTION_HEADER_PATTERN);

    if (headerMatch) {
      // Save previous section
      if (currentSection) {
        currentSection.body = currentBody.join('\n');
        const { warnings } = parseFields(currentSection, file);
        errors.push(...warnings);
        sections.push(currentSection);
      }

      const rawType = headerMatch[1].trim();
      const normalizedType = rawType.toLowerCase();
      const title = (headerMatch[2] ?? '').trim();

      if (!validTypes.has(normalizedType)) {
        const capitalized = [...validTypes].map(t => t.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' '));
        errors.push({
          file,
          line: lineNum,
          message: `Unknown section type: ${rawType}`,
          suggestion: `Valid types: ${capitalized.join(', ')}`,
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
    } else {
      if (currentSection) {
        currentBody.push(line);
      } else if (!currentSection) {
        // Check for headers at wrong level that match known section types
        for (const { pattern, level } of wrongLevelPatterns) {
          const wrongMatch = line.match(pattern);
          if (wrongMatch) {
            const rawType = wrongMatch[1].trim();
            if (validTypes.has(rawType.toLowerCase())) {
              const expected = '#'.repeat(headerLevel);
              const actual = '#'.repeat(level);
              errors.push({
                file,
                line: lineNum,
                message: `Found '${actual} ${rawType}:' (heading level ${level}) but expected heading level ${headerLevel} (${expected} ${rawType}:)`,
                suggestion: `Change '${actual}' to '${expected}'`,
                severity: 'warning',
              });
            }
            break;
          }
        }
      }
      if (!currentSection && line.trim() && !preHeaderWarned) {
        // Non-blank content before any section header — will be silently lost
        preHeaderWarned = true;
        errors.push({
          file,
          line: lineNum,
          message: 'Content found before first section header — this text will be ignored',
          suggestion: 'Move this text into a section, or remove it',
          severity: 'warning',
        });
      }
    }
  }

  // Don't forget last section
  if (currentSection) {
    currentSection.body = currentBody.join('\n');
    const { warnings } = parseFields(currentSection, file);
    errors.push(...warnings);
    sections.push(currentSection);
  }

  return { sections, errors };
}

const FIELD_PATTERN = /^(\w+)::\s*(.*)$/;

interface ParseFieldsResult {
  warnings: ContentError[];
}

function parseFields(section: ParsedSection, file: string): ParseFieldsResult {
  const lines = section.body.split('\n');
  const warnings: ContentError[] = [];
  const seenFields = new Set<string>();
  let currentField: string | null = null;
  let currentValue: string[] = [];
  let freeTextWarned = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = section.line + i + 1; // +1 because body starts after header

    // Check for sub-header first - starts a new scope for field tracking
    const headerMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headerMatch) {
      // Before resetting, check if this looks like a markdown heading
      // inside a content/instructions field (not a structural header)
      if (currentField && MARKDOWN_CONTENT_FIELDS.has(currentField)) {
        const headingText = headerMatch[2].trim();
        // Extract type word: "Text", "Chat: title", "Article-excerpt" etc.
        const typeWord = headingText.replace(/:.*$/, '').trim().toLowerCase();
        // Also check if it's a typo of a structural type (levenshtein ≤ 2)
        const isTypoOfStructural = [...ALL_STRUCTURAL_TYPES].some(
          st => levenshtein(typeWord, st) <= 2
        );
        if (!ALL_STRUCTURAL_TYPES.has(typeWord) && !isTypoOfStructural) {
          const hashes = headerMatch[1];
          warnings.push({
            file,
            line: lineNum,
            message: `'${hashes} ${headingText}' looks like a Markdown heading inside ${currentField}:: field`,
            suggestion: `Escape it as '!${hashes} ${headingText}' so it's treated as content, not a section boundary`,
            severity: 'warning',
          });
        }
      }

      // Save current field if any
      if (currentField) {
        section.fields[currentField] = currentValue.join('\n').trim();
        currentField = null;
        currentValue = [];
      }
      // Reset seenFields for the new sub-section scope
      seenFields.clear();
      freeTextWarned = false;
      continue;
    }

    const match = line.match(FIELD_PATTERN);

    if (match) {
      // Save previous field if any
      if (currentField) {
        section.fields[currentField] = currentValue.join('\n').trim();
      }

      currentField = match[1];
      const inlineValue = match[2].trim();
      currentValue = inlineValue ? [inlineValue] : [];

      // Check for duplicate field
      if (seenFields.has(currentField)) {
        warnings.push({
          file,
          line: lineNum,
          message: `Duplicate field '${currentField}' (previous value will be overwritten)`,
          suggestion: `Remove the duplicate '${currentField}::' definition`,
          severity: 'warning',
        });
      }
      seenFields.add(currentField);
    } else if (currentField) {
      // Continue multiline value
      currentValue.push(line);
    } else {
      // Not inside a field — check for single-colon that should be double-colon
      const singleColonMatch = line.match(/^(\w+):\s+(.*)$/);
      if (singleColonMatch && !line.match(/^https?:/)) {
        warnings.push({
          file,
          line: lineNum,
          message: `Found '${singleColonMatch[1]}:' with single colon — did you mean '${singleColonMatch[1]}::'?`,
          suggestion: `Change '${singleColonMatch[1]}:' to '${singleColonMatch[1]}::' (double colon)`,
          severity: 'warning',
        });
      } else if (line.trim() && !freeTextWarned) {
        freeTextWarned = true;
        const preview = line.trim().length > 60 ? line.trim().slice(0, 60) + '...' : line.trim();
        warnings.push({
          file,
          line: lineNum,
          message: `Text outside of a field:: definition will be ignored: "${preview}"`,
          suggestion: 'Place this text inside a field (e.g., content:: your text), or remove it',
          severity: 'warning',
        });
      }
    }
  }

  // Save final field
  if (currentField) {
    section.fields[currentField] = currentValue.join('\n').trim();
  }

  return { warnings };
}
