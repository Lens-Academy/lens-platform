// src/parser/course.ts
import type { ContentError, ProgressionItem, Course } from '../index.js';
import { parseFrontmatter } from './frontmatter.js';
import { parseSections, type ParsedSection } from './sections.js';
import { parseWikilink } from './wikilink.js';
import { basename } from 'path';

// Valid section types for course files
export const COURSE_SECTION_TYPES = new Set(['module', 'meeting']);

export interface CourseParseResult {
  course: Course | null;
  errors: ContentError[];
}

/**
 * Extracts the slug from a module path (filename without extension)
 * e.g., '../modules/intro.md' -> 'intro'
 */
function extractSlugFromPath(path: string): string {
  const filename = basename(path);
  return filename.replace(/\.md$/, '');
}

/**
 * Parses a Module section title to extract the wikilink and module slug
 * Title format: [[../modules/intro.md|Display Text]]
 */
function parseModuleSection(
  section: ParsedSection,
  file: string
): { slug: string; optional: boolean } | { error: ContentError } {
  // The title should be a wikilink
  const wikilink = parseWikilink(section.title);

  if (!wikilink) {
    return {
      error: {
        file,
        line: section.line,
        message: `Module section must have a wikilink in title, got: "${section.title}"`,
        suggestion: 'Use format: # Module: [[../modules/module-name.md|Display Text]]',
        severity: 'error',
      },
    };
  }

  const slug = extractSlugFromPath(wikilink.path);
  const optional = section.fields.optional === 'true';

  return { slug, optional };
}

/**
 * Parses a Meeting section title to extract the meeting number
 * Title format: 1, 2, 3, etc.
 */
function parseMeetingSection(
  section: ParsedSection,
  file: string
): { number: number } | { error: ContentError } {
  const meetingNumber = parseInt(section.title, 10);

  if (isNaN(meetingNumber)) {
    return {
      error: {
        file,
        line: section.line,
        message: `Meeting section must have a number in title, got: "${section.title}"`,
        suggestion: 'Use format: # Meeting: 1',
        severity: 'error',
      },
    };
  }

  return { number: meetingNumber };
}

/**
 * Parses a course file and extracts its structure.
 *
 * Course files use H1 sections:
 * - `# Module: [[../modules/name.md|Display]]` - references a module
 * - `# Meeting: 1` - marks a meeting point
 *
 * The module slug is extracted from the filename in the wikilink path.
 * Reference validation (checking if modules exist) happens in processContent.
 */
export function parseCourse(content: string, file: string): CourseParseResult {
  const errors: ContentError[] = [];

  // Parse frontmatter
  const frontmatterResult = parseFrontmatter(content, file);
  if (frontmatterResult.error) {
    errors.push(frontmatterResult.error);
    return { course: null, errors };
  }

  const { frontmatter, body, bodyStartLine } = frontmatterResult;

  // Validate required frontmatter fields
  if (!frontmatter.slug) {
    errors.push({
      file,
      line: 2,
      message: 'Missing required field: slug',
      suggestion: "Add 'slug: your-course-slug' to frontmatter",
      severity: 'error',
    });
  }

  if (!frontmatter.title) {
    errors.push({
      file,
      line: 2,
      message: 'Missing required field: title',
      suggestion: "Add 'title: Your Course Title' to frontmatter",
      severity: 'error',
    });
  }

  if (errors.length > 0) {
    return { course: null, errors };
  }

  // Parse sections (H1 headers for course files)
  const sectionsResult = parseSections(body, 1, COURSE_SECTION_TYPES, file);

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

  // Build progression array from parsed sections
  const progression: ProgressionItem[] = [];

  for (const section of sectionsResult.sections) {
    if (section.type === 'module') {
      const result = parseModuleSection(section, file);
      if ('error' in result) {
        errors.push(result.error);
      } else {
        progression.push({
          type: 'module',
          slug: result.slug,
          optional: result.optional,
        });
      }
    } else if (section.type === 'meeting') {
      const result = parseMeetingSection(section, file);
      if ('error' in result) {
        errors.push(result.error);
      } else {
        progression.push({
          type: 'meeting',
          number: result.number,
        });
      }
    }
  }

  const course: Course = {
    slug: frontmatter.slug as string,
    title: frontmatter.title as string,
    progression,
  };

  return { course, errors };
}
