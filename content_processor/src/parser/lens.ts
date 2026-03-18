// src/parser/lens.ts
import type { ContentError } from '../index.js';
import { ALL_KNOWN_FIELDS } from '../content-schema.js';
import { parseFrontmatter } from './frontmatter.js';
import { validateSegmentFields } from '../validator/segment-fields.js';
import { validateFieldValues } from '../validator/field-values.js';
import { detectFieldTypos } from '../validator/field-typos.js';
import { validateFrontmatter } from '../validator/validate-frontmatter.js';
import { detectDirectivesInNonArticle } from '../validator/directives.js';
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
  instructions?: string;
  hidePreviousContentFromUser?: boolean;
  hidePreviousContentFromTutor?: boolean;
  optional?: boolean;
}

export interface ParsedArticleSegment {
  type: 'article';
  source?: string;         // Raw wikilink (from source:: field or inherited)
  resolvedPath?: string;   // Resolved source path
  fromAnchor?: string;     // Text anchor (start) - undefined means start of article
  toAnchor?: string;       // Text anchor (end) - undefined means end of article
  optional?: boolean;
}

export interface ParsedVideoSegment {
  type: 'video';
  source?: string;         // Raw wikilink (from source:: field or inherited)
  resolvedPath?: string;   // Resolved source path
  fromTimeStr: string;     // Timestamp string like "1:30"
  toTimeStr: string;       // Timestamp string like "5:45"
  optional?: boolean;
}

export interface ParsedQuestionSegment {
  type: 'question';
  content: string;
  assessmentInstructions?: string;
  maxTime?: string;        // e.g., "3:00" or "none"
  maxChars?: number;
  enforceVoice?: boolean;
  optional?: boolean;
  feedback?: boolean;
}

export interface ParsedRoleplaySegment {
  type: 'roleplay';
  id: string;                     // UUID for session isolation
  content: string;                // Student-facing scenario briefing
  aiInstructions: string;         // Character behavior + personality
  openingMessage?: string;        // Optional first message
  assessmentInstructions?: string;  // Optional scoring rubric
  optional?: boolean;
  feedback?: boolean;
}

export type ParsedLensSegment =
  | ParsedTextSegment
  | ParsedChatSegment
  | ParsedArticleSegment
  | ParsedVideoSegment
  | ParsedQuestionSegment
  | ParsedRoleplaySegment;

export interface ParsedLens {
  id: string;
  tldr?: string;
  segments: ParsedLensSegment[];
}

export interface LensParseResult {
  lens: ParsedLens | null;
  errors: ContentError[];
}

// Valid segment types for lens H4 headers
const LENS_SEGMENT_TYPES = new Set(['text', 'chat', 'article', 'video', 'question', 'roleplay']);

// H4 segment header pattern: #### <type> or #### <type>: <title>
const SEGMENT_HEADER_PATTERN = /^####\s+([^:\s]+)(?::\s*(.*?))?\s*$/i;

// Field pattern: fieldname:: value
const FIELD_PATTERN = /^([\w-]+)::\s*(.*)$/;

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
export function parseSegments(
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
      const singleColonMatch = line.match(/^([\w-]+):\s+(.*)$/);
      if (singleColonMatch && !line.match(/^https?:/) && !FIELD_PATTERN.test(line) && ALL_KNOWN_FIELDS.includes(singleColonMatch[1])) {
        errors.push({
          file,
          line: lineNum,
          message: `Found '${singleColonMatch[1]}:' with single colon — did you mean '${singleColonMatch[1]}::'?`,
          suggestion: `Change '${singleColonMatch[1]}:' to '${singleColonMatch[1]}::' (double colon)`,
          severity: 'error',
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
export function convertSegment(
  raw: RawSegment,
  sectionType: string,
  file: string
): { segment: ParsedLensSegment | null; errors: ContentError[] } {
  const errors: ContentError[] = [];

  switch (raw.type) {
    case 'text': {
      if (raw.title) {
        const capitalized = raw.type[0].toUpperCase() + raw.type.slice(1);
        errors.push({
          file,
          line: raw.line,
          message: `Titles are not supported for ${capitalized} segments — use just '#### ${capitalized}'`,
          suggestion: `Remove the title after '${capitalized}:'`,
          severity: 'error',
        });
      }

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

      // Warn if directives are used in lens text segments (they only render in articles)
      const directiveWarnings = detectDirectivesInNonArticle(content, file, raw.line);
      errors.push(...directiveWarnings);

      const segment: ParsedTextSegment = {
        type: 'text',
        content,
        optional: raw.fields.optional?.toLowerCase() === 'true' ? true : undefined,
      };
      return { segment, errors };
    }

    case 'chat': {
      if (raw.title) {
        const capitalized = raw.type[0].toUpperCase() + raw.type.slice(1);
        errors.push({
          file,
          line: raw.line,
          message: `Titles are not supported for ${capitalized} segments — use just '#### ${capitalized}'`,
          suggestion: `Remove the title after '${capitalized}:'`,
          severity: 'error',
        });
      }

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
        instructions: instructions || '',
        hidePreviousContentFromUser: raw.fields.hidePreviousContentFromUser?.toLowerCase() === 'true' ? true : undefined,
        hidePreviousContentFromTutor: raw.fields.hidePreviousContentFromTutor?.toLowerCase() === 'true' ? true : undefined,
        optional: raw.fields.optional?.toLowerCase() === 'true' ? true : undefined,
      };
      return { segment, errors };
    }

    case 'article': {
      const fromField = raw.fields.from;
      const toField = raw.fields.to;
      const sourceField = raw.fields.source;

      // Both from:: and to:: are optional for article:
      // - Only from:: -> extract from anchor to end of article
      // - Only to:: -> extract from start to anchor
      // - Neither -> extract entire article

      // Strip quotes from anchor text if present
      const fromAnchor = fromField ? stripQuotes(fromField) : undefined;
      const toAnchor = toField ? stripQuotes(toField) : undefined;

      // Validate source:: wikilink if present
      if (sourceField) {
        const wikilink = parseWikilink(sourceField);
        if (wikilink && wikilink.error) {
          const suggestion = wikilink.correctedPath
            ? `Did you mean '[[${wikilink.correctedPath}]]'?`
            : 'Check the path in the wikilink';
          errors.push({
            file,
            line: raw.line,
            message: `Invalid wikilink in source:: field: ${sourceField}`,
            suggestion,
            severity: 'error',
          });
        } else if (wikilink && !hasRelativePath(wikilink.path)) {
          errors.push({
            file,
            line: raw.line,
            message: `source:: path must be relative (contain /): ${wikilink.path}`,
            suggestion: 'Use format [[../path/to/file.md|Display]] with relative path',
            severity: 'error',
          });
        }
      }

      const segment: ParsedArticleSegment = {
        type: 'article',
        source: sourceField,
        fromAnchor,
        toAnchor,
        optional: raw.fields.optional?.toLowerCase() === 'true' ? true : undefined,
      };
      return { segment, errors };
    }

    case 'video': {
      const fromField = raw.fields.from;
      const toField = raw.fields.to;
      const sourceField = raw.fields.source;

      // to:: is required, from:: defaults to "0:00"
      if (!toField) {
        errors.push({
          file,
          line: raw.line,
          message: 'Video segment missing to:: field',
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

      // Validate source:: wikilink if present
      if (sourceField) {
        const wikilink = parseWikilink(sourceField);
        if (wikilink && wikilink.error) {
          const suggestion = wikilink.correctedPath
            ? `Did you mean '[[${wikilink.correctedPath}]]'?`
            : 'Check the path in the wikilink';
          errors.push({
            file,
            line: raw.line,
            message: `Invalid wikilink in source:: field: ${sourceField}`,
            suggestion,
            severity: 'error',
          });
        } else if (wikilink && !hasRelativePath(wikilink.path)) {
          errors.push({
            file,
            line: raw.line,
            message: `source:: path must be relative (contain /): ${wikilink.path}`,
            suggestion: 'Use format [[../path/to/file.md|Display]] with relative path',
            severity: 'error',
          });
        }
      }

      const segment: ParsedVideoSegment = {
        type: 'video',
        source: sourceField,
        fromTimeStr: fromField || '0:00',  // Default to start of video
        toTimeStr: toField,
        optional: raw.fields.optional?.toLowerCase() === 'true' ? true : undefined,
      };
      return { segment, errors };
    }

    case 'question': {
      const content = raw.fields['content'];
      if (!content || content.trim() === '') {
        errors.push({
          file,
          line: raw.line,
          message: 'Question segment missing content:: field',
          suggestion: "Add 'content:: Your question here'",
          severity: 'error',
        });
        return { segment: null, errors };
      }

      const segment: ParsedQuestionSegment = {
        type: 'question',
        content,
        assessmentInstructions: raw.fields['assessment-instructions'] || undefined,
        maxTime: raw.fields['max-time'] || undefined,
        maxChars: raw.fields['max-chars'] ? parseInt(raw.fields['max-chars'], 10) : undefined,
        enforceVoice: raw.fields['enforce-voice']?.toLowerCase() === 'true' ? true : undefined,
        optional: raw.fields.optional?.toLowerCase() === 'true' ? true : undefined,
        feedback: raw.fields['feedback']?.toLowerCase() === 'true' ? true : undefined,
      };
      return { segment, errors };
    }

    case 'roleplay': {
      const id = raw.fields['id'];
      if (!id || id.trim() === '') {
        errors.push({
          file,
          line: raw.line,
          message: 'Roleplay segment missing id:: field',
          suggestion: "Add 'id:: <uuid>' to the roleplay segment",
          severity: 'error',
        });
      }

      const content = raw.fields['content'];
      if (!content || content.trim() === '') {
        errors.push({
          file,
          line: raw.line,
          message: 'Roleplay segment missing content:: field',
          suggestion: "Add 'content:: Your scenario briefing here'",
          severity: 'error',
        });
      }

      const aiInstructions = raw.fields['ai-instructions'];
      if (!aiInstructions || aiInstructions.trim() === '') {
        errors.push({
          file,
          line: raw.line,
          message: 'Roleplay segment missing ai-instructions:: field',
          suggestion: "Add 'ai-instructions:: Character behavior description'",
          severity: 'error',
        });
      }

      if (!id || id.trim() === '' || !content || content.trim() === '' || !aiInstructions || aiInstructions.trim() === '') {
        return { segment: null, errors };
      }

      const segment: ParsedRoleplaySegment = {
        type: 'roleplay',
        id,
        content,
        aiInstructions,
        openingMessage: raw.fields['opening-message'] || undefined,
        assessmentInstructions: raw.fields['assessment-instructions'] || undefined,
        optional: raw.fields.optional?.toLowerCase() === 'true' ? true : undefined,
        feedback: raw.fields['feedback']?.toLowerCase() === 'true' ? true : undefined,
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
 * Note: article with no fields is valid (means entire article, source inherited).
 */
function checkEmptySegment(raw: RawSegment, file: string): ContentError | null {
  // A segment is empty if it has no fields at all
  const fieldCount = Object.keys(raw.fields).length;

  // article with no fields is valid - means "include entire article" (source inherited)
  if (raw.type === 'article' && fieldCount === 0) {
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
 * Strip Obsidian %% comments %% from content.
 * Handles both inline (%% ... %% on same line) and block (multiline) comments.
 */
export function stripObsidianComments(content: string): string {
  return content.replace(/%%.*?%%/gs, '');
}

/**
 * Strip CriticMarkup from content using reject-all-changes behavior:
 * - {>>comments<<} -> removed
 * - {++additions++} -> removed
 * - {--deletions--} -> inner content kept (original preserved)
 * - {~~old~>new~~} -> old text kept
 * - {==highlights==} -> inner content kept, markers removed
 */
export function stripCriticMarkup(content: string): string {
  return content
    .replace(/\{>>.*?<<\}/gs, '')                          // Comments -> remove
    .replace(/\{\+\+.*?\+\+\}/gs, '')                      // Additions -> remove
    .replace(/\{--(?:\{[^}]*\}@@)?(.*?)--\}/gs, '$1')      // Deletions -> keep inner (skip metadata)
    .replace(/\{~~(?:\{[^}]*\}@@)?(.*?)~>.*?~~\}/gs, '$1') // Substitutions -> keep old (skip metadata)
    .replace(/\{==(?:\{[^}]*\}@@)?(.*?)==\}/gs, '$1');      // Highlights -> keep inner (skip metadata)
}

/**
 * Strip all authoring markup (CriticMarkup + Obsidian comments) from content.
 * Call at the top of each parser before any processing.
 */
export function stripAuthoringMarkup(content: string): string {
  const stripped = stripObsidianComments(stripCriticMarkup(content));
  // Trim trailing whitespace left by inline markup removal
  return stripped.split('\n').map(line => line.trimEnd()).join('\n');
}

/**
 * Apply source inheritance for article and video segments.
 * Each article/video segment inherits source:: from the previous segment of the same type.
 * Errors if the first segment of a type has no source.
 *
 * Mutates segments in place. Returns any errors.
 */
export function applySourceInheritance(
  segments: ParsedLensSegment[],
  file: string
): ContentError[] {
  const errors: ContentError[] = [];
  let lastArticleSource: string | undefined;
  let lastVideoSource: string | undefined;
  for (const seg of segments) {
    if (seg.type === 'article') {
      if (seg.source) {
        lastArticleSource = seg.source;
      } else if (lastArticleSource) {
        seg.source = lastArticleSource;
      } else {
        errors.push({
          file,
          message: 'First article segment must have a source:: field',
          severity: 'error',
        });
      }
    } else if (seg.type === 'video') {
      if (seg.source) {
        lastVideoSource = seg.source;
      } else if (lastVideoSource) {
        seg.source = lastVideoSource;
      } else {
        errors.push({
          file,
          message: 'First video segment must have a source:: field',
          severity: 'error',
        });
      }
    }
  }
  return errors;
}

/**
 * Parse a lens file into structured lens data.
 *
 * Lens files are flat: frontmatter + H4 segments directly.
 * No H3 section headers. Source is on segments with inheritance.
 */
export function parseLens(content: string, file: string): LensParseResult {
  const errors: ContentError[] = [];

  // Strip authoring markup (CriticMarkup + Obsidian comments) before parsing
  content = stripAuthoringMarkup(content);

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

  const tldr = typeof frontmatter.tldr === 'string' ? frontmatter.tldr : undefined;
  if (tldr) {
    const wordCount = tldr.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount > 80) {
      errors.push({
        file,
        line: 2,
        message: `tldr exceeds 80 words (has ${wordCount})`,
        suggestion: 'Shorten the tldr to 80 words or fewer',
        severity: 'error',
      });
    }
  }

  // Step 2: Parse H4 segments directly from body (flat, no H3 sections)
  const { segments: rawSegments, errors: segmentErrors } = parseSegments(
    body,
    bodyStartLine,
    file
  );
  errors.push(...segmentErrors);

  // Step 3: Convert raw segments to typed segments + validate
  const parsedSegments: ParsedLensSegment[] = [];
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

    const { segment, errors: conversionErrors } = convertSegment(rawSeg, 'lens', file);
    errors.push(...conversionErrors);
    if (segment) {
      parsedSegments.push(segment);
    }
  }

  // Step 4: Source inheritance for article and video segments
  const inheritanceErrors = applySourceInheritance(parsedSegments, file);
  errors.push(...inheritanceErrors);

  // Warn if lens has no segments
  if (parsedSegments.length === 0) {
    errors.push({
      file,
      line: bodyStartLine,
      message: 'Lens has no segments',
      suggestion: 'Add at least one segment (#### Text, #### Chat, etc.)',
      severity: 'warning',
    });
  }

  const lens: ParsedLens = {
    id: frontmatter.id as string,
    tldr,
    segments: parsedSegments,
  };

  return { lens, errors };
}
