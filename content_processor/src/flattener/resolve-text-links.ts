import type { ContentError, Section } from '../index.js';
import { resolveWikilinkPath, findFileWithExtension } from '../parser/wikilink.js';
import { parseFrontmatter } from '../parser/frontmatter.js';

const INLINE_WIKILINK_RE = /(?<!!)(?<!::card)(\[\[([^\]|]+)(?:\|([^\]]+))?\]\])/g;
const CARD_LINK_RE = /::card\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

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

  // First pass: resolve ::card links (before inline wikilinks to prevent partial matching)
  const processed = content.replace(CARD_LINK_RE, (fullMatch, rawPath, _pipeDisplay) => {
    const path = rawPath.trim();
    const resolvedPath = resolveWikilinkPath(path, sourcePath);
    const filePath = findFileWithExtension(resolvedPath, files);

    if (!filePath) {
      errors.push({
        file: sourcePath,
        line: 0,
        message: `Card link target not found: ${path}`,
        severity: 'warning',
      });
      return fullMatch;
    }

    const fileContent = files.get(filePath)!;
    const fm = parseFrontmatter(fileContent, filePath);
    const isModule = filePath.toLowerCase().includes('modules/');

    const cardData: Record<string, unknown> = {
      targetType: isModule ? 'module' : 'lens',
      title: (fm.frontmatter.title as string) || fileNameToTitle(filePath),
    };

    if (isModule) {
      cardData.slug = (fm.frontmatter.slug as string) || fileNameToSlug(filePath);
    } else {
      cardData.contentId = (fm.frontmatter.id as string) || null;
      cardData.tldr = (fm.frontmatter.tldr as string) || null;
      cardData.moduleSlug = null;
    }

    const json = JSON.stringify(cardData).replace(/'/g, '&#39;');
    return `<div data-lens-card='${json}'></div>`;
  });

  // Second pass: resolve inline wikilinks
  const resolved = processed.replace(INLINE_WIKILINK_RE, (fullMatch, _outer, rawPath, pipeDisplay) => {
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

const CARD_HTML_RE = /(<div data-lens-card=')([^']+)('><\/div>)/g;

interface CardEnrichment {
  duration?: string;
  attribution?: string;
  displayType?: string;
}

/**
 * Enrich data-lens-card HTML blocks in text segments with computed metadata
 * (duration, attribution, displayType) from flattened sections.
 * Call after all sections are flattened so wordCount/videoDurationSeconds are available.
 */
export function enrichCardLinks(sections: Section[]): void {
  // Build lookup: contentId → enrichment data
  const lookup = new Map<string, CardEnrichment>();
  for (const section of sections) {
    if (!section.contentId) continue;

    const enrichment: CardEnrichment = {};

    // Duration from wordCount + videoDurationSeconds
    const readingMin = section.wordCount ? Math.ceil(section.wordCount / 200) : 0;
    const videoMin = section.videoDurationSeconds ? Math.ceil(section.videoDurationSeconds / 60) : 0;
    const totalMin = readingMin + videoMin;
    if (totalMin > 0) {
      enrichment.duration = `${totalMin} min`;
    }

    // Attribution from article authors + video channels
    const seen = new Set<string>();
    const names: string[] = [];
    for (const seg of section.segments) {
      if (seg.type === 'article' && 'author' in seg && seg.author) {
        const name = seg.author as string;
        if (!seen.has(name)) { seen.add(name); names.push(name); }
      } else if (seg.type === 'video' && 'channel' in seg && seg.channel) {
        const name = seg.channel as string;
        if (!seen.has(name)) { seen.add(name); names.push(name); }
      }
    }
    if (names.length > 0) {
      enrichment.attribution = names.join(' & ');
    }

    // Display type
    if (section.displayType) {
      enrichment.displayType = section.displayType;
    }

    lookup.set(section.contentId, enrichment);
  }

  // Enrich card HTML blocks in text segments
  for (const section of sections) {
    for (const seg of section.segments) {
      if (seg.type !== 'text') continue;
      if (!seg.content.includes('data-lens-card=')) continue;

      seg.content = seg.content.replace(CARD_HTML_RE, (_match, prefix, jsonStr, suffix) => {
        try {
          const data = JSON.parse(jsonStr.replace(/&#39;/g, "'"));
          const contentId = data.contentId as string | undefined;
          if (!contentId) return `${prefix}${jsonStr}${suffix}`;

          const enrichment = lookup.get(contentId);
          if (!enrichment) return `${prefix}${jsonStr}${suffix}`;

          // Merge enrichment into card data (don't overwrite existing values)
          if (enrichment.duration && !data.duration) data.duration = enrichment.duration;
          if (enrichment.attribution && !data.attribution) data.attribution = enrichment.attribution;
          if (enrichment.displayType && !data.displayType) data.displayType = enrichment.displayType;

          const newJson = JSON.stringify(data).replace(/'/g, '&#39;');
          return `${prefix}${newJson}${suffix}`;
        } catch {
          return `${prefix}${jsonStr}${suffix}`;
        }
      });
    }
  }
}
