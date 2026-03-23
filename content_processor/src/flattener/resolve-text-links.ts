import type { ContentError } from '../index.js';
import { resolveWikilinkPath, findFileWithExtension } from '../parser/wikilink.js';
import { parseFrontmatter } from '../parser/frontmatter.js';

const INLINE_WIKILINK_RE = /(?<!!)(\[\[([^\]|]+)(?:\|([^\]]+))?\]\])/g;

export interface ResolveResult {
  content: string;
  errors: ContentError[];
}

export function resolveTextLinks(
  content: string,
  sourcePath: string,
  files: Map<string, string>,
): ResolveResult {
  const errors: ContentError[] = [];

  const resolved = content.replace(INLINE_WIKILINK_RE, (fullMatch, _outer, rawPath, pipeDisplay) => {
    const path = rawPath.trim();
    const resolvedPath = resolveWikilinkPath(path, sourcePath);
    const filePath = findFileWithExtension(resolvedPath, files);

    if (!filePath) {
      errors.push({
        file: sourcePath,
        line: 0,
        message: `Wikilink target not found: ${path}`,
        severity: 'warning',
      });
      return fullMatch;
    }

    const fileContent = files.get(filePath)!;
    const fm = parseFrontmatter(fileContent, filePath);
    const isModule = filePath.toLowerCase().includes('modules/');
    const isLens = filePath.toLowerCase().includes('lenses/');

    if (isModule) {
      const slug = (fm.frontmatter.slug as string) || fileNameToSlug(filePath);
      const title = (fm.frontmatter.title as string) || fileNameToTitle(filePath);
      const display = pipeDisplay?.trim() || title;
      return `[${display}](module:${slug})`;
    }

    if (isLens) {
      const contentId = fm.frontmatter.id as string | undefined;
      if (!contentId) {
        errors.push({
          file: sourcePath,
          line: 0,
          message: `Lens has no id in frontmatter: ${path}`,
          severity: 'warning',
        });
        return fullMatch;
      }
      const title = (fm.frontmatter.title as string) || fileNameToTitle(filePath);
      const display = pipeDisplay?.trim() || title;
      return `[${display}](lens:${contentId})`;
    }

    return fullMatch;
  });

  return { content: resolved, errors };
}

function fileNameToTitle(filePath: string): string {
  const parts = filePath.split('/');
  const filename = parts[parts.length - 1];
  return filename.replace(/\.md$/, '');
}

function fileNameToSlug(filePath: string): string {
  return fileNameToTitle(filePath)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
