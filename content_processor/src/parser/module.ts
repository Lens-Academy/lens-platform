// src/parser/module.ts
import type { ContentError, TextSegment } from '../index.js';
import { parseFrontmatter } from './frontmatter.js';
import { parseSections, MODULE_SECTION_TYPES, type ParsedSection } from './sections.js';
import { validateSlugFormat } from '../validator/field-values.js';

export interface PageTextResult {
  segments: TextSegment[];
  errors: ContentError[];
}

const VALID_PAGE_SUBSECTION_TYPES = new Set(['text']);

/**
 * Parse ## Text subsections from within a Page section body.
 * These subsections have a `content::` field that can span multiple lines.
 * Reports errors for unknown ## headers.
 *
 * @param body - The body text of a # Page: section
 * @param file - File path for error reporting
 * @param baseLineNum - Line number offset (body's position within the file)
 * @returns TextSegment objects and any errors from unknown ## headers
 */
export function parsePageTextSegments(
  body: string,
  file: string = '',
  baseLineNum: number = 0
): PageTextResult {
  const segments: TextSegment[] = [];
  const errors: ContentError[] = [];
  const lines = body.split('\n');

  let inTextSection = false;
  let currentContent = '';
  let collectingContent = false;
  let textSectionLineNum = 0;
  let foundContentField = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = baseLineNum + i + 1;

    // Check for ## header
    const headerMatch = line.match(/^##\s+(\S.*?)\s*$/);
    if (headerMatch) {
      // Check if previous ## Text section had no content:: field
      if (inTextSection && !foundContentField) {
        errors.push({
          file,
          line: textSectionLineNum,
          message: 'Text section missing content:: field',
          suggestion: "Add 'content::' followed by your text content",
          severity: 'error',
        });
      }

      // Save previous content if any
      if (collectingContent && currentContent.trim()) {
        segments.push({ type: 'text', content: currentContent.trim() });
      }

      const rawType = headerMatch[1].trim();
      const normalizedType = rawType.toLowerCase();

      if (VALID_PAGE_SUBSECTION_TYPES.has(normalizedType)) {
        inTextSection = true;
        textSectionLineNum = lineNum;
        foundContentField = false;
      } else {
        // Unknown ## header — report error
        const capitalized = [...VALID_PAGE_SUBSECTION_TYPES].map(
          t => t[0].toUpperCase() + t.slice(1)
        );
        errors.push({
          file,
          line: lineNum,
          message: `Unknown section type: ${rawType}`,
          suggestion: `Valid types: ${capitalized.join(', ')}`,
          severity: 'error',
        });
        inTextSection = false;
      }
      currentContent = '';
      collectingContent = false;
      continue;
    }

    if (inTextSection) {
      // Check for content:: field
      const contentMatch = line.match(/^content::\s*(.*)$/);
      if (contentMatch) {
        // Start collecting content
        foundContentField = true;
        collectingContent = true;
        const inlineValue = contentMatch[1].trim();
        currentContent = inlineValue;
      } else if (collectingContent) {
        // Check if this line starts another field (ends content collection)
        if (line.match(/^\w+::\s*/)) {
          // Save current content and stop collecting
          if (currentContent.trim()) {
            segments.push({ type: 'text', content: currentContent.trim() });
          }
          collectingContent = false;
          currentContent = '';
        } else {
          // Continue multiline content
          if (currentContent) {
            currentContent += '\n' + line;
          } else {
            currentContent = line;
          }
        }
      }
    }
  }

  // Don't forget the last segment
  if (collectingContent && currentContent.trim()) {
    segments.push({ type: 'text', content: currentContent.trim() });
  }

  // Check if final ## Text section had no content:: field
  if (inTextSection && !foundContentField) {
    errors.push({
      file,
      line: textSectionLineNum,
      message: 'Text section missing content:: field',
      suggestion: "Add 'content::' followed by your text content",
      severity: 'error',
    });
  }

  return { segments, errors };
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
