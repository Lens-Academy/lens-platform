// src/parser/learning-outcome.ts
import type { ContentError } from '../index.js';
import { parseFrontmatter } from './frontmatter.js';
import { parseSections, LO_SECTION_TYPES } from './sections.js';
import { parseWikilink, resolveWikilinkPath, hasRelativePath } from './wikilink.js';
import { detectFieldTypos } from '../validator/field-typos.js';
import { validateFrontmatter } from '../validator/validate-frontmatter.js';

export interface ParsedLensRef {
  source: string;       // Raw wikilink
  resolvedPath: string; // Resolved file path
  optional: boolean;
}

export interface ParsedTestRef {
  source: string;
  resolvedPath: string;
}

export interface ParsedLearningOutcome {
  id: string;
  lenses: ParsedLensRef[];
  test?: ParsedTestRef;
  discussion?: string;
}

export interface LearningOutcomeParseResult {
  learningOutcome: ParsedLearningOutcome | null;
  errors: ContentError[];
}

export function parseLearningOutcome(content: string, file: string): LearningOutcomeParseResult {
  const errors: ContentError[] = [];

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

  // Step 2: Parse sections with H2 level and LO_SECTION_TYPES ('lens', 'test')
  const sectionsResult = parseSections(body, 2, LO_SECTION_TYPES, file);

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

  // Step 3: Extract lens refs with source field and optional flag
  const lenses: ParsedLensRef[] = [];
  let testRef: ParsedTestRef | undefined;

  for (const section of sectionsResult.sections) {
    // Detect likely typos in field names
    const typoWarnings = detectFieldTypos(section.fields, file, section.line);
    errors.push(...typoWarnings);

    if (section.type === 'lens') {
      const source = section.fields.source;
      if (!source) {
        errors.push({
          file,
          line: section.line,
          message: 'Lens section missing source:: field',
          suggestion: "Add 'source:: [[../Lenses/filename.md|Display]]' to the lens section",
          severity: 'error',
        });
        continue;
      }

      // Parse wikilink and resolve path
      const wikilink = parseWikilink(source);
      if (!wikilink || wikilink.error) {
        const suggestion = wikilink?.correctedPath
          ? `Did you mean '[[${wikilink.correctedPath}]]'?`
          : 'Use format [[../Lenses/filename.md|Display Text]]';
        errors.push({
          file,
          line: section.line,
          message: `Invalid wikilink format in source:: field: ${source}`,
          suggestion,
          severity: 'error',
        });
        continue;
      }

      // Require relative path (must contain /)
      if (!hasRelativePath(wikilink.path)) {
        errors.push({
          file,
          line: section.line,
          message: `source:: path must be relative (contain /): ${wikilink.path}`,
          suggestion: 'Use format [[../Lenses/filename.md|Display Text]] with relative path',
          severity: 'error',
        });
        continue;
      }

      const resolvedPath = resolveWikilinkPath(wikilink.path, file);
      const optional = section.fields.optional?.toLowerCase() === 'true';

      lenses.push({
        source,
        resolvedPath,
        optional,
      });
    } else if (section.type === 'test') {
      const source = section.fields.source;
      // source:: is optional for test sections (tests not fully implemented yet)
      if (!source) {
        continue;
      }

      // Parse wikilink and resolve path
      const wikilink = parseWikilink(source);
      if (!wikilink || wikilink.error) {
        const suggestion = wikilink?.correctedPath
          ? `Did you mean '[[${wikilink.correctedPath}]]'?`
          : 'Use format [[../Tests/filename.md|Display Text]]';
        errors.push({
          file,
          line: section.line,
          message: `Invalid wikilink format in source:: field: ${source}`,
          suggestion,
          severity: 'error',
        });
        continue;
      }

      const resolvedPath = resolveWikilinkPath(wikilink.path, file);

      testRef = {
        source,
        resolvedPath,
      };
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
  };

  return { learningOutcome, errors };
}
