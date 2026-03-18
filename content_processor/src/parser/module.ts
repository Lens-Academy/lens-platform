// src/parser/module.ts
import type { ContentError } from '../index.js';
import { parseFrontmatter } from './frontmatter.js';
import { parseSections, MODULE_SECTION_TYPES, type ParsedSection } from './sections.js';
import { validateSlugFormat } from '../validator/field-values.js';
import { validateFrontmatter } from '../validator/validate-frontmatter.js';
import { stripAuthoringMarkup, parseSegments, convertSegment, applySourceInheritance, type ParsedLens, type ParsedLensSegment } from './lens.js';
import { validateSegmentFields } from '../validator/segment-fields.js';
import { validateFieldValues } from '../validator/field-values.js';
import { detectFieldTypos } from '../validator/field-typos.js';

export interface ParsedModule {
  slug: string;
  title: string;
  contentId: string | null;
  sections: ParsedSection[];
  /** Inline lenses keyed by section index — only for `# Lens:` sections with `id::` */
  inlineLenses?: Map<number, ParsedLens>;
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
  const sectionsResult = parseSections(body, 1, moduleSectionTypes, file);

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

  // Parse inline lenses from # Lens: sections that have id::
  // (id:: indicates inline, source:: at section level indicates referenced)
  // Note: section.fields may contain source:: from #### Article segments inside the body,
  // so we detect inline vs referenced by presence of id:: field.
  // We also need to check if source:: appears before any #### header (section-level source).
  const inlineLenses = new Map<number, ParsedLens>();
  for (let i = 0; i < sectionsResult.sections.length; i++) {
    const section = sectionsResult.sections[i];
    const hasSectionLevelSource = hasFieldBeforeSegmentHeaders(section.body, 'source');
    if (section.type === 'lens' && !hasSectionLevelSource && section.fields.id) {
      const inlineLens = parseInlineLens(section, file);
      errors.push(...inlineLens.errors);
      if (inlineLens.lens) {
        inlineLenses.set(i, inlineLens.lens);
      }
    }
  }

  const module: ParsedModule = {
    slug: frontmatter.slug as string,
    title: frontmatter.title as string,
    // Accept both 'contentId' and 'id' from frontmatter (prefer contentId)
    contentId: (frontmatter.contentId as string) ?? (frontmatter.id as string) ?? null,
    sections: sectionsResult.sections,
    ...(inlineLenses.size > 0 ? { inlineLenses } : {}),
  };

  return { module, errors };
}

/**
 * Check if a field:: definition appears in the section body before any #### segment header.
 * Used to distinguish section-level fields from segment-level fields.
 */
export function hasFieldBeforeSegmentHeaders(body: string, fieldName: string): boolean {
  const lines = body.split('\n');
  const fieldPattern = new RegExp(`^${fieldName}::\\s`);
  for (const line of lines) {
    // If we hit a #### header, stop checking
    if (/^####\s/.test(line)) return false;
    if (fieldPattern.test(line)) return true;
  }
  return false;
}

/**
 * Parse an inline lens from a # Lens: section body.
 * The section has id:: and #### segments (like a lens file body, but without frontmatter).
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

  const tldr = section.fields.tldr || undefined;

  // Parse H4 segments from the section body
  const { segments: rawSegments, errors: segmentErrors } = parseSegments(
    section.body,
    section.line + 1,
    file
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
    tldr,
    segments: parsedSegments,
  };

  return { lens, errors };
}
