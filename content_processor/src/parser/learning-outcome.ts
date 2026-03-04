// src/parser/learning-outcome.ts
import type { ContentError } from '../index.js';
import { parseFrontmatter } from './frontmatter.js';
import { parseSections, LO_SECTION_TYPES, type ParsedSection } from './sections.js';
import { parseWikilink, resolveWikilinkPath, hasRelativePath } from './wikilink.js';
import { detectFieldTypos } from '../validator/field-typos.js';
import { validateFrontmatter } from '../validator/validate-frontmatter.js';
import { parseSegments, convertSegment, stripAuthoringMarkup, type ParsedLensSegment } from './lens.js';

export interface ParsedLensRef {
  source: string;       // Raw wikilink
  resolvedPath: string; // Resolved file path
  optional: boolean;
}

export interface ParsedTestRef {
  source?: string;           // Optional external file reference
  resolvedPath?: string;     // Resolved path if source provided
  segments: ParsedLensSegment[];  // Inline question/chat/text segments
}

export interface ParsedSubmoduleGroup {
  title: string;
  customSlug?: string;
  lenses: ParsedLensRef[];
  test?: ParsedTestRef;
}

export interface ParsedLearningOutcome {
  id: string;
  lenses: ParsedLensRef[];
  test?: ParsedTestRef;
  discussion?: string;
  submodules?: ParsedSubmoduleGroup[];
}

export interface LearningOutcomeParseResult {
  learningOutcome: ParsedLearningOutcome | null;
  errors: ContentError[];
}

export function parseLearningOutcome(content: string, file: string): LearningOutcomeParseResult {
  const errors: ContentError[] = [];

  // Strip authoring markup (CriticMarkup + Obsidian comments) before parsing
  content = stripAuthoringMarkup(content);

  // Step 1: Parse frontmatter and validate id field
  const frontmatterResult = parseFrontmatter(content, file);
  if (frontmatterResult.error) {
    errors.push(frontmatterResult.error);
    return { learningOutcome: null, errors };
  }

  const { frontmatter, body, bodyStartLine } = frontmatterResult;

  const frontmatterErrors = validateFrontmatter(frontmatter, 'learning-outcome', file);
  errors.push(...frontmatterErrors);

  if (frontmatterErrors.some(e => e.severity === 'error')) {
    return { learningOutcome: null, errors };
  }

  // LO-specific: id must be a string
  if (typeof frontmatter.id !== 'string') {
    errors.push({
      file,
      line: 2,
      message: `Field 'id' must be a string, got ${typeof frontmatter.id}`,
      suggestion: "Use quotes: id: '12345'",
      severity: 'error',
    });
    return { learningOutcome: null, errors };
  }

  // Step 2: Parse sections with H2 level and LO_SECTION_TYPES + 'submodule'
  const loSectionTypes = new Set([...LO_SECTION_TYPES, 'submodule']);
  const sectionsResult = parseSections(body, 2, loSectionTypes, file);

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

  // Helper: extract a lens ref from a parsed section
  function extractLensRef(section: ParsedSection): ParsedLensRef | null {
    const typoWarnings = detectFieldTypos(section.fields, file, section.line);
    errors.push(...typoWarnings);

    const source = section.fields.source;
    if (!source) {
      errors.push({
        file,
        line: section.line,
        message: 'Lens section missing source:: field',
        suggestion: "Add 'source:: [[../Lenses/filename.md|Display]]' to the lens section",
        severity: 'error',
      });
      return null;
    }

    const wikilink = parseWikilink(source);
    if (!wikilink || wikilink.error) {
      const suggestion = wikilink?.correctedPath
        ? `Did you mean '[[${wikilink.correctedPath}]]'?`
        : 'Use format [[../Lenses/filename.md|Display Text]]';
      errors.push({
        file,
        line: section.line,
        message: wikilink?.error
          ? `${wikilink.error} in source:: field: ${source}`
          : `Invalid wikilink format in source:: field: ${source}`,
        suggestion,
        severity: 'error',
      });
      return null;
    }

    if (!hasRelativePath(wikilink.path)) {
      errors.push({
        file,
        line: section.line,
        message: `source:: path must be relative (contain /): ${wikilink.path}`,
        suggestion: 'Use format [[../Lenses/filename.md|Display Text]] with relative path',
        severity: 'error',
      });
      return null;
    }

    const resolvedPath = resolveWikilinkPath(wikilink.path, file);
    const optional = section.fields.optional?.toLowerCase() === 'true';

    return { source, resolvedPath, optional };
  }

  // Helper: extract test ref from a parsed section
  function extractTestRef(section: ParsedSection): ParsedTestRef | undefined {
    const source = section.fields.source;
    let resolvedPath: string | undefined;

    if (source) {
      const wikilink = parseWikilink(source);
      if (!wikilink || wikilink.error) {
        const suggestion = wikilink?.correctedPath
          ? `Did you mean '[[${wikilink.correctedPath}]]'?`
          : 'Use format [[../Tests/filename.md|Display Text]]';
        errors.push({
          file,
          line: section.line,
          message: wikilink?.error
            ? `${wikilink.error} in source:: field: ${source}`
            : `Invalid wikilink format in source:: field: ${source}`,
          suggestion,
          severity: 'error',
        });
        return undefined;
      }

      resolvedPath = resolveWikilinkPath(wikilink.path, file);
    }

    const { segments: rawSegments, errors: segmentErrors } = parseSegments(
      section.body,
      section.line + 1,
      file
    );
    for (const err of segmentErrors) {
      if (err.line) {
        err.line += bodyStartLine - 1;
      }
    }
    errors.push(...segmentErrors);

    const testSegments: ParsedLensSegment[] = [];
    for (const rawSeg of rawSegments) {
      const { segment, errors: conversionErrors } = convertSegment(rawSeg, 'page', file);
      for (const err of conversionErrors) {
        if (err.line) {
          err.line += bodyStartLine - 1;
        }
      }
      errors.push(...conversionErrors);
      if (segment) {
        testSegments.push(segment);
      }
    }

    return { source, resolvedPath, segments: testSegments };
  }

  // Step 3: Check for submodule sections
  const hasSubmodules = sectionsResult.sections.some(s => s.type === 'submodule');
  const lenses: ParsedLensRef[] = [];
  let testRef: ParsedTestRef | undefined;
  let submodules: ParsedSubmoduleGroup[] | undefined;

  if (hasSubmodules) {
    // All-or-nothing: reject top-level lens/test sections when submodules exist
    const orphanedSections = sectionsResult.sections.filter(
      s => s.type !== 'submodule'
    );
    if (orphanedSections.length > 0) {
      errors.push({
        file,
        line: orphanedSections[0].line,
        message: 'Content found outside submodule boundaries — when using Submodule markers, all content must be inside a submodule',
        suggestion: 'Move this content into a Submodule section',
        severity: 'error',
      });
    }

    submodules = [];
    for (const section of sectionsResult.sections) {
      if (section.type !== 'submodule') continue;

      const group: ParsedSubmoduleGroup = {
        title: section.title,
        customSlug: section.fields.slug,
        lenses: [],
      };

      // Process children (lens/test sections at H3)
      if (section.children) {
        for (const child of section.children) {
          if (child.type === 'lens') {
            const ref = extractLensRef(child);
            if (ref) {
              group.lenses.push(ref);
              lenses.push(ref); // Also add to flat list for validation
            }
          } else if (child.type === 'test') {
            group.test = extractTestRef(child);
          }
        }
      }

      submodules.push(group);
    }
  } else {
    // Normal path: extract lens refs from top-level sections
    for (const section of sectionsResult.sections) {
      const typoWarnings = detectFieldTypos(section.fields, file, section.line);
      errors.push(...typoWarnings);

      if (section.type === 'lens') {
        const ref = extractLensRef(section);
        if (ref) lenses.push(ref);
      } else if (section.type === 'test') {
        testRef = extractTestRef(section);
      }
    }
  }

  // Step 4: Validate at least one lens exists
  if (lenses.length === 0) {
    errors.push({
      file,
      line: bodyStartLine,
      message: 'Learning Outcome must have at least one ## Lens: section',
      suggestion: "Add a '## Lens: <title>' section with a source:: field",
      severity: 'error',
    });
  }

  // Return result even if there are errors (partial success)
  const learningOutcome: ParsedLearningOutcome = {
    id: frontmatter.id as string,
    lenses,
    test: testRef,
    discussion: frontmatter.discussion as string | undefined,
    submodules,
  };

  return { learningOutcome, errors };
}
