// src/parser/module.ts
import type { ContentError, TextSegment, ChatSegment } from '../index.js';
import { parseFrontmatter } from './frontmatter.js';
import { parseSections, MODULE_SECTION_TYPES, type ParsedSection } from './sections.js';
import { validateSlugFormat } from '../validator/field-values.js';
import { validateFrontmatter } from '../validator/validate-frontmatter.js';

export interface PageSegmentResult {
  segments: (TextSegment | ChatSegment)[];
  errors: ContentError[];
}

const VALID_PAGE_SUBSECTION_TYPES = new Set(['text', 'chat']);

interface RawSubsection {
  type: string;
  fields: Record<string, string>;
  line: number;
}

/**
 * Collect raw subsections from a Page section body.
 * Each ## header starts a new subsection whose fields are collected generically.
 */
function collectRawSubsections(
  body: string,
  baseLineNum: number
): { subsections: RawSubsection[]; unknownHeaders: { rawType: string; line: number }[]; warnings: ContentError[] } {
  const subsections: RawSubsection[] = [];
  const unknownHeaders: { rawType: string; line: number }[] = [];
  const warnings: ContentError[] = [];
  const lines = body.split('\n');

  let current: RawSubsection | null = null;
  let freeTextWarned = false;
  let currentFieldName: string | null = null;
  let currentFieldLines: string[] = [];

  function finalizeField() {
    if (current && currentFieldName) {
      current.fields[currentFieldName] = currentFieldLines.join('\n').trim();
    }
    currentFieldName = null;
    currentFieldLines = [];
  }

  function finalizeSubsection() {
    finalizeField();
    if (current) {
      subsections.push(current);
    }
    current = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = baseLineNum + i + 1;

    // Check for ## header
    const headerMatch = line.match(/^##\s+(\S.*?)\s*$/);
    if (headerMatch) {
      finalizeSubsection();
      freeTextWarned = false;

      const rawType = headerMatch[1].trim();
      const normalizedType = rawType.toLowerCase();

      if (VALID_PAGE_SUBSECTION_TYPES.has(normalizedType)) {
        current = { type: normalizedType, fields: {}, line: lineNum };
      } else {
        unknownHeaders.push({ rawType, line: lineNum });
      }
      continue;
    }

    if (!current) continue;

    // Check for field:: value
    const fieldMatch = line.match(/^(\w+)::\s*(.*)$/);
    if (fieldMatch) {
      finalizeField();
      currentFieldName = fieldMatch[1];
      const inlineValue = fieldMatch[2].trim();
      currentFieldLines = inlineValue ? [inlineValue] : [];
    } else if (currentFieldName) {
      // Continue multiline field value
      currentFieldLines.push(line);
    } else if (line.trim() && !freeTextWarned) {
      freeTextWarned = true;
      const preview = line.trim().length > 60 ? line.trim().slice(0, 60) + '...' : line.trim();
      warnings.push({
        file: '',
        line: lineNum,
        message: `Text outside of a field:: definition will be ignored: "${preview}"`,
        suggestion: 'Place this text inside a field (e.g., content:: your text), or remove it',
        severity: 'warning' as const,
      });
    }
  }

  finalizeSubsection();
  return { subsections, unknownHeaders, warnings };
}

/**
 * Convert raw subsections into typed segments, validating required fields.
 */
function convertSubsections(
  subsections: RawSubsection[],
  file: string
): { segments: (TextSegment | ChatSegment)[]; errors: ContentError[] } {
  const segments: (TextSegment | ChatSegment)[] = [];
  const errors: ContentError[] = [];

  for (const sub of subsections) {
    switch (sub.type) {
      case 'text': {
        const hasContentField = 'content' in sub.fields;
        const content = sub.fields.content;

        if (!hasContentField) {
          errors.push({
            file,
            line: sub.line,
            message: 'Text section missing content:: field',
            suggestion: "Add 'content::' followed by your text content",
            severity: 'error',
          });
          break;
        }

        if (content.trim()) {
          segments.push({ type: 'text', content: content.trim() });
        }
        break;
      }

      case 'chat': {
        const hasInstructionsField = 'instructions' in sub.fields;
        const instructions = sub.fields.instructions;

        if (!hasInstructionsField) {
          errors.push({
            file,
            line: sub.line,
            message: 'Chat segment missing instructions:: field',
            suggestion: "Add 'instructions:: Your instructions here' to the chat segment",
            severity: 'error',
          });
          break;
        }

        if (!instructions || instructions.trim() === '') {
          errors.push({
            file,
            line: sub.line,
            message: 'Chat segment has empty instructions:: field',
            suggestion: 'Add instructions text after instructions::',
            severity: 'warning',
          });
        }

        const segment: ChatSegment = {
          type: 'chat',
          instructions: instructions || '',
          hidePreviousContentFromUser: sub.fields.hidePreviousContentFromUser?.toLowerCase() === 'true' ? true : undefined,
          hidePreviousContentFromTutor: sub.fields.hidePreviousContentFromTutor?.toLowerCase() === 'true' ? true : undefined,
        };
        segments.push(segment);
        break;
      }
    }
  }

  return { segments, errors };
}

/**
 * Parse ## Text and ## Chat subsections from within a Page section body.
 * Reports errors for unknown ## headers and missing required fields.
 *
 * @param body - The body text of a # Page: section
 * @param file - File path for error reporting
 * @param baseLineNum - Line number offset (body's position within the file)
 * @returns Segment objects (TextSegment | ChatSegment) and any errors
 */
export function parsePageSegments(
  body: string,
  file: string = '',
  baseLineNum: number = 0
): PageSegmentResult {
  const errors: ContentError[] = [];

  const { subsections, unknownHeaders, warnings } = collectRawSubsections(body, baseLineNum);

  // Forward free-text warnings with file path
  for (const w of warnings) {
    errors.push({ ...w, file });
  }

  // Report unknown headers
  for (const unk of unknownHeaders) {
    const capitalized = [...VALID_PAGE_SUBSECTION_TYPES].map(
      t => t[0].toUpperCase() + t.slice(1)
    );
    errors.push({
      file,
      line: unk.line,
      message: `Unknown section type: ${unk.rawType}`,
      suggestion: `Valid types: ${capitalized.join(', ')}`,
      severity: 'error',
    });
  }

  const result = convertSubsections(subsections, file);
  errors.push(...result.errors);

  return { segments: result.segments, errors };
}


export interface ParsedModule {
  slug: string;
  title: string;
  contentId: string | null;
  sections: ParsedSection[];
}

export interface ModuleParseResult {
  module: ParsedModule | null;
  errors: ContentError[];
}

export function parseModule(content: string, file: string): ModuleParseResult {
  const errors: ContentError[] = [];

  // Parse frontmatter
  const frontmatterResult = parseFrontmatter(content, file);
  if (frontmatterResult.error) {
    errors.push(frontmatterResult.error);
    return { module: null, errors };
  }

  const { frontmatter, body, bodyStartLine } = frontmatterResult;

  const frontmatterErrors = validateFrontmatter(frontmatter, 'module', file);
  errors.push(...frontmatterErrors);

  // Module-specific: validate slug format (only if slug is present and non-empty)
  const slug = frontmatter.slug;
  if (typeof slug === 'string' && slug.trim() !== '') {
    const slugFormatError = validateSlugFormat(slug, file, 2);
    if (slugFormatError) {
      errors.push(slugFormatError);
    }
  }

  if (errors.length > 0) {
    return { module: null, errors };
  }

  // Parse sections (H1 headers for module files)
  const sectionsResult = parseSections(body, 1, MODULE_SECTION_TYPES, file);

  // Adjust line numbers to account for frontmatter
  for (const error of sectionsResult.errors) {
    if (error.line) {
      error.line += bodyStartLine - 1;
    }
  }
  errors.push(...sectionsResult.errors);

  for (const section of sectionsResult.sections) {
    section.line += bodyStartLine - 1;
  }


  if (sectionsResult.sections.length === 0) {
    errors.push({
      file,
      line: bodyStartLine,
      message: 'Module has no sections',
      suggestion: "Add sections like '# Page:', '# Learning Outcome:', or '# Uncategorized:'",
      severity: 'warning',
    });
  }
  const module: ParsedModule = {
    slug: frontmatter.slug as string,
    title: frontmatter.title as string,
    // Accept both 'contentId' and 'id' from frontmatter (prefer contentId)
    contentId: (frontmatter.contentId as string) ?? (frontmatter.id as string) ?? null,
    sections: sectionsResult.sections,
  };

  return { module, errors };
}
