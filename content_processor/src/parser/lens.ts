// src/parser/lens.ts
import type { ContentError } from '../index.js';
import { parseFrontmatter } from './frontmatter.js';
import { parseSections, LENS_SECTION_TYPES, LENS_OUTPUT_TYPE } from './sections.js';
import { validateSegmentFields } from '../validator/segment-fields.js';
import { validateFieldValues } from '../validator/field-values.js';
import { detectFieldTypos } from '../validator/field-typos.js';
import { validateFrontmatter } from '../validator/validate-frontmatter.js';
import { parseWikilink, hasRelativePath } from './wikilink.js';
import { parseTimestamp } from '../bundler/video.js';

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


// Valid segment types per section output type
const VALID_SEGMENTS_PER_SECTION: Record<string, Set<string>> = {
  'page': new Set(['text', 'chat']),
  'lens-article': new Set(['text', 'chat', 'article-excerpt']),
  'lens-video': new Set(['text', 'chat', 'video-excerpt']),
};
// H4 segment header pattern: #### <type> or #### <type>: <title>
const SEGMENT_HEADER_PATTERN = /^####\s+([^:\s]+)(?::\s*(.*))?$/i;

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
  let preSegmentWarned = false;

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
      // Check for single-colon field that should be double-colon
      const singleColonMatch = line.match(/^(\w+):\s+(.*)$/);
      if (singleColonMatch && !line.match(/^https?:/) && !FIELD_PATTERN.test(line)) {
        errors.push({
          file,
          line: lineNum,
          message: `Found '${singleColonMatch[1]}:' with single colon — did you mean '${singleColonMatch[1]}::'?`,
          suggestion: `Change '${singleColonMatch[1]}:' to '${singleColonMatch[1]}::' (double colon)`,
          severity: 'warning',
        });
      }
      currentFieldLines.push(line);
    } else {
      // No segment started yet — check for free text (not fields, not blank)
      if (line.trim() && !FIELD_PATTERN.test(line) && !preSegmentWarned) {
        preSegmentWarned = true;
        errors.push({
          file,
          line: lineNum,
          message: 'Text before first segment header (####) will be ignored',
          suggestion: 'Move this text into a segment (e.g., #### Text with content:: field), or remove it',
          severity: 'warning',
        });
      }
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
          optional: raw.fields.optional?.toLowerCase() === 'true' ? true : undefined,
        };
        return { segment, errors };
      }

      const segment: ParsedTextSegment = {
        type: 'text',
        content,
        optional: raw.fields.optional?.toLowerCase() === 'true' ? true : undefined,
      };
      return { segment, errors };
    }

    case 'chat': {
      const hasInstructionsField = 'instructions' in raw.fields;
      const instructions = raw.fields.instructions;

      if (!hasInstructionsField) {
        // Field completely missing - error
        errors.push({
          file,
          line: raw.line,
          message: 'Chat segment missing instructions:: field',
          suggestion: "Add 'instructions:: Your instructions here' to the chat segment",
          severity: 'error',
        });
        return { segment: null, errors };
      }

      if (!instructions || instructions.trim() === '') {
        // Field present but empty - warning
        errors.push({
          file,
          line: raw.line,
          message: 'Chat segment has empty instructions:: field',
          suggestion: 'Add instructions text after instructions::',
          severity: 'warning',
        });
        // Still create the segment with empty instructions
      }

      const segment: ParsedChatSegment = {
        type: 'chat',
        title: raw.title,
        instructions: instructions || '',
        hidePreviousContentFromUser: raw.fields.hidePreviousContentFromUser?.toLowerCase() === 'true' ? true : undefined,
        hidePreviousContentFromTutor: raw.fields.hidePreviousContentFromTutor?.toLowerCase() === 'true' ? true : undefined,
        optional: raw.fields.optional?.toLowerCase() === 'true' ? true : undefined,
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
        optional: raw.fields.optional?.toLowerCase() === 'true' ? true : undefined,
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


      // Validate timestamp formats at parse time for better error reporting
      const fromStr = fromField || '0:00';
      if (parseTimestamp(fromStr) === null) {
        errors.push({
          file,
          line: raw.line,
          message: `Invalid timestamp format in from:: field: '${fromStr}'`,
          suggestion: "Expected format: M:SS (e.g., 1:30) or H:MM:SS (e.g., 1:30:00)",
          severity: 'warning',
        });
      }
      if (parseTimestamp(toField) === null) {
        errors.push({
          file,
          line: raw.line,
          message: `Invalid timestamp format in to:: field: '${toField}'`,
          suggestion: "Expected format: M:SS (e.g., 5:45) or H:MM:SS (e.g., 1:30:00)",
          severity: 'warning',
        });
      }
      const segment: ParsedVideoExcerptSegment = {
        type: 'video-excerpt',
        fromTimeStr: fromField || '0:00',  // Default to start of video
        toTimeStr: toField,
        optional: raw.fields.optional?.toLowerCase() === 'true' ? true : undefined,
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

  const frontmatterErrors = validateFrontmatter(frontmatter, 'lens', file);
  errors.push(...frontmatterErrors);

  if (frontmatterErrors.some(e => e.severity === 'error')) {
    return { lens: null, errors };
  }

  // Lens-specific: id must be a string (YAML might parse UUIDs as numbers)
  if (typeof frontmatter.id !== 'string') {
    errors.push({
      file,
      line: 2,
      message: `Field 'id' must be a string, got ${typeof frontmatter.id}`,
      suggestion: "Use quotes: id: '12345'",
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

    // Validate source:: path is relative (contains /)
    if (source) {
      const wikilink = parseWikilink(source);
      if (wikilink && wikilink.error) {
        const suggestion = wikilink.correctedPath
          ? `Did you mean '[[${wikilink.correctedPath}]]'?`
          : 'Check the path in the wikilink';
        errors.push({
          file,
          line: rawSection.line,
          message: `Invalid wikilink in source:: field: ${source}`,
          suggestion,
          severity: 'error',
        });
      } else if (wikilink && !hasRelativePath(wikilink.path)) {
        errors.push({
          file,
          line: rawSection.line,
          message: `source:: path must be relative (contain /): ${wikilink.path}`,
          suggestion: 'Use format [[../path/to/file.md|Display]] with relative path',
          severity: 'error',
        });
      }
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

      // Detect likely typos in field names
      const typoWarnings = detectFieldTypos(rawSeg.fields, file, rawSeg.line);
      errors.push(...typoWarnings);


      // Check segment/section type compatibility
      const validSegs = VALID_SEGMENTS_PER_SECTION[outputType];
      if (validSegs && !validSegs.has(rawSeg.type)) {
        errors.push({
          file,
          line: rawSeg.line,
          message: `Segment type '${rawSeg.type}' is not valid in a ${rawSection.rawType} section`,
          suggestion: `Valid segment types for ${rawSection.rawType}: ${[...(validSegs)].join(', ')}`,
          severity: 'warning',
        });
      }
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

  // Check for conflicting section types (Article + Video is nonsensical)
  const sourceTypes = new Set(
    parsedSections.map(s => s.type).filter(t => t !== 'page')
  );
  if (sourceTypes.size > 1) {
    const typeList = [...sourceTypes].join(', ');
    errors.push({
      file,
      line: parsedSections[0]?.line ?? bodyStartLine,
      message: `Lens has conflicting section types: ${typeList}. Each lens should use a single source type.`,
      suggestion: 'Split into separate lens files, one per source type',
      severity: 'warning',
    });
  }

  const lens: ParsedLens = {
    id: frontmatter.id as string,
    sections: parsedSections,
  };

  return { lens, errors };
}
