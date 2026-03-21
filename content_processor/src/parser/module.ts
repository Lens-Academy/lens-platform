// src/parser/module.ts
import type { ContentError } from '../index.js';
import { parseFrontmatter } from './frontmatter.js';
import { parseSections, MODULE_SECTION_TYPES, type ParsedSection } from './sections.js';
import { validateSlugFormat } from '../validator/field-values.js';
import { validateFrontmatter } from '../validator/validate-frontmatter.js';
import { stripAuthoringMarkup, convertSegment, applySourceInheritance, LENS_SEGMENT_TYPES, type ParsedLens, type ParsedLensSegment } from './lens.js';
import { validateSegmentFields } from '../validator/segment-fields.js';
import { validateFieldValues } from '../validator/field-values.js';
import { detectFieldTypos } from '../validator/field-typos.js';

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

  // Strip authoring markup (CriticMarkup + Obsidian comments) before parsing
  content = stripAuthoringMarkup(content);

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

  if (errors.some(e => e.severity === 'error')) {
    return { module: null, errors };
  }

  // Parse sections (H1 headers for module files, including submodule support)
  const moduleSectionTypes = new Set([...MODULE_SECTION_TYPES, 'submodule']);
  const sectionsResult = parseSections(body, 0, moduleSectionTypes, file);

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
      suggestion: "Add sections like '# Lens:', or '# Learning Outcome:'",
      severity: 'warning',
    });
  }

  // Parse inline lenses recursively from all Lens sections with id::
  // (id:: indicates inline, source:: at section level indicates referenced)
  attachInlineLenses(sectionsResult.sections, file, errors);

  const module: ParsedModule = {
    slug: frontmatter.slug as string,
    title: frontmatter.title as string,
    // Accept both 'contentId' and 'id' from frontmatter (prefer contentId)
    contentId: (frontmatter.contentId as string) ?? (frontmatter.id as string) ?? null,
    sections: sectionsResult.sections,
  };

  return { module, errors };
}

/**
 * Check if a field:: definition appears in the section body before any #### segment header.
 * Used to distinguish section-level fields from segment-level fields.
 */
export function hasFieldBeforeSegmentHeaders(body: string, fieldName: string, sectionLevel: number = 0): boolean {
  const lines = body.split('\n');
  const fieldPattern = new RegExp(`^${fieldName}::\\s`);
  const minLevel = sectionLevel + 1;
  const segmentPattern = new RegExp(`^#{${minLevel},6}\\s`);
  for (const line of lines) {
    // If we hit a segment header (any level deeper than section), stop checking
    if (segmentPattern.test(line)) return false;
    if (fieldPattern.test(line)) return true;
  }
  return false;
}

/**
 * Recursively detect and attach inline lenses to all Lens sections.
 * An inline lens has id:: but no section-level source::.
 * Works for both top-level sections and submodule children.
 */
function attachInlineLenses(sections: ParsedSection[], file: string, errors: ContentError[]): void {
  for (const section of sections) {
    if (section.type === 'lens' && section.fields.id
        && !hasFieldBeforeSegmentHeaders(section.body, 'source', section.level)) {
      const result = parseInlineLens(section, file);
      errors.push(...result.errors);
      if (result.lens) {
        section.inlineLens = result.lens;
      }
    }
    if (section.children) {
      attachInlineLenses(section.children, file, errors);
    }
  }
}

/**
 * Parse an inline lens from a Lens section body.
 * The section has id:: and segments (like a lens file body, but without frontmatter).
 */
function parseInlineLens(
  section: ParsedSection,
  file: string
): { lens: ParsedLens | null; errors: ContentError[] } {
  const errors: ContentError[] = [];

  const id = section.fields.id;
  if (!id || id.trim() === '') {
    errors.push({
      file,
      line: section.line,
      message: 'Inline Lens section missing id:: field',
      suggestion: 'Add an id:: field with a UUID',
      severity: 'error',
    });
    return { lens: null, errors };
  }

  const title = section.fields.title || undefined;
  const tldr = section.fields.tldr || undefined;

  // Parse segments from section body using unified parser (flat mode)
  const { sections: rawSegments, errors: segmentErrors } = parseSections(
    section.body,
    section.level,  // parent level = this section's level
    LENS_SEGMENT_TYPES,
    file,
    true  // flat=true — segments are always siblings
  );
  errors.push(...segmentErrors);

  // Convert raw segments to typed segments + validate
  const parsedSegments: ParsedLensSegment[] = [];
  for (const rawSeg of rawSegments) {
    // Validate that fields are appropriate for this segment type
    const fieldWarnings = validateSegmentFields(rawSeg.type, rawSeg.fields, file, rawSeg.line);
    errors.push(...fieldWarnings);

    // Validate field values
    const valueWarnings = validateFieldValues(rawSeg.fields, file, rawSeg.line);
    errors.push(...valueWarnings);

    // Detect likely typos in field names
    const typoWarnings = detectFieldTypos(rawSeg.fields, file, rawSeg.line);
    errors.push(...typoWarnings);

    const { segment, errors: conversionErrors } = convertSegment(rawSeg, 'lens', file);
    errors.push(...conversionErrors);
    if (segment) {
      parsedSegments.push(segment);
    }
  }

  // Apply source inheritance for article and video segments
  const inheritanceErrors = applySourceInheritance(parsedSegments, file);
  errors.push(...inheritanceErrors);

  if (parsedSegments.length === 0) {
    errors.push({
      file,
      line: section.line,
      message: 'Inline lens has no segments',
      suggestion: 'Add at least one segment (#### Text, #### Chat, etc.)',
      severity: 'warning',
    });
  }

  const lens: ParsedLens = {
    id,
    title,
    tldr,
    segments: parsedSegments,
  };

  return { lens, errors };
}
