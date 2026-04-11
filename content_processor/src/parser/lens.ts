// @ts-ignore - node:child_process might not be found by IDE if types aren't installed
import { execSync } from 'node:child_process';
import type { ContentError } from '../index.js';
import { parseFrontmatter } from './frontmatter.js';
import { validateSegmentFields } from '../validator/segment-fields.js';
import { validateFieldValues } from '../validator/field-values.js';
import { detectFieldTypos } from '../validator/field-typos.js';
import { validateFrontmatter } from '../validator/validate-frontmatter.js';
import { detectDirectivesInNonArticle } from '../validator/directives.js';
import { parseWikilink, hasRelativePath } from './wikilink.js';
import { parseSections } from './sections.js';
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
  toTimeStr?: string;      // Timestamp string like "5:45" (undefined = full video)
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

export interface ParsedEmbedSegment {
  type: 'embed';
  url: string;
  contextUrl?: string;
  height?: string;
  width?: string;
  aspectRatio?: string;
  summary?: string;
  sandbox?: string;
  cachedContent?: string;
  optional?: boolean;
}

export type ParsedLensSegment =
  | ParsedTextSegment
  | ParsedChatSegment
  | ParsedArticleSegment
  | ParsedVideoSegment
  | ParsedQuestionSegment
  | ParsedRoleplaySegment
  | ParsedEmbedSegment;

export interface ParsedLens {
  id: string;
  title?: string;
  tldr?: string;
  summaryForTutor?: string;
  segments: ParsedLensSegment[];
}

export interface LensParseResult {
  lens: ParsedLens | null;
  errors: ContentError[];
}

// Valid segment types for lens H4 headers
export const LENS_SEGMENT_TYPES = new Set(['text', 'chat', 'article', 'video', 'question', 'roleplay', 'embed']);

/** Common interface for raw segments — compatible with ParsedSection */
export interface RawSegment {
  type: string;
  title?: string;
  fields: Record<string, string>;
  line: number;
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
      if (raw.title) {
        const capitalized = raw.type[0].toUpperCase() + raw.type.slice(1);
        errors.push({
          file,
          line: raw.line,
          message: `Titles are not supported for ${capitalized} segments — use just '#### ${capitalized}'. Set the lens title in frontmatter instead (title: ...)`,
          suggestion: `Remove the title after '${capitalized}:'`,
          severity: 'error',
        });
      }

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
      if (raw.title) {
        const capitalized = raw.type[0].toUpperCase() + raw.type.slice(1);
        errors.push({
          file,
          line: raw.line,
          message: `Titles are not supported for ${capitalized} segments — use just '#### ${capitalized}'. Set the lens title in frontmatter instead (title: ...)`,
          suggestion: `Remove the title after '${capitalized}:'`,
          severity: 'error',
        });
      }

      const fromField = raw.fields.from;
      const toField = raw.fields.to;
      const sourceField = raw.fields.source;

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
      if (toField && parseTimestamp(toField) === null) {
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
        toTimeStr: toField || undefined,
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

    case 'embed': {
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

      const url = raw.fields['url'];
      if (!url || url.trim() === '') {
        errors.push({
          file,
          line: raw.line,
          message: 'Embed segment missing url:: field',
          suggestion: "Add 'url:: https://...' to the embed segment",
          severity: 'error',
        });
        return { segment: null, errors };
      }

      const summary = raw.fields['summary']?.trim();
      const contextUrl = raw.fields['context-url']?.trim() || url.trim();

      // Synchronously fetch and extract content + metadata for the AI Tutor
      let cachedContent = '';
      try {
        // Advanced scraper: Extract title and meta tags, then strip NOISE (SVGs, Styles)
        // We use contextUrl if provided, otherwise fall back to the main url.
        const fetchScript = `
          fetch('${contextUrl}')
            .then(res => {
              if (!res.ok) throw new Error('HTTP ' + res.status);
              return res.text();
            })
            .then(html => {
              const titleMatch = html.match(/<title[^>]*>(.*?)<\\/title>/i);
              const title = titleMatch ? titleMatch[1] : '';
              
              const metaDescMatch = html.match(/<meta\\s+name=["']description["']\\s+content=["'](.*?)["']/i);
              const ogDescMatch = html.match(/<meta\\s+property=["']og:description["']\\s+content=["'](.*?)["']/i);
              const description = ogDescMatch ? ogDescMatch[1] : (metaDescMatch ? metaDescMatch[1] : '');

              // Deep Data Harvesting (Specific to AI Chronicle EV array)
              let deepData = '';
              const evMatch = html.match(/const\\s+EV\\s*=\\s*(\\[.*?\\]);/i);
              if (evMatch) {
                try {
                  const evContent = evMatch[1];
                  // More flexible regex to handle unquoted JS keys like t: and desc:
                  const titles = [...evContent.matchAll(/t:"(.*?)"/g)].map(m => m[1]);
                  const descs = [...evContent.matchAll(/desc:"(.*?)"/g)].map(m => m[1]);

                  deepData = titles.map((t, i) => {
                    const desc = descs[i] || '';
                    const cleanT = t.replace(/\\\\u([0-9a-fA-F]{4})/g, (_, c) => String.fromCharCode(parseInt(c, 16)));
                    const cleanDesc = desc.replace(/\\\\u([0-9a-fA-F]{4})/g, (_, c) => String.fromCharCode(parseInt(c, 16)));
                    return '• ' + cleanT + ': ' + cleanDesc;
                  }).join('\\n');
                } catch (e) {}
              }

              // Aggressive Noise Stripping for Premium Context
              const cleanHtml = html
                .replace(/<style[^>]*>.*?<\\/style>/gis, ' ')
                .replace(/<script[^>]*>.*?<\\/script>/gis, ' ')
                .replace(/<svg[^>]*>.*?<\\/svg>/gis, ' ')
                .replace(/<path[^>]*>.*?<\\/path>/gis, ' ')
                .replace(/<circle[^>]*>.*?<\\/circle>/gis, ' ')
                .replace(/<rect[^>]*>.*?<\\/rect>/gis, ' ');

              const body = cleanHtml
                .replace(/<[^>]*>?/gm, ' ')
                .replace(/\\s+/g, ' ')
                .trim();
              
              const output = [
                title ? 'TITLE: ' + title : '',
                description ? 'DESCRIPTION: ' + description : '',
                deepData ? 'TIMELINE DATA (Extracted from Source Code):\\n' + deepData : '',
                body ? 'BODY: ' + body : ''
              ].filter(Boolean).join('\\n\\n');

              process.stdout.write(output.substring(0, 50000));
            })
            .catch(err => {
              process.stderr.write('Scraper error: ' + err.message);
            });
        `.replace(/\n/g, ' ');

        cachedContent = execSync(`node -e "${fetchScript}"`, { 
          encoding: 'utf8', 
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' }
        }).trim();
        
        if (cachedContent) {
          console.log(`[Embed Scraper] Successfully extracted context for ${contextUrl} (Length: ${cachedContent.length})`);
        }
      } catch (e) {
        // Graceful degradation
      }

      // Combine summary with cached content if both exist
      const finalCachedContent = summary 
        ? `CREATOR SUMMARY: ${summary}\n\nEXTRACTED CONTENT:\n${cachedContent}`
        : cachedContent;

      const segment: ParsedEmbedSegment = {
        type: 'embed',
        url: url.trim(),
        contextUrl: raw.fields['context-url']?.trim() || undefined,
        height: raw.fields['height']?.trim() || undefined,
        width: raw.fields['width']?.trim() || undefined,
        aspectRatio: raw.fields['aspect-ratio']?.trim() || undefined,
        summary,
        sandbox: raw.fields['sandbox']?.trim() || undefined,
        cachedContent: finalCachedContent || undefined,
        optional: raw.fields.optional?.toLowerCase() === 'true' ? true : undefined,
      };

      return { segment, errors };
    }

    default:
      // Unknown segment type - error already reported during parseSections
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

  const title = typeof frontmatter.title === 'string' ? frontmatter.title : undefined;
  const tldr = typeof frontmatter.tldr === 'string' ? frontmatter.tldr : undefined;
  const summaryForTutor = typeof frontmatter.summary_for_tutor === 'string' ? frontmatter.summary_for_tutor : undefined;
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

  // Step 2: Parse segments from body (flat mode — all segment headers are siblings)
  const { sections: rawSegments, errors: segmentErrors } = parseSections(
    body,
    3,  // parentLevel=3 for standalone lens files → matches H4+ (backward compat)
    LENS_SEGMENT_TYPES,
    file,
    true  // flat=true — segments are always siblings
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
    title,
    tldr,
    summaryForTutor,
    segments: parsedSegments,
  };

  return { lens, errors };
}
