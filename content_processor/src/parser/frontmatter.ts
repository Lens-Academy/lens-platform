// src/parser/frontmatter.ts
import { parse as parseYaml } from 'yaml';
import type { ContentError } from '../index.js';

export interface FrontmatterResult {
  frontmatter: Record<string, unknown>;
  body: string;
  bodyStartLine: number;
  error?: ContentError;
}

// Matches: ---\n<yaml>\n---\n<body>
const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export function parseFrontmatter(content: string, file: string = ''): FrontmatterResult {
  // Normalize Windows line endings
  content = content.replace(/\r\n/g, '\n');

  const match = content.match(FRONTMATTER_PATTERN);

  if (!match) {
    // Check if it starts with --- but doesn't close
    if (content.startsWith('---\n') && !content.includes('\n---\n')) {
      return {
        frontmatter: {},
        body: content,
        bodyStartLine: 1,
        error: {
          file,
          line: 1,
          message: 'Unclosed frontmatter - missing closing ---',
          suggestion: 'Add --- on its own line after frontmatter fields',
          severity: 'error',
        },
      };
    }
    return {
      frontmatter: {},
      body: content,
      bodyStartLine: 1,
      error: {
        file,
        line: 1,
        message: 'Missing frontmatter',
        suggestion: "Add YAML frontmatter with 'slug' and 'title' fields",
        severity: 'error',
      },
    };
  }

  const yamlContent = match[1];
  const body = match[2];
  const bodyStartLine = yamlContent.split('\n').length + 3; // 1 for opening ---, N for yaml, 1 for closing ---

  try {
    const frontmatter = parseYaml(yamlContent) ?? {};
    return { frontmatter, body, bodyStartLine };
  } catch (e) {
    return {
      frontmatter: {},
      body,
      bodyStartLine,
      error: {
        file,
        line: 2,
        message: `Invalid YAML: ${e instanceof Error ? e.message : String(e)}`,
        suggestion: 'Check YAML syntax - colons, indentation, quoting',
        severity: 'error',
      },
    };
  }
}
