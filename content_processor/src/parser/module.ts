// src/parser/module.ts
import type { ContentError, TextSegment } from '../index.js';
import { parseFrontmatter } from './frontmatter.js';
import { parseSections, MODULE_SECTION_TYPES, type ParsedSection } from './sections.js';

/**
 * Parse ## Text subsections from within a Page section body.
 * These subsections have a `content::` field that can span multiple lines.
 *
 * @param body - The body text of a # Page: section
 * @returns Array of TextSegment objects extracted from ## Text subsections
 */
export function parsePageTextSegments(body: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const lines = body.split('\n');

  let inTextSection = false;
  let currentContent = '';
  let collectingContent = false;

  for (const line of lines) {
    // Check for ## Text header (case-insensitive)
    if (line.match(/^##\s+Text\s*$/i)) {
      // Save previous content if any
      if (collectingContent && currentContent.trim()) {
        segments.push({ type: 'text', content: currentContent.trim() });
      }
      inTextSection = true;
      currentContent = '';
      collectingContent = false;
      continue;
    }

    // Check for any other ## header (end of Text section)
    if (line.match(/^##\s+\S/)) {
      // Save current content if any
      if (collectingContent && currentContent.trim()) {
        segments.push({ type: 'text', content: currentContent.trim() });
      }
      inTextSection = false;
      currentContent = '';
      collectingContent = false;
      continue;
    }

    if (inTextSection) {
      // Check for content:: field
      const contentMatch = line.match(/^content::\s*(.*)$/);
      if (contentMatch) {
        // Start collecting content
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

  return segments;
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
  if (!frontmatter.slug) {
    errors.push({
      file,
      line: 2,
      message: 'Missing required field: slug',
      suggestion: "Add 'slug: your-module-slug' to frontmatter",
      severity: 'error',
    });
  }

  if (!frontmatter.title) {
    errors.push({
      file,
      line: 2,
      message: 'Missing required field: title',
      suggestion: "Add 'title: Your Module Title' to frontmatter",
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
    contentId: (frontmatter.id as string) ?? null,
    sections: sectionsResult.sections,
  };

  return { module, errors };
}
