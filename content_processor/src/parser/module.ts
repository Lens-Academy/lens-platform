// src/parser/module.ts
import type { ContentError, TextSegment, ChatSegment, Segment } from '../index.js';
import { parseFrontmatter } from './frontmatter.js';
import { parseSections, MODULE_SECTION_TYPES, type ParsedSection } from './sections.js';
import { validateSlugFormat } from '../validator/field-values.js';

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
): { subsections: RawSubsection[]; unknownHeaders: { rawType: string; line: number }[] } {
  const subsections: RawSubsection[] = [];
  const unknownHeaders: { rawType: string; line: number }[] = [];
  const lines = body.split('\n');

  let current: RawSubsection | null = null;
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
    }
  }

  finalizeSubsection();
  return { subsections, unknownHeaders };
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
          hidePreviousContentFromUser: sub.fields.hidePreviousContentFromUser === 'true' ? true : undefined,
          hidePreviousContentFromTutor: sub.fields.hidePreviousContentFromTutor === 'true' ? true : undefined,
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

  const { subsections, unknownHeaders } = collectRawSubsections(body, baseLineNum);

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

  // Validate required frontmatter fields
  const slug = frontmatter.slug;
  if (slug === undefined || slug === null) {
    errors.push({
      file,
      line: 2,
      message: 'Missing required field: slug',
      suggestion: "Add 'slug: your-module-slug' to frontmatter",
      severity: 'error',
    });
  } else if (typeof slug === 'string' && slug.trim() === '') {
    errors.push({
      file,
      line: 2,
      message: 'Field slug cannot be empty or whitespace-only',
      suggestion: 'Provide a non-empty value for slug',
      severity: 'error',
    });
  } else if (typeof slug === 'string') {
    // Validate slug format (after empty check)
    const slugFormatError = validateSlugFormat(slug, file, 2);
    if (slugFormatError) {
      errors.push(slugFormatError);
    }
  }

  const title = frontmatter.title;
  if (title === undefined || title === null) {
    errors.push({
      file,
      line: 2,
      message: 'Missing required field: title',
      suggestion: "Add 'title: Your Module Title' to frontmatter",
      severity: 'error',
    });
  } else if (typeof title === 'string' && title.trim() === '') {
    errors.push({
      file,
      line: 2,
      message: 'Field title cannot be empty or whitespace-only',
      suggestion: 'Provide a non-empty value for title',
      severity: 'error',
    });
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

  const module: ParsedModule = {
    slug: frontmatter.slug as string,
    title: frontmatter.title as string,
    // Accept both 'contentId' and 'id' from frontmatter (prefer contentId)
    contentId: (frontmatter.contentId as string) ?? (frontmatter.id as string) ?? null,
    sections: sectionsResult.sections,
  };

  return { module, errors };
}
