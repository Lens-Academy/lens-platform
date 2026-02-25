// src/validator/directives.ts
import type { ContentError } from '../index.js';
import { levenshtein } from './field-typos.js';

const SUPPORTED_DIRECTIVES: Record<string, { container: boolean; leaf: boolean; text: boolean; open: boolean }> = {
  note:     { container: true,  leaf: true,  text: true,  open: false },
  collapse: { container: true,  leaf: false, text: true,  open: false },
  footnote: { container: false, leaf: true,  text: true,  open: false },
};

const UNSUPPORTED_NAMES = new Set([
  'warning', 'info', 'tip', 'caution', 'important',
  'danger', 'details', 'summary', 'aside', 'callout', 'admonition',
]);

const ALL_DIRECTIVE_NAMES = new Set([...Object.keys(SUPPORTED_DIRECTIVES), ...UNSUPPORTED_NAMES]);

/**
 * Check if a name is a near-miss typo of a supported directive name.
 * Returns the closest match if levenshtein distance ≤ 2, else undefined.
 */
function findNearMissDirective(name: string): string | undefined {
  let bestMatch: string | undefined;
  let bestDist = Infinity;
  for (const supported of Object.keys(SUPPORTED_DIRECTIVES)) {
    const dist = levenshtein(name.toLowerCase(), supported);
    if (dist > 0 && dist <= 2 && dist < bestDist) {
      bestDist = dist;
      bestMatch = supported;
    }
  }
  return bestMatch;
}

// Regex patterns
const CONTAINER_OPEN = /^:::([\w-]+)(?:\{([^}]*)\})?/;
const CONTAINER_CLOSE_BARE = /^:::\s*$/;
const CONTAINER_CLOSE_ATTR = /^:::\s*\{([^}]*)\}/;
const CODE_FENCE = /^(?:```|~~~)/;
const LEAF_DIRECTIVE_PRE = /^::([\w-]+)(?:\{([^}]*)\})?\[/;
const LEAF_DIRECTIVE_POST = /^::([\w-]+)\[[^\]]*\]\{([^}]*)\}/;
const TEXT_DIRECTIVE_PRE = /(?:^|[^:]):(\w[\w-]*)(?:\{([^}]*)\})?\[/;
const TEXT_DIRECTIVE_POST = /(?:^|[^:]):(\w[\w-]*)\[[^\]]*\]\{([^}]*)\}/;
// Unclosed bracket patterns — match ::name[ or :name[ without closing ]
const LEAF_UNCLOSED = /^::([\w-]+)(?:\{[^}]*\})?\[[^\]]*$/;
const TEXT_UNCLOSED = /(?:^|[^:]):([\w][\w-]*)(?:\{[^}]*\})?\[[^\]]*$/;

interface StackEntry {
  name: string;
  line: number;       // absolute line number
  hasContent: boolean;
  attr?: string;      // attribute from opening marker
}

/**
 * Extract attribute string from a directive line's {…} block.
 * Returns undefined if no attribute block found.
 */
function extractAttr(line: string): string | undefined {
  const match = line.match(/\{([^}]*)\}/);
  return match ? match[1] : undefined;
}

/**
 * Check if an attribute value looks like a typo of "open".
 */
function isOpenTypo(attr: string): boolean {
  if (attr === 'open') return false;
  if (!attr) return false;

  // Case-insensitive match
  if (attr.toLowerCase() === 'open') return true;

  // Contains = (like open=true)
  if (attr.includes('=')) {
    const key = attr.split('=')[0];
    if (key.toLowerCase() === 'open') return true;
  }

  // Levenshtein distance
  if (levenshtein(attr.toLowerCase(), 'open') <= 2) return true;

  return false;
}

/**
 * Check attribute validity on a supported directive and return warnings.
 */
function checkAttribute(
  name: string,
  attr: string | undefined,
  file: string,
  line: number,
): ContentError[] {
  const errors: ContentError[] = [];
  if (attr === undefined) return errors;

  const info = SUPPORTED_DIRECTIVES[name];
  if (!info) return errors;

  if (attr === '') {
    errors.push({
      file,
      line,
      message: `Directive '${name}' has an empty attribute '{}'`,
      suggestion: 'Remove the empty braces, or use {open} to make the directive open by default',
      severity: 'warning',
    });
    return errors;
  }

  if (attr === 'open') {
    // Valid attribute — but check if this directive supports it
    if (!info.open) {
      errors.push({
        file,
        line,
        message: `Directive '${name}' does not support {open}`,
        suggestion: `Remove {open} — '${name}' does not support the open attribute`,
        severity: 'warning',
      });
    }
  } else if (isOpenTypo(attr)) {
    errors.push({
      file,
      line,
      message: `Possible attribute typo '{${attr}}' on directive '${name}'`,
      suggestion: `Did you mean {open}?`,
      severity: 'warning',
    });
  } else {
    // Completely unrecognized attribute
    errors.push({
      file,
      line,
      message: `Unrecognized attribute '{${attr}}' on directive '${name}'`,
      suggestion: info.open ? `The only supported attribute is {open}` : `'${name}' does not support any attributes`,
      severity: 'warning',
    });
  }

  return errors;
}

/**
 * Main validator for article body content.
 * Checks for unclosed containers, unsupported names, empty containers,
 * attribute typos, and {open} on closing markers.
 */
export function validateDirectives(
  body: string,
  file: string,
  bodyStartLine: number,
): ContentError[] {
  const errors: ContentError[] = [];
  const lines = body.split('\n');
  const stack: StackEntry[] = [];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const absLine = bodyStartLine + i;

    // Toggle code block state
    if (CODE_FENCE.test(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // Check container close with attribute (error: {open} on closing marker)
    const closeAttrMatch = line.match(CONTAINER_CLOSE_ATTR);
    if (closeAttrMatch) {
      const attrOnClose = closeAttrMatch[1];
      const top = stack.pop();
      if (top) {
        errors.push({
          file,
          line: absLine,
          message: `Attribute {${attrOnClose}} on closing ':::' marker has no effect`,
          suggestion: `Move to opening marker: :::${top.name}{${attrOnClose}}`,
          severity: 'error',
        });
        // Check empty container
        if (!top.hasContent) {
          errors.push({
            file,
            line: top.line,
            message: `Empty container directive ':::${top.name}' has no content`,
            suggestion: 'Add content between the opening and closing markers',
            severity: 'warning',
          });
        }
      }
      continue;
    }

    // Check bare container close
    if (CONTAINER_CLOSE_BARE.test(line)) {
      const top = stack.pop();
      if (top && !top.hasContent) {
        errors.push({
          file,
          line: top.line,
          message: `Empty container directive ':::${top.name}' has no content`,
          suggestion: 'Add content between the opening and closing markers',
          severity: 'warning',
        });
      }
      continue;
    }

    // Check container open
    const openMatch = line.match(CONTAINER_OPEN);
    if (openMatch) {
      const name = openMatch[1];
      const attr = openMatch[2];

      if (UNSUPPORTED_NAMES.has(name)) {
        errors.push({
          file,
          line: absLine,
          message: `Unsupported directive ':::${name}'`,
          suggestion: `Supported container directives: ${Object.entries(SUPPORTED_DIRECTIVES).filter(([, v]) => v.container).map(([k]) => k).join(', ')}`,
          severity: 'error',
        });
      } else if (SUPPORTED_DIRECTIVES[name]) {
        if (!SUPPORTED_DIRECTIVES[name].container) {
          errors.push({
            file,
            line: absLine,
            message: `Directive '${name}' does not support the container ':::' form`,
            suggestion: `Use the leaf form '::${name}[text]' or inline form ':${name}[text]' instead`,
            severity: 'error',
          });
        }
        errors.push(...checkAttribute(name, attr, file, absLine));
      } else {
        const nearMiss = findNearMissDirective(name);
        if (nearMiss) {
          errors.push({
            file,
            line: absLine,
            message: `Unknown directive ':::${name}' — did you mean ':::${nearMiss}'?`,
            suggestion: `Supported container directives: ${Object.entries(SUPPORTED_DIRECTIVES).filter(([, v]) => v.container).map(([k]) => k).join(', ')}`,
            severity: 'error',
          });
        }
      }

      stack.push({ name, line: absLine, hasContent: false, attr });
      continue;
    }

    // Check leaf directive (::name[...)
    // First check for unclosed bracket: ::name[ without ]
    const leafUnclosedMatch = line.match(LEAF_UNCLOSED);
    if (leafUnclosedMatch) {
      const name = leafUnclosedMatch[1];
      if (SUPPORTED_DIRECTIVES[name] || UNSUPPORTED_NAMES.has(name) || findNearMissDirective(name)) {
        errors.push({
          file,
          line: absLine,
          message: `Unclosed bracket in leaf directive '::${name}[' — missing closing ']'`,
          suggestion: `Add a closing bracket: ::${name}[content]`,
          severity: 'error',
        });
        if (stack.length > 0) {
          stack[stack.length - 1].hasContent = true;
        }
        continue;
      }
    }

    // Try POST first to capture post-bracket attributes, fall back to PRE
    const leafMatchPost = line.match(LEAF_DIRECTIVE_POST);
    const leafMatchPre = line.match(LEAF_DIRECTIVE_PRE);
    const leafMatch = leafMatchPost ?? leafMatchPre;
    if (leafMatch) {
      const name = leafMatch[1];
      // Prefer post-bracket attr if available
      const attr = leafMatchPost?.[2] ?? leafMatchPre?.[2];

      if (UNSUPPORTED_NAMES.has(name)) {
        errors.push({
          file,
          line: absLine,
          message: `Unsupported directive '::${name}'`,
          suggestion: `Supported leaf directives: ${Object.entries(SUPPORTED_DIRECTIVES).filter(([, v]) => v.leaf).map(([k]) => k).join(', ')}`,
          severity: 'error',
        });
      } else if (SUPPORTED_DIRECTIVES[name]) {
        if (!SUPPORTED_DIRECTIVES[name].leaf) {
          errors.push({
            file,
            line: absLine,
            message: `Directive '${name}' does not support the leaf '::' form`,
            suggestion: `Use the container form ':::${name}' or inline form ':${name}[text]' instead`,
            severity: 'warning',
          });
        }
        errors.push(...checkAttribute(name, attr, file, absLine));
      } else {
        const nearMiss = findNearMissDirective(name);
        if (nearMiss) {
          errors.push({
            file,
            line: absLine,
            message: `Unknown directive '::${name}' — did you mean '::${nearMiss}'?`,
            suggestion: `Supported leaf directives: ${Object.entries(SUPPORTED_DIRECTIVES).filter(([, v]) => v.leaf).map(([k]) => k).join(', ')}`,
            severity: 'error',
          });
        }
      }

      // Mark parent container as having content
      if (stack.length > 0) {
        stack[stack.length - 1].hasContent = true;
      }
      continue;
    }

    // Check for unclosed text directive brackets (:name[ without ])
    const textUnclosedMatches = line.matchAll(new RegExp(TEXT_UNCLOSED, 'g'));
    for (const m of textUnclosedMatches) {
      const name = m[1];
      const matchIndex = m.index!;
      const beforeMatch = line.substring(0, matchIndex + (m[0].startsWith(':') ? 0 : 1));
      if (/https?$|ftp$|mailto$|tel$/.test(beforeMatch)) continue;
      if (SUPPORTED_DIRECTIVES[name] || UNSUPPORTED_NAMES.has(name) || findNearMissDirective(name)) {
        errors.push({
          file,
          line: absLine,
          message: `Unclosed bracket in text directive ':${name}[' — missing closing ']'`,
          suggestion: `Add a closing bracket: :${name}[content]`,
          severity: 'error',
        });
      }
    }

    // Check text/inline directive (:name[...)
    // Must not be preceded by another colon (to avoid matching ::name)
    // Check both :name{attr}[text] and :name[text]{attr} forms
    const seenTextDirectives = new Set<number>(); // track by match index to avoid duplicates

    // Check POST first so :name[text]{attr} captures the attribute before PRE sees it without attr
    for (const pattern of [TEXT_DIRECTIVE_POST, TEXT_DIRECTIVE_PRE]) {
      const textMatches = line.matchAll(new RegExp(pattern, 'g'));
      for (const textMatch of textMatches) {
        const matchIndex = textMatch.index!;
        if (seenTextDirectives.has(matchIndex)) continue;
        seenTextDirectives.add(matchIndex);

        const name = textMatch[1];
        const attr = textMatch[2];

        // Skip URL-like patterns (http:, https:, ftp:, etc.)
        const beforeMatch = line.substring(0, matchIndex + (textMatch[0].startsWith(':') ? 0 : 1));
        if (/https?$|ftp$|mailto$|tel$/.test(beforeMatch)) continue;

        if (UNSUPPORTED_NAMES.has(name)) {
          errors.push({
            file,
            line: absLine,
            message: `Unsupported directive ':${name}'`,
            suggestion: `Supported text directives: ${Object.entries(SUPPORTED_DIRECTIVES).filter(([, v]) => v.text).map(([k]) => k).join(', ')}`,
            severity: 'error',
          });
        } else if (SUPPORTED_DIRECTIVES[name]) {
          errors.push(...checkAttribute(name, attr, file, absLine));
        } else {
          const nearMiss = findNearMissDirective(name);
          if (nearMiss) {
            errors.push({
              file,
              line: absLine,
              message: `Unknown directive ':${name}' — did you mean ':${nearMiss}'?`,
              suggestion: `Supported text directives: ${Object.entries(SUPPORTED_DIRECTIVES).filter(([, v]) => v.text).map(([k]) => k).join(', ')}`,
              severity: 'error',
            });
          }
        }

        // Mark parent container as having content
        if (stack.length > 0) {
          stack[stack.length - 1].hasContent = true;
        }
      }
    }

    // Mark content in parent container (non-blank, non-directive line)
    if (stack.length > 0 && line.trim() !== '') {
      stack[stack.length - 1].hasContent = true;
    }
  }

  // Report unclosed containers
  for (const entry of stack) {
    errors.push({
      file,
      line: entry.line,
      message: `Unclosed container directive ':::${entry.name}'`,
      suggestion: 'Add a closing ::: marker',
      severity: 'error',
    });
  }

  return errors;
}

/**
 * Lightweight check for directives in non-article content (e.g., lens text segments).
 * Returns a single warning per match since directives won't render outside articles.
 */
export function detectDirectivesInNonArticle(
  content: string,
  file: string,
  line: number,
): ContentError[] {
  const lines = content.split('\n');
  let inCodeBlock = false;

  for (const l of lines) {
    if (CODE_FENCE.test(l)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // Container directive
    if (CONTAINER_OPEN.test(l)) {
      const match = l.match(CONTAINER_OPEN)!;
      if (ALL_DIRECTIVE_NAMES.has(match[1])) {
        return [{
          file,
          line,
          message: `Directive ':::${match[1]}' found in non-article content — directives only render in article files`,
          suggestion: 'Move this content to an article file (articles/*.md) or remove the directive syntax',
          severity: 'warning',
        }];
      }
    }

    // Leaf directive
    const leafMatch = l.match(LEAF_DIRECTIVE_PRE);
    if (leafMatch && ALL_DIRECTIVE_NAMES.has(leafMatch[1])) {
      return [{
        file,
        line,
        message: `Directive '::${leafMatch[1]}' found in non-article content — directives only render in article files`,
        suggestion: 'Move this content to an article file (articles/*.md) or remove the directive syntax',
        severity: 'warning',
      }];
    }

    // Text/inline directive — scan for :name[ patterns (both pre and post attribute forms)
    for (const pattern of [TEXT_DIRECTIVE_PRE, TEXT_DIRECTIVE_POST]) {
      const textRegex = new RegExp(pattern, 'g');
      let textMatch;
      while ((textMatch = textRegex.exec(l)) !== null) {
        const name = textMatch[1];

        // Skip URL-like patterns
        const matchIndex = textMatch.index;
        const beforeMatch = l.substring(0, matchIndex + (textMatch[0].startsWith(':') ? 0 : 1));
        if (/https?$|ftp$|mailto$|tel$/.test(beforeMatch)) continue;

        if (ALL_DIRECTIVE_NAMES.has(name)) {
          return [{
            file,
            line,
            message: `Directive ':${name}' found in non-article content — directives only render in article files`,
            suggestion: 'Move this content to an article file (articles/*.md) or remove the directive syntax',
            severity: 'warning',
          }];
        }
      }
    }
  }

  return [];
}
