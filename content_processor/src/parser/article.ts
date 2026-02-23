// src/parser/article.ts
import type { ContentError } from '../index.js';
import { parseFrontmatter } from './frontmatter.js';
import { validateFrontmatter } from '../validator/validate-frontmatter.js';

export interface ParsedArticle {
  title: string;
  author: string;
  sourceUrl: string;
  date?: string;
  imageUrls: Array<{ url: string; line: number }>;
}

export interface ArticleParseResult {
  article: ParsedArticle | null;
  errors: ContentError[];
}

export function parseArticle(content: string, file: string): ArticleParseResult {
  const errors: ContentError[] = [];

  const frontmatterResult = parseFrontmatter(content, file);
  if (frontmatterResult.error) {
    errors.push(frontmatterResult.error);
    return { article: null, errors };
  }

  const { frontmatter } = frontmatterResult;

  // Validate frontmatter against schema (typo detection + required fields)
  const frontmatterErrors = validateFrontmatter(frontmatter, 'article', file);
  errors.push(...frontmatterErrors);

  const hasRequiredError = frontmatterErrors.some(e => e.severity === 'error');
  if (hasRequiredError) {
    return { article: null, errors };
  }

  // Check text fields for wikilinks (not source_url — that's a URL)
  const textFields = ['title', 'author'] as const;
  for (const field of textFields) {
    const raw = frontmatter[field];
    const values = Array.isArray(raw) ? raw.map(String) : [String(raw)];
    if (values.some(v => /\[\[.+?\]\]/.test(v))) {
      errors.push({
        file,
        line: 2,
        message: `Field '${field}' contains a wikilink — use plain text`,
        suggestion: `Remove [[...]] from '${field}'`,
        severity: 'error',
      });
    }
  }

  const { body, bodyStartLine } = frontmatterResult;

  // Scan body for images
  const imageUrls: Array<{ url: string; line: number }> = [];
  const bodyLines = body.split('\n');

  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i];
    const absoluteLine = bodyStartLine + i;

    // Detect wiki-link images: ![[...]]
    const wikiImagePattern = /!\[\[([^\]]+)\]\]/g;
    let wikiMatch;
    while ((wikiMatch = wikiImagePattern.exec(line)) !== null) {
      errors.push({
        file,
        line: absoluteLine,
        message: `Wiki-link image not supported: ![[${wikiMatch[1]}]]`,
        suggestion: 'Use standard markdown image syntax: ![alt](url)',
        severity: 'error',
      });
    }

    // Collect standard markdown images: ![alt](url) or ![alt](url "title")
    const mdImagePattern = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    let mdMatch;
    while ((mdMatch = mdImagePattern.exec(line)) !== null) {
      imageUrls.push({ url: mdMatch[2], line: absoluteLine });
    }
  }

  const article: ParsedArticle = {
    title: String(frontmatter.title),
    author: Array.isArray(frontmatter.author)
      ? frontmatter.author.join(', ')
      : String(frontmatter.author),
    sourceUrl: String(frontmatter.source_url),
    date: frontmatter.date !== undefined ? String(frontmatter.date) : undefined,
    imageUrls,
  };

  return { article, errors };
}
