// src/parser/lens.ts
import type { ContentError } from '../index.js';
import { parseFrontmatter } from './frontmatter.js';
import { parseSections, LENS_SECTION_TYPES, LENS_OUTPUT_TYPE } from './sections.js';
import { validateSegmentFields } from '../validator/segment-fields.js';
import { validateFieldValues } from '../validator/field-values.js';

// Segment types for parsed lens content (before bundling/flattening)
export interface ParsedTextSegment {
  type: 'text';
  content: string;
  optional?: boolean;
}

export interface ParsedChatSegment {
  type: 'chat';
  title?: string;
  instructions?: string;
  hidePreviousContentFromUser?: boolean;
  hidePreviousContentFromTutor?: boolean;
  optional?: boolean;
}

export interface ParsedArticleExcerptSegment {
  type: 'article-excerpt';
  fromAnchor?: string;   // Text anchor (start) - undefined means start of article
  toAnchor?: string;     // Text anchor (end) - undefined means end of article
  optional?: boolean;
}

export interface ParsedVideoExcerptSegment {
  type: 'video-excerpt';
  fromTimeStr: string;  // Timestamp string like "1:30"
  toTimeStr: string;    // Timestamp string like "5:45"
  optional?: boolean;
}

export type ParsedLensSegment =
  | ParsedTextSegment
  | ParsedChatSegment
  | ParsedArticleExcerptSegment
  | ParsedVideoExcerptSegment;

export interface ParsedLensSection {
  type: string;         // 'text', 'lens-article', 'lens-video'
  title: string;
  source?: string;      // Required for article/video, raw wikilink
  resolvedPath?: string; // Resolved source path for article/video
  segments: ParsedLensSegment[];
  line: number;
}

export interface ParsedLens {
  id: string;
  sections: ParsedLensSection[];
}

export interface LensParseResult {
  lens: ParsedLens | null;
  errors: ContentError[];
}

// Valid segment types for lens H4 headers
const LENS_SEGMENT_TYPES = new Set(['text', 'chat', 'article-excerpt', 'video-excerpt']);

// H4 segment header pattern: #### <type> or #### <type>: <title>
const SEGMENT_HEADER_PATTERN = /^####\s+(\S+)(?::\s*(.*))?$/i;

// Field pattern: fieldname:: value
const FIELD_PATTERN = /^(\w+)::\s*(.*)$/;

interface RawSegment {
  type: string;
  title?: string;
  fields: Record<string, string>;
  line: number;
}

/**
 * Parse H4 segments from a section body.
 * Segments are defined by `#### <type>` headers within a section.
 */
function parseSegments(
  sectionBody: string,
  bodyStartLine: number,
  file: string
): { segments: RawSegment[]; errors: ContentError[] } {
  const lines = sectionBody.split('\n');
  const segments: RawSegment[] = [];
  const errors: ContentError[] = [];

  let currentSegment: RawSegment | null = null;
  let currentFieldLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = bodyStartLine + i;

    const headerMatch = line.match(SEGMENT_HEADER_PATTERN);

    if (headerMatch) {
      // Save previous segment
      if (currentSegment) {
        parseFieldsIntoSegment(currentSegment, currentFieldLines);
        segments.push(currentSegment);
      }

      const rawType = headerMatch[1].trim();
      const normalizedType = rawType.toLowerCase();
      const title = headerMatch[2]?.trim() || undefined;

      if (!LENS_SEGMENT_TYPES.has(normalizedType)) {
        errors.push({
          file,
          line: lineNum,
          message: `Unknown segment type: ${rawType}`,
          suggestion: `Valid types: ${[...LENS_SEGMENT_TYPES].join(', ')}`,
          severity: 'error',
        });
      }

      currentSegment = {
        type: normalizedType,
        title,
        fields: {},
        line: lineNum,
      };
      currentFieldLines = [];
    } else if (currentSegment) {
      currentFieldLines.push(line);
    }
  }

  // Don't forget last segment
  if (currentSegment) {
    parseFieldsIntoSegment(currentSegment, currentFieldLines);
    segments.push(currentSegment);
  }

  return { segments, errors };
}

/**
 * Parse fields from lines into a segment, handling multiline values.
 * A field continues until the next field or the end of the lines.
 */
function parseFieldsIntoSegment(segment: RawSegment, lines: string[]): void {
  let currentField: string | null = null;
  let currentValue: string[] = [];

  for (const line of lines) {
    const match = line.match(FIELD_PATTERN);

    if (match) {
      // Save previous field if any
      if (currentField) {
        segment.fields[currentField] = currentValue.join('\n').trim();
      }

      currentField = match[1];
      const inlineValue = match[2].trim();
      currentValue = inlineValue ? [inlineValue] : [];
    } else if (currentField) {
      // Continue multiline value
      currentValue.push(line);
    }
  }

  // Save final field
  if (currentField) {
    segment.fields[currentField] = currentValue.join('\n').trim();
  }
}

/**
 * Convert a raw segment to a typed ParsedLensSegment.
 */
function convertSegment(
  raw: RawSegment,
  sectionType: string,
  file: string
): { segment: ParsedLensSegment | null; errors: ContentError[] } {
  const errors: ContentError[] = [];

  switch (raw.type) {
    case 'text': {
      const hasContentField = 'content' in raw.fields;
      const content = raw.fields.content;

      if (!hasContentField) {
        // Field completely missing - error
        errors.push({
          file,
          line: raw.line,
          message: 'Text segment missing content:: field',
          suggestion: "Add 'content:: Your text here' to the text segment",
          severity: 'error',
        });
        return { segment: null, errors };
      }

      if (!content || content.trim() === '') {
        // Field present but empty - warning
        errors.push({
          file,
          line: raw.line,
          message: 'Text segment has empty content:: field',
          suggestion: 'Add text content after content::',
          severity: 'warning',
        });
        // Still create the segment, just with empty content
        const segment: ParsedTextSegment = {
          type: 'text',
          content: '',
          optional: raw.fields.optional === 'true' ? true : undefined,
        };
        return { segment, errors };
      }

      const segment: ParsedTextSegment = {
        type: 'text',
        content,
        optional: raw.fields.optional === 'true' ? true : undefined,
      };
      return { segment, errors };
    }

    case 'chat': {
      const segment: ParsedChatSegment = {
        type: 'chat',
        title: raw.title,
        instructions: raw.fields.instructions,
        hidePreviousContentFromUser: raw.fields.hidePreviousContentFromUser === 'true' ? true : undefined,
        hidePreviousContentFromTutor: raw.fields.hidePreviousContentFromTutor === 'true' ? true : undefined,
        optional: raw.fields.optional === 'true' ? true : undefined,
      };
      return { segment, errors };
    }

    case 'article-excerpt': {
      const fromField = raw.fields.from;
      const toField = raw.fields.to;

      // Both from:: and to:: are optional for article-excerpt:
      // - Only from:: → extract from anchor to end of article
      // - Only to:: → extract from start to anchor
      // - Neither → extract entire article

      // Strip quotes from anchor text if present
      const fromAnchor = fromField ? stripQuotes(fromField) : undefined;
      const toAnchor = toField ? stripQuotes(toField) : undefined;

      const segment: ParsedArticleExcerptSegment = {
        type: 'article-excerpt',
        fromAnchor,
        toAnchor,
        optional: raw.fields.optional === 'true' ? true : undefined,
      };
      return { segment, errors };
    }

    case 'video-excerpt': {
      const fromField = raw.fields.from;
      const toField = raw.fields.to;

      // to:: is required, from:: defaults to "0:00"
      if (!toField) {
        errors.push({
          file,
          line: raw.line,
          message: 'Video-excerpt segment missing to:: field',
          suggestion: "Add 'to:: M:SS' or 'to:: H:MM:SS' to the segment",
          severity: 'error',
        });
        return { segment: null, errors };
      }

      const segment: ParsedVideoExcerptSegment = {
        type: 'video-excerpt',
        fromTimeStr: fromField || '0:00',  // Default to start of video
        toTimeStr: toField,
        optional: raw.fields.optional === 'true' ? true : undefined,
      };
      return { segment, errors };
    }

    default:
      // Unknown segment type - error already reported during parseSegments
      return { segment: null, errors };
  }
}

/**
 * Strip surrounding quotes from a string if present.
 */
function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Check if a segment is empty (has no meaningful fields).
 * Returns a warning if the segment is empty.
 *
 * Note: article-excerpt with no fields is valid (means entire article).
 */
function checkEmptySegment(raw: RawSegment, file: string): ContentError | null {
  // A segment is empty if it has no fields at all
  const fieldCount = Object.keys(raw.fields).length;

  // article-excerpt with no fields is valid - means "include entire article"
  if (raw.type === 'article-excerpt' && fieldCount === 0) {
    return null;
  }

  if (fieldCount === 0) {
    return {
      file,
      line: raw.line,
      message: `Empty ${raw.type} segment has no fields`,
      suggestion: `Add required fields to the ${raw.type} segment`,
      severity: 'warning',
    };
  }

  return null;
}

/**
 * Parse a lens file into structured lens data.
 *
 * Lens files use:
 * - H3 (`###`) for sections: Text, Article, Video
 * - H4 (`####`) for segments: Text, Chat, Article-excerpt, Video-excerpt
 */
export function parseLens(content: string, file: string): LensParseResult {
  const errors: ContentError[] = [];

  // Step 1: Parse frontmatter and validate id field
  const frontmatterResult = parseFrontmatter(content, file);
  if (frontmatterResult.error) {
    errors.push(frontmatterResult.error);
    return { lens: null, errors };
  }

  const { frontmatter, body, bodyStartLine } = frontmatterResult;

  // Validate required id field
  if (!frontmatter.id) {
    errors.push({
      file,
      line: 2,
      message: 'Missing required field: id',
      suggestion: "Add 'id: <uuid>' to frontmatter",
      severity: 'error',
    });
    return { lens: null, errors };
  }

  // Step 2: Parse H3 sections (Text, Article, Video)
  const sectionsResult = parseSections(body, 3, LENS_SECTION_TYPES, file);

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

  // Step 3: Convert raw sections to ParsedLensSections with segments
  const parsedSections: ParsedLensSection[] = [];

  for (const rawSection of sectionsResult.sections) {
    // Map section type: 'article' -> 'lens-article', 'video' -> 'lens-video'
    const outputType = LENS_OUTPUT_TYPE[rawSection.type] ?? rawSection.type;

    // For article/video sections, source field is required
    const needsSource = outputType === 'lens-article' || outputType === 'lens-video';
    const source = rawSection.fields.source;

    if (needsSource && !source) {
      errors.push({
        file,
        line: rawSection.line,
        message: `${rawSection.rawType} section missing source:: field`,
        suggestion: `Add 'source:: [[../path/to/file.md|Display]]' to the ${rawSection.rawType.toLowerCase()} section`,
        severity: 'error',
      });
    }

    // Parse H4 segments within this section
    const { segments: rawSegments, errors: segmentErrors } = parseSegments(
      rawSection.body,
      rawSection.line + 1, // Segments start after the section header
      file
    );
    errors.push(...segmentErrors);

    // Convert raw segments to typed segments
    const segments: ParsedLensSegment[] = [];
    for (const rawSeg of rawSegments) {
      // Check for empty segments
      const emptyWarning = checkEmptySegment(rawSeg, file);
      if (emptyWarning) {
        errors.push(emptyWarning);
      }

      // Validate that fields are appropriate for this segment type
      const fieldWarnings = validateSegmentFields(rawSeg.type, rawSeg.fields, file, rawSeg.line);
      errors.push(...fieldWarnings);

      // Validate field values (e.g., boolean fields should have 'true' or 'false')
      const valueWarnings = validateFieldValues(rawSeg.fields, file, rawSeg.line);
      errors.push(...valueWarnings);

      const { segment, errors: conversionErrors } = convertSegment(rawSeg, outputType, file);
      errors.push(...conversionErrors);
      if (segment) {
        segments.push(segment);
      }
    }

    // Warn if section has no segments
    if (segments.length === 0) {
      errors.push({
        file,
        line: rawSection.line,
        message: `${rawSection.rawType} section has no segments`,
        suggestion: `Add at least one segment (#### Text, #### Chat, etc.) to the ${rawSection.rawType.toLowerCase()} section`,
        severity: 'warning',
      });
    }

    const parsedSection: ParsedLensSection = {
      type: outputType,
      title: rawSection.title,
      source: source,
      segments,
      line: rawSection.line,
    };

    parsedSections.push(parsedSection);
  }

  const lens: ParsedLens = {
    id: frontmatter.id as string,
    sections: parsedSections,
  };

  return { lens, errors };
}
