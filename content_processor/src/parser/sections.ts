// src/parser/sections.ts
import type { ContentError } from '../index.js';
import { ALL_KNOWN_FIELDS } from '../content-schema.js';
import { levenshtein } from '../validator/field-typos.js';

export interface ParsedSection {
  type: string;
  title: string;
  rawType: string;
  fields: Record<string, string>;
  body: string;
  line: number;
  level: number;
  children?: ParsedSection[];
  inlineLens?: import('./lens.js').ParsedLens;
}

export interface SectionsResult {
  sections: ParsedSection[];
  errors: ContentError[];
}

// Valid section types per file type (exported for use by other parsers)
export const MODULE_SECTION_TYPES = new Set(['learning outcome', 'lens']);
export const LO_SECTION_TYPES = new Set(['lens', 'test']);
// Legacy: Lens H3 section types (no longer used — lenses are now flat H4 segments)
export const LENS_SECTION_TYPES = new Set(['page', 'article', 'video']);

// All known structural header types (sections + segments) for markdown heading detection
const ALL_STRUCTURAL_TYPES = new Set([
  // Section types
  'learning outcome', 'lens', 'test', 'module', 'meeting', 'article', 'video',
  // Segment types
  'text', 'chat', 'question', 'roleplay',
]);

// Fields that commonly contain markdown with headings
const MARKDOWN_CONTENT_FIELDS = new Set(['content', 'instructions', 'ai-instructions']);

// Map input section names to output types for Lens files
export const LENS_OUTPUT_TYPE: Record<string, string> = {
  'page': 'page',
  'article': 'lens-article',
  'video': 'lens-video',
};

/**
 * Parse sections from markdown content based on header hierarchy.
 *
 * @param content - The markdown body to parse
 * @param parentLevel - Headers deeper than this level are candidates (0 = match any header)
 * @param validTypes - Set of valid section/segment type names
 * @param file - Source file path for error reporting
 * @param flat - When true, all matching headers are siblings (for segments).
 *               When false, deeper headers nest inside preceding siblings (for sections).
 */
export function parseSections(
  content: string,
  parentLevel: number,
  validTypes: Set<string>,
  file: string = '',
  flat: boolean = false
): SectionsResult {
  const minLevel = parentLevel + 1;
  // Match any header from minLevel to 6 with named capture groups
  const HEADER_PATTERN = new RegExp(
    `^(?<hashes>#{${minLevel},6})\\s+(?<type>[^:]+?)(?:\\:\\s*(?<title>.*?))?\\s*$`, 'i'
  );

  const lines = content.split('\n');
  const sections: ParsedSection[] = [];
  const errors: ContentError[] = [];

  let currentSection: ParsedSection | null = null;
  let currentBody: string[] = [];
  let preHeaderWarned = false;
  let currentSiblingLevel = 0; // Track sibling level for hierarchical mode

  function finalizeSection() {
    if (!currentSection) return;
    currentSection.body = currentBody.join('\n');
    const { warnings } = parseFields(currentSection, file);
    errors.push(...warnings);

    // Submodule sections get recursive children parsing
    if (currentSection.type === 'submodule') {
      const childValidTypes = new Set([...validTypes]);
      childValidTypes.delete('submodule'); // No nesting
      const childResult = parseSections(currentSection.body, currentSection.level, childValidTypes, file);
      currentSection.children = childResult.sections;
      errors.push(...childResult.errors);
    }

    sections.push(currentSection);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    const headerMatch = line.match(HEADER_PATTERN);

    if (headerMatch) {
      const hashes = headerMatch.groups!.hashes;
      const headerLevel = hashes.length;
      const rawType = headerMatch.groups!.type.trim();
      const normalizedType = rawType.toLowerCase();
      const title = (headerMatch.groups!.title ?? '').trim();

      // Check if this type is valid for the current context
      if (!validTypes.has(normalizedType)) {
        // Only error for unknown types at sibling level (not deeper body content)
        const wouldBeSibling = flat || currentSiblingLevel === 0 || headerLevel <= currentSiblingLevel;
        if (wouldBeSibling) {
          const capitalized = [...validTypes].map(t => t.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' '));
          errors.push({
            file,
            line: lineNum,
            message: `Unknown section type: ${rawType}`,
            suggestion: `Valid types: ${capitalized.join(', ')}`,
            severity: 'error',
          });
        }
        // Treat as body content of current section
        if (currentSection) {
          currentBody.push(line);
        }
        continue;
      }

      // Sibling boundary rule (hierarchical mode only):
      // Deeper headers go into the preceding sibling's body
      if (!flat && currentSiblingLevel > 0 && headerLevel > currentSiblingLevel) {
        currentBody.push(line);
        continue;
      }

      // New sibling — finalize previous section
      finalizeSection();
      currentSiblingLevel = headerLevel;

      currentSection = {
        type: normalizedType.replaceAll(' ', '-'),
        title,
        rawType,
        fields: {},
        body: '',
        line: lineNum,
        level: headerLevel,
      };
      currentBody = [];
      preHeaderWarned = false;
    } else {
      if (currentSection) {
        currentBody.push(line);
      } else {
        // Before first section header — suppress warnings for field:: lines and blank lines
        const isFieldLine = /^[\w-]+::\s/.test(line);
        if (line.trim() && !isFieldLine && !preHeaderWarned) {
          preHeaderWarned = true;
          errors.push({
            file,
            line: lineNum,
            message: 'Content found before first section header — this text will be ignored',
            suggestion: 'Move this text into a section, or remove it',
            severity: 'error',
          });
        }
      }
    }
  }

  // Don't forget last section
  finalizeSection();

  return { sections, errors };
}

const FIELD_PATTERN = /^([\w-]+)::\s*(.*)$/;

interface ParseFieldsResult {
  warnings: ContentError[];
}

function parseFields(section: ParsedSection, file: string): ParseFieldsResult {
  const lines = section.body.split('\n');
  const warnings: ContentError[] = [];
  const seenFields = new Set<string>();
  let currentField: string | null = null;
  let currentValue: string[] = [];
  let freeTextWarned = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = section.line + i + 1; // +1 because body starts after header

    // Check for sub-header first - starts a new scope for field tracking
    const headerMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headerMatch) {
      // Before resetting, check if this looks like a markdown heading
      // inside a content/instructions field (not a structural header)
      if (currentField && MARKDOWN_CONTENT_FIELDS.has(currentField)) {
        const headingText = headerMatch[2].trim();
        // Extract type word: "Text", "Chat: title", "Article-excerpt" etc.
        const typeWord = headingText.replace(/:.*$/, '').trim().toLowerCase();
        // Also check if it's a typo of a structural type (levenshtein ≤ 2)
        const isTypoOfStructural = [...ALL_STRUCTURAL_TYPES].some(
          st => levenshtein(typeWord, st) <= 2
        );
        if (!ALL_STRUCTURAL_TYPES.has(typeWord) && !isTypoOfStructural) {
          const hashes = headerMatch[1];
          warnings.push({
            file,
            line: lineNum,
            message: `'${hashes} ${headingText}' looks like a Markdown heading inside ${currentField}:: field`,
            suggestion: `Escape it as '!${hashes} ${headingText}' so it's treated as content, not a section boundary`,
            severity: 'warning',
          });
        }
      }

      // Save current field if any
      if (currentField) {
        section.fields[currentField] = currentValue.join('\n').trim();
        currentField = null;
        currentValue = [];
      }
      // Reset seenFields for the new sub-section scope
      seenFields.clear();
      freeTextWarned = false;
      continue;
    }

    const match = line.match(FIELD_PATTERN);

    if (match) {
      // Save previous field if any
      if (currentField) {
        section.fields[currentField] = currentValue.join('\n').trim();
      }

      currentField = match[1];
      const inlineValue = match[2].trim();
      currentValue = inlineValue ? [inlineValue] : [];

      // Check for duplicate field
      if (seenFields.has(currentField)) {
        warnings.push({
          file,
          line: lineNum,
          message: `Duplicate field '${currentField}' (previous value will be overwritten)`,
          suggestion: `Remove the duplicate '${currentField}::' definition`,
          severity: 'error',
        });
      }
      seenFields.add(currentField);
    } else if (currentField) {
      // Continue multiline value
      currentValue.push(line);
    } else {
      // Not inside a field — check for single-colon that should be double-colon
      // Only suggest field:: if the word is a known field name
      const singleColonMatch = line.match(/^(\w+):\s+(.*)$/);
      if (singleColonMatch && !line.match(/^https?:/) && ALL_KNOWN_FIELDS.includes(singleColonMatch[1])) {
        warnings.push({
          file,
          line: lineNum,
          message: `Found '${singleColonMatch[1]}:' with single colon — did you mean '${singleColonMatch[1]}::'?`,
          suggestion: `Change '${singleColonMatch[1]}:' to '${singleColonMatch[1]}::' (double colon)`,
          severity: 'error',
        });
      } else if (line.trim() && !freeTextWarned) {
        freeTextWarned = true;
        const preview = line.trim().length > 60 ? line.trim().slice(0, 60) + '...' : line.trim();
        warnings.push({
          file,
          line: lineNum,
          message: `Text outside of a field:: definition will be ignored: "${preview}"`,
          suggestion: 'Place this text inside a field (e.g., content:: your text), or remove it',
          severity: 'error',
        });
      }
    }
  }

  // Save final field
  if (currentField) {
    section.fields[currentField] = currentValue.join('\n').trim();
  }

  return { warnings };
}
