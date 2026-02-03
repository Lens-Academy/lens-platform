// src/parser/lens.ts
import type { ContentError } from '../index.js';
import { parseFrontmatter } from './frontmatter.js';
import { parseSections, LENS_SECTION_TYPES, LENS_OUTPUT_TYPE } from './sections.js';

// Segment types for parsed lens content (before bundling/flattening)
export interface ParsedTextSegment {
  type: 'text';
  content: string;
  optional?: boolean;
}

export interface ParsedChatSegment {
  type: 'chat';
  instructions?: string;
  hidePreviousContentFromUser?: boolean;
  hidePreviousContentFromTutor?: boolean;
  optional?: boolean;
}

export interface ParsedArticleExcerptSegment {
  type: 'article-excerpt';
  fromAnchor: string;   // Text anchor (start)
  toAnchor: string;     // Text anchor (end)
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

// H4 segment header pattern: #### <type>
const SEGMENT_HEADER_PATTERN = /^####\s+([^\n:]+)$/i;

// Field pattern: fieldname:: value
const FIELD_PATTERN = /^(\w+)::\s*(.*)$/;

interface RawSegment {
  type: string;
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

function parseFieldsIntoSegment(segment: RawSegment, lines: string[]): void {
  for (const line of lines) {
    const match = line.match(FIELD_PATTERN);
    if (match) {
      segment.fields[match[1]] = match[2];
    }
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
      const content = raw.fields.content;
      if (!content) {
        errors.push({
          file,
          line: raw.line,
          message: 'Text segment missing content:: field',
          suggestion: "Add 'content:: Your text here' to the text segment",
          severity: 'error',
        });
        return { segment: null, errors };
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

      if (!fromField) {
        errors.push({
          file,
          line: raw.line,
          message: 'Article-excerpt segment missing from:: field',
          suggestion: "Add 'from:: \"anchor text\"' to the segment",
          severity: 'error',
        });
      }
      if (!toField) {
        errors.push({
          file,
          line: raw.line,
          message: 'Article-excerpt segment missing to:: field',
          suggestion: "Add 'to:: \"anchor text\"' to the segment",
          severity: 'error',
        });
      }

      if (!fromField || !toField) {
        return { segment: null, errors };
      }

      // Strip quotes from anchor text
      const fromAnchor = stripQuotes(fromField);
      const toAnchor = stripQuotes(toField);

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

      if (!fromField) {
        errors.push({
          file,
          line: raw.line,
          message: 'Video-excerpt segment missing from:: field',
          suggestion: "Add 'from:: M:SS' or 'from:: H:MM:SS' to the segment",
          severity: 'error',
        });
      }
      if (!toField) {
        errors.push({
          file,
          line: raw.line,
          message: 'Video-excerpt segment missing to:: field',
          suggestion: "Add 'to:: M:SS' or 'to:: H:MM:SS' to the segment",
          severity: 'error',
        });
      }

      if (!fromField || !toField) {
        return { segment: null, errors };
      }

      const segment: ParsedVideoExcerptSegment = {
        type: 'video-excerpt',
        fromTimeStr: fromField,
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
      const { segment, errors: conversionErrors } = convertSegment(rawSeg, outputType, file);
      errors.push(...conversionErrors);
      if (segment) {
        segments.push(segment);
      }
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
