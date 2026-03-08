// src/flattener/index.ts
import type {
  FlattenedModule,
  Section,
  Segment,
  TextSegment,
  ChatSegment,
  ArticleExcerptSegment,
  VideoExcerptSegment,
  QuestionSegment,
  RoleplaySegment,
  ContentError,
  SectionMeta,
} from '../index.js';
import type { ContentTier } from '../validator/tier.js';
import { checkTierViolation } from '../validator/tier.js';
import { parseModule, parsePageSegments } from '../parser/module.js';
import { parseLearningOutcome, type ParsedTestRef } from '../parser/learning-outcome.js';
import { parseLens, type ParsedLens, type ParsedLensSegment, type ParsedLensSection } from '../parser/lens.js';
import { parseWikilink, resolveWikilinkPath, findFileWithExtension, findSimilarFiles, formatSuggestion } from '../parser/wikilink.js';
import { parseFrontmatter } from '../parser/frontmatter.js';
import { fileNameToSlug } from '../utils/slug.js';
import { extractArticleExcerpt, bundleArticleWithCollapsed } from '../bundler/article.js';
import { extractVideoExcerpt, type TimestampEntry } from '../bundler/video.js';

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Compute word count and video duration from a section's segments. */
function computeSectionStats(segments: Segment[]): { wordCount?: number; videoDurationSeconds?: number } {
  let words = 0;
  let videoSeconds = 0;
  for (const seg of segments) {
    if (seg.type === 'text' || seg.type === 'article-excerpt') {
      words += countWords(seg.content);
    } else if (seg.type === 'video-excerpt') {
      if (seg.to != null) videoSeconds += seg.to - seg.from;
    }
  }
  const stats: { wordCount?: number; videoDurationSeconds?: number } = {};
  if (words > 0) stats.wordCount = words;
  if (videoSeconds > 0) stats.videoDurationSeconds = videoSeconds;
  return stats;
}

/**
 * Extract YouTube video ID from a YouTube URL.
 *
 * Supported formats:
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://www.youtube.com/embed/VIDEO_ID
 *
 * @returns Video ID string, or null if URL format is not recognized
 */
function extractVideoIdFromUrl(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]+)/
  );
  return match ? match[1] : null;
}

export interface FlattenModuleResult {
  module: FlattenedModule | null;
  modules: FlattenedModule[];
  errors: ContentError[];
}

// Boundary marker for splitting modules into submodules
export type BoundaryMarker = { __boundary: true; title: string; customSlug?: string };
export type FlatItem = Section | BoundaryMarker;

export function isBoundary(item: FlatItem): item is BoundaryMarker {
  return '__boundary' in item && item.__boundary === true;
}

function toKebabCase(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function validateBoundaries(items: FlatItem[], file: string): ContentError[] {
  const errors: ContentError[] = [];
  const hasBoundaries = items.some(isBoundary);
  if (!hasBoundaries) return errors;

  // Check: sections before first boundary
  const firstBoundaryIdx = items.findIndex(isBoundary);
  const sectionsBefore = items.slice(0, firstBoundaryIdx).filter(i => !isBoundary(i));
  if (sectionsBefore.length > 0) {
    errors.push({
      file,
      message: 'Content found outside submodule boundaries — all content must be inside a submodule',
      severity: 'error',
    });
  }

  // Check: consecutive boundaries and trailing boundary
  for (let i = 0; i < items.length; i++) {
    if (isBoundary(items[i])) {
      // Find next non-boundary item
      let nextNonBoundary = i + 1;
      while (nextNonBoundary < items.length && isBoundary(items[nextNonBoundary])) {
        nextNonBoundary++;
      }
      // If this boundary has no sections before next boundary or end
      if (nextNonBoundary > i + 1 || nextNonBoundary >= items.length) {
        // nextNonBoundary > i + 1 means consecutive boundaries
        // nextNonBoundary >= items.length means trailing boundary with no content
        if (nextNonBoundary > i + 1) {
          errors.push({
            file,
            message: `Submodule "${(items[i] as BoundaryMarker).title}" is empty — no content before next submodule`,
            severity: 'error',
          });
        } else if (nextNonBoundary >= items.length) {
          errors.push({
            file,
            message: `Submodule "${(items[i] as BoundaryMarker).title}" is empty — no content after this marker`,
            severity: 'error',
          });
        }
      }
    }
  }

  return errors;
}

interface VirtualModuleGroup {
  slug: string;
  title: string;
  parentSlug: string;
  parentTitle: string;
  sections: Section[];
  contentId: string | null;
}

export function splitAtBoundaries(
  items: FlatItem[],
  parentSlug: string,
  parentTitle: string
): VirtualModuleGroup[] {
  const hasBoundaries = items.some(isBoundary);
  if (!hasBoundaries) {
    // No split — return single group without parentSlug
    return [{
      slug: parentSlug,
      title: parentTitle,
      parentSlug: undefined as unknown as string,
      parentTitle: undefined as unknown as string,
      sections: items.filter(i => !isBoundary(i)) as Section[],
      contentId: null,
    }];
  }

  const groups: VirtualModuleGroup[] = [];
  let currentGroup: VirtualModuleGroup | null = null;

  for (const item of items) {
    if (isBoundary(item)) {
      if (currentGroup) {
        groups.push(currentGroup);
      }
      const slug = item.customSlug ?? toKebabCase(item.title);
      currentGroup = {
        slug: `${parentSlug}/${slug}`,
        title: item.title,
        parentSlug,
        parentTitle,
        sections: [],
        contentId: null,
      };
    } else if (currentGroup) {
      currentGroup.sections.push(item as Section);
    }
    // sections before first boundary are orphans — handled by validateBoundaries
  }

  if (currentGroup) {
    groups.push(currentGroup);
  }

  return groups;
}

/**
 * Flatten a module by resolving all references to Learning Outcomes, Lenses, and content.
 *
 * This function:
 * 1. Parses the module file
 * 2. For each Learning Outcome section, resolves the LO file
 * 3. For each Lens in the LO, resolves the lens file
 * 4. For each segment, extracts content from articles/videos as needed
 *
 * @param modulePath - Path to the module file within the files Map
 * @param files - Map of all file paths to their content
 * @param visitedPaths - Optional set of already-visited paths for cycle detection
 * @returns Flattened module with resolved sections and segments, plus any errors
 */
export function flattenModule(
  modulePath: string,
  files: Map<string, string>,
  visitedPaths: Set<string> = new Set(),
  tierMap?: Map<string, ContentTier>
): FlattenModuleResult {
  // Check for circular reference
  if (visitedPaths.has(modulePath)) {
    return {
      module: null,
      modules: [],
      errors: [{
        file: modulePath,
        message: `Circular reference detected: ${modulePath}`,
        severity: 'error',
      }],
    };
  }
  visitedPaths.add(modulePath);
  const errors: ContentError[] = [];
  let moduleError: string | undefined;

  // Get module content
  const moduleContent = files.get(modulePath);
  if (!moduleContent) {
    errors.push({
      file: modulePath,
      message: `Module file not found: ${modulePath}`,
      severity: 'error',
    });
    return { module: null, modules: [], errors };
  }

  // Parse the module
  const moduleResult = parseModule(moduleContent, modulePath);
  errors.push(...moduleResult.errors);

  if (!moduleResult.module) {
    return { module: null, modules: [], errors };
  }

  const parsedModule = moduleResult.module;
  const flatItems: FlatItem[] = [];

  // Helper: process a section (LO, Page, Uncategorized) and return Section[]
  function processSection(
    section: { type: string; title: string; rawType: string; fields: Record<string, string>; body: string; line: number; level: number; children?: any[] },
    subsectionLevel?: number
  ): Section[] {
    if (section.type === 'learning-outcome') {
      const sectionVisitedPaths = new Set(visitedPaths);
      const result = flattenLearningOutcomeSection(
        section,
        modulePath,
        files,
        sectionVisitedPaths,
        tierMap
      );
      errors.push(...result.errors);
      return result.sections;
    } else if (section.type === 'page') {
      const level = subsectionLevel ?? 2;
      const textResult = parsePageSegments(section.body, modulePath, section.line, level);
      errors.push(...textResult.errors);

      return [{
        type: 'page',
        meta: { title: section.title },
        segments: textResult.segments,
        optional: section.fields.optional?.toLowerCase() === 'true',
        contentId: section.fields.id ?? null,
        learningOutcomeId: null,
        learningOutcomeName: null,
        videoId: null,
        ...computeSectionStats(textResult.segments),
      }];
    } else if (section.type === 'uncategorized') {
      const sectionVisitedPaths = new Set(visitedPaths);
      const result = flattenUncategorizedSection(
        section,
        modulePath,
        files,
        sectionVisitedPaths,
        tierMap
      );
      errors.push(...result.errors);
      return result.sections;
    }
    return [];
  }

  // Process each section in the module
  for (const section of parsedModule.sections) {
    if (section.type === 'submodule') {
      // Emit boundary marker
      flatItems.push({
        __boundary: true,
        title: section.title,
        customSlug: section.fields.slug,
      });

      // Process children at level+1
      if (section.children) {
        for (const child of section.children) {
          const childSections = processSection(child, child.level + 1);
          flatItems.push(...childSections);
        }
      }
    } else {
      // Check if this is an LO with submodules
      if (section.type === 'learning-outcome') {
        const loSections = processLOWithSubmodules(section, modulePath, files, visitedPaths, tierMap, errors);
        if (loSections) {
          flatItems.push(...loSections);
          continue;
        }
      }
      const sections = processSection(section);
      flatItems.push(...sections);
    }
  }

  // Validate and split at boundaries
  const boundaryErrors = validateBoundaries(flatItems, modulePath);
  errors.push(...boundaryErrors);

  const groups = splitAtBoundaries(flatItems, parsedModule.slug, parsedModule.title);

  const resultModules: FlattenedModule[] = groups.map(g => ({
    slug: g.slug,
    title: g.title,
    contentId: parsedModule.contentId,
    sections: g.sections,
    ...(g.parentSlug ? { parentSlug: g.parentSlug, parentTitle: g.parentTitle } : {}),
    ...(moduleError ? { error: moduleError } : {}),
  }));

  // Backwards compat: module is the first result or a merged single module
  const primaryModule = resultModules.length > 0 ? resultModules[0] : null;

  return { module: resultModules.length === 1 && !resultModules[0].parentSlug ? resultModules[0] : primaryModule, modules: resultModules, errors };
}

/**
 * Build a test Section from a ParsedTestRef with inline segments.
 * Shared by both processLOWithSubmodules() and flattenLearningOutcomeSection().
 */
function buildTestSection(
  testRef: ParsedTestRef,
  loId: string | null,
  loName: string | null,
  loPath: string,
  files: Map<string, string>,
  visitedPaths: Set<string>,
  tierMap: Map<string, ContentTier> | undefined,
  errors: ContentError[]
): Section | null {
  if (!testRef.segments.length) return null;

  const testSegments: Segment[] = [];
  const stubLensSection: ParsedLensSection = {
    type: 'page',
    title: 'Test',
    segments: [],
    line: 0,
  };

  for (const parsedSegment of testRef.segments) {
    const segmentResult = convertSegment(
      parsedSegment,
      stubLensSection,
      loPath,
      files,
      new Set(visitedPaths),
      tierMap
    );
    errors.push(...segmentResult.errors);
    if (segmentResult.segment) {
      testSegments.push(segmentResult.segment);
    }
  }

  if (testSegments.length === 0) return null;

  const hasFeedback = testSegments.some(
    (s) => s.type === 'question' && s.feedback
  );
  return {
    type: 'test',
    meta: { title: 'Test' },
    segments: testSegments,
    optional: false,
    ...(hasFeedback && { feedback: true }),
    contentId: null,
    learningOutcomeId: loId,
    learningOutcomeName: loName,
    videoId: null,
  };
}

/**
 * Check if a Learning Outcome section resolves to an LO with submodules.
 * If so, emit boundary markers + sections. Returns null if no submodules.
 */
function processLOWithSubmodules(
  section: { type: string; title: string; fields: Record<string, string>; line: number },
  modulePath: string,
  files: Map<string, string>,
  visitedPaths: Set<string>,
  tierMap: Map<string, ContentTier> | undefined,
  errors: ContentError[]
): FlatItem[] | null {
  // Resolve the LO file to check for submodules
  const source = section.fields.source;
  if (!source) return null;

  const wikilink = parseWikilink(source);
  if (!wikilink || wikilink.error) return null;

  const loPathResolved = resolveWikilinkPath(wikilink.path, modulePath);
  const loPath = findFileWithExtension(loPathResolved, files);
  if (!loPath) return null;

  const loContent = files.get(loPath);
  if (!loContent) return null;

  const loResult = parseLearningOutcome(loContent, loPath);
  if (!loResult.learningOutcome?.submodules) return null;

  // This LO has submodules — emit boundaries and resolve lenses
  const items: FlatItem[] = [];

  for (const sub of loResult.learningOutcome.submodules) {
    items.push({
      __boundary: true,
      title: sub.title,
      customSlug: sub.customSlug,
    });

    // Resolve each lens in this submodule group
    for (const lensRef of sub.lenses) {
      const lensPath = findFileWithExtension(lensRef.resolvedPath, files);
      if (!lensPath) {
        const similarFiles = findSimilarFiles(lensRef.resolvedPath, files, 'Lenses');
        const suggestion = formatSuggestion(similarFiles, loPath) ?? 'Check the file path in the wiki-link';
        errors.push({
          file: loPath,
          message: `Referenced lens file not found: ${lensRef.resolvedPath}`,
          suggestion,
          severity: 'error',
        });
        continue;
      }

      // Check tier violation
      if (tierMap) {
        const parentTier = tierMap.get(loPath) ?? 'production';
        const childTier = tierMap.get(lensPath) ?? 'production';
        const violation = checkTierViolation(loPath, parentTier, lensPath, childTier, 'lens');
        if (violation) {
          errors.push(violation);
        }
        if (childTier === 'ignored') continue;
      }

      if (visitedPaths.has(lensPath)) {
        errors.push({
          file: loPath,
          message: `Circular reference detected: ${lensPath}`,
          severity: 'error',
        });
        continue;
      }

      const sectionVisitedPaths = new Set(visitedPaths);
      sectionVisitedPaths.add(lensPath);

      const lensContent = files.get(lensPath)!;
      const lensResult = parseLens(lensContent, lensPath);
      errors.push(...lensResult.errors);

      if (!lensResult.lens) continue;

      const lens = lensResult.lens;
      let sectionType: 'page' | 'lens-video' | 'lens-article' = 'page';
      const meta: SectionMeta = { title: section.title };
      const segments: Segment[] = [];
      let videoId: string | undefined;

      for (const lensSection of lens.sections) {
        if (lensSection.type === 'lens-article') {
          sectionType = 'lens-article';
          if (lensSection.source) {
            const articleWikilink = parseWikilink(lensSection.source);
            if (articleWikilink && !articleWikilink.error) {
              const articlePathResolved = resolveWikilinkPath(articleWikilink.path, lensPath);
              const articlePath = findFileWithExtension(articlePathResolved, files);
              if (articlePath) {
                const articleContent = files.get(articlePath)!;
                const articleFrontmatter = parseFrontmatter(articleContent, articlePath);
                if (articleFrontmatter.frontmatter.title) meta.title = articleFrontmatter.frontmatter.title as string;
                if (articleFrontmatter.frontmatter.author) {
                  const raw = articleFrontmatter.frontmatter.author;
                  meta.author = Array.isArray(raw) ? raw.join(', ') : String(raw);
                }
                if (articleFrontmatter.frontmatter.source_url) meta.sourceUrl = articleFrontmatter.frontmatter.source_url as string;
              }
            }
          }
        } else if (lensSection.type === 'page') {
          sectionType = 'page';
          if (lensSection.title) meta.title = lensSection.title;
        } else if (lensSection.type === 'lens-video') {
          sectionType = 'lens-video';
          if (lensSection.source) {
            const videoWikilink = parseWikilink(lensSection.source);
            if (videoWikilink && !videoWikilink.error) {
              const videoPathResolved = resolveWikilinkPath(videoWikilink.path, lensPath);
              const videoPath = findFileWithExtension(videoPathResolved, files);
              if (videoPath) {
                const videoContent = files.get(videoPath)!;
                const videoFrontmatter = parseFrontmatter(videoContent, videoPath);
                if (videoFrontmatter.frontmatter.title) meta.title = videoFrontmatter.frontmatter.title as string;
                if (videoFrontmatter.frontmatter.channel) meta.channel = videoFrontmatter.frontmatter.channel as string;
                if (videoFrontmatter.frontmatter.url) {
                  const extractedVideoId = extractVideoIdFromUrl(videoFrontmatter.frontmatter.url as string);
                  if (extractedVideoId) videoId = extractedVideoId;
                }
              }
            }
          }
        }

        for (const parsedSegment of lensSection.segments) {
          const segmentResult = convertSegment(parsedSegment, lensSection, lensPath, files, sectionVisitedPaths, tierMap);
          errors.push(...segmentResult.errors);
          if (segmentResult.segment) segments.push(segmentResult.segment);
        }

        applyCollapsedContent(segments, lensSection.segments, lensSection, lensPath, files);
      }

      const lo = loResult.learningOutcome!;
      items.push({
        type: sectionType,
        meta,
        segments,
        optional: section.fields.optional?.toLowerCase() === 'true' || lensRef.optional,
        learningOutcomeId: lo.id ?? null,
        learningOutcomeName: loPath.split('/').pop()?.replace(/\.md$/i, '') ?? null,
        contentId: lens.id ?? null,
        tldr: lens.tldr,
        videoId: videoId ?? null,
        ...computeSectionStats(segments),
      } as Section);
    }

    // Process test section if present in this submodule
    if (sub.test) {
      const lo = loResult.learningOutcome!;
      const testSection = buildTestSection(
        sub.test,
        lo.id ?? null,
        loPath.split('/').pop()?.replace(/\.md$/i, '') ?? null,
        loPath, files, visitedPaths, tierMap, errors
      );
      if (testSection) items.push(testSection);
    }
  }

  // Also emit LO parse errors (we skipped earlier since we returned non-null)
  errors.push(...loResult.errors);

  return items;
}

interface FlattenSectionResult {
  section: Section | null;
  errors: ContentError[];
  errorMessage?: string;
}

interface FlattenMultipleSectionsResult {
  sections: Section[];
  errors: ContentError[];
}

/**
 * Flatten a Learning Outcome section by resolving its LO file and all referenced lenses.
 * Each lens in the LO becomes its own section.
 */
function flattenLearningOutcomeSection(
  section: { type: string; title: string; fields: Record<string, string>; line: number },
  modulePath: string,
  files: Map<string, string>,
  visitedPaths: Set<string>,
  tierMap?: Map<string, ContentTier>
): FlattenMultipleSectionsResult {
  const errors: ContentError[] = [];
  const sections: Section[] = [];

  // Get the source wikilink
  const source = section.fields.source;
  if (!source) {
    errors.push({
      file: modulePath,
      line: section.line,
      message: 'Learning Outcome section missing source:: field',
      suggestion: "Add 'source:: [[../Learning Outcomes/filename.md|Display]]'",
      severity: 'error',
    });
    return { sections: [], errors };
  }

  // Parse and resolve the wikilink
  const wikilink = parseWikilink(source);
  if (!wikilink || wikilink.error) {
    const suggestion = wikilink?.correctedPath
      ? `Did you mean '[[${wikilink.correctedPath}]]'?`
      : 'Use format [[../Learning Outcomes/filename.md|Display Text]]';
    errors.push({
      file: modulePath,
      line: section.line,
      message: wikilink?.error
        ? `${wikilink.error}: ${source}`
        : `Invalid wikilink format: ${source}`,
      suggestion,
      severity: 'error',
    });
    return { sections: [], errors };
  }

  const loPathResolved = resolveWikilinkPath(wikilink.path, modulePath);
  const loPath = findFileWithExtension(loPathResolved, files);

  // Get the LO file content
  if (!loPath) {
    // Find similar files to suggest
    const similarFiles = findSimilarFiles(loPathResolved, files, 'Learning Outcomes');
    const suggestion = formatSuggestion(similarFiles, modulePath) ?? 'Check the file path in the wiki-link';

    errors.push({
      file: modulePath,
      line: section.line,
      message: `Referenced file not found: ${loPathResolved}`,
      suggestion,
      severity: 'error',
    });
    return { sections: [], errors };
  }

  // Check tier violation (module → LO)
  if (tierMap) {
    const parentTier = tierMap.get(modulePath) ?? 'production';
    const childTier = tierMap.get(loPath) ?? 'production';
    const violation = checkTierViolation(modulePath, parentTier, loPath, childTier, 'learning outcome', section.line);
    if (violation) {
      errors.push(violation);
    }
    // Skip ignored children silently (they're not processed)
    if (childTier === 'ignored') {
      return { sections: [], errors };
    }
  }

  // Check for circular reference
  if (visitedPaths.has(loPath)) {
    errors.push({
      file: modulePath,
      line: section.line,
      message: `Circular reference detected: ${loPath}`,
      severity: 'error',
    });
    return { sections: [], errors };
  }
  visitedPaths.add(loPath);

  const loContent = files.get(loPath)!;

  // Parse the Learning Outcome
  const loResult = parseLearningOutcome(loContent, loPath);
  errors.push(...loResult.errors);

  if (!loResult.learningOutcome) {
    return { sections: [], errors };
  }

  const lo = loResult.learningOutcome;

  // Each lens becomes its own section
  for (const lensRef of lo.lenses) {
    const lensPath = findFileWithExtension(lensRef.resolvedPath, files);
    if (!lensPath) {
      // Find similar files to suggest
      const similarFiles = findSimilarFiles(lensRef.resolvedPath, files, 'Lenses');
      const suggestion = formatSuggestion(similarFiles, loPath) ?? 'Check the file path in the wiki-link';

      errors.push({
        file: loPath,
        message: `Referenced lens file not found: ${lensRef.resolvedPath}`,
        suggestion,
        severity: 'error',
      });
      continue;
    }

    // Check tier violation (LO → Lens)
    if (tierMap) {
      const parentTier = tierMap.get(loPath) ?? 'production';
      const childTier = tierMap.get(lensPath) ?? 'production';
      const violation = checkTierViolation(loPath, parentTier, lensPath, childTier, 'lens');
      if (violation) {
        errors.push(violation);
      }
      if (childTier === 'ignored') {
        continue;
      }
    }

    // Check for circular reference
    if (visitedPaths.has(lensPath)) {
      errors.push({
        file: loPath,
        message: `Circular reference detected: ${lensPath}`,
        severity: 'error',
      });
      continue;
    }
    visitedPaths.add(lensPath);

    const lensContent = files.get(lensPath)!;

    // Parse the lens
    const lensResult = parseLens(lensContent, lensPath);
    errors.push(...lensResult.errors);

    if (!lensResult.lens) {
      continue;
    }

    const lens = lensResult.lens;

    // Each lens becomes its own section
    let sectionType: 'page' | 'lens-video' | 'lens-article' = 'page';
    const meta: SectionMeta = { title: section.title };
    const segments: Segment[] = [];
    let videoId: string | undefined;

    // Process each section in the lens
    for (const lensSection of lens.sections) {
      // Determine section type from lens section
      if (lensSection.type === 'lens-article') {
        sectionType = 'lens-article';

        // Extract article metadata from the article file's frontmatter
        if (lensSection.source) {
          const articleWikilink = parseWikilink(lensSection.source);
          if (articleWikilink && !articleWikilink.error) {
            const articlePathResolved = resolveWikilinkPath(articleWikilink.path, lensPath);
            const articlePath = findFileWithExtension(articlePathResolved, files);
            if (articlePath) {
              const articleContent = files.get(articlePath)!;
              const articleFrontmatter = parseFrontmatter(articleContent, articlePath);

              // Extract metadata fields
              if (articleFrontmatter.frontmatter.title) {
                meta.title = articleFrontmatter.frontmatter.title as string;
              }
              if (articleFrontmatter.frontmatter.author) {
                const raw = articleFrontmatter.frontmatter.author;
                meta.author = Array.isArray(raw) ? raw.join(', ') : String(raw);
              }
              if (articleFrontmatter.frontmatter.source_url) {
                meta.sourceUrl = articleFrontmatter.frontmatter.source_url as string;
              }
              if (articleFrontmatter.frontmatter.published) {
                meta.published = String(articleFrontmatter.frontmatter.published);
              }
            }
          }
        }
      } else if (lensSection.type === 'page') {
        sectionType = 'page';
        // For page sections, use the title from the ### Page: header
        if (lensSection.title) {
          meta.title = lensSection.title;
        }
      } else if (lensSection.type === 'lens-video') {
        sectionType = 'lens-video';

        // Extract video metadata from the video transcript file's frontmatter
        if (lensSection.source) {
          const videoWikilink = parseWikilink(lensSection.source);
          if (videoWikilink && !videoWikilink.error) {
            const videoPathResolved = resolveWikilinkPath(videoWikilink.path, lensPath);
            const videoPath = findFileWithExtension(videoPathResolved, files);
            if (videoPath) {
              const videoContent = files.get(videoPath)!;
              const videoFrontmatter = parseFrontmatter(videoContent, videoPath);

              // Extract metadata fields
              if (videoFrontmatter.frontmatter.title) {
                meta.title = videoFrontmatter.frontmatter.title as string;
              }
              if (videoFrontmatter.frontmatter.channel) {
                meta.channel = videoFrontmatter.frontmatter.channel as string;
              }
              // Extract video ID from YouTube URL
              if (videoFrontmatter.frontmatter.url) {
                const extractedVideoId = extractVideoIdFromUrl(videoFrontmatter.frontmatter.url as string);
                if (extractedVideoId) {
                  videoId = extractedVideoId;
                }
              }
            }
          }
        }
      }

      // Process segments
      for (const parsedSegment of lensSection.segments) {
        const segmentResult = convertSegment(
          parsedSegment,
          lensSection,
          lensPath,
          files,
          visitedPaths,
          tierMap
        );
        errors.push(...segmentResult.errors);

        if (segmentResult.segment) {
          segments.push(segmentResult.segment);
        }
      }

      // Apply collapsed content to article-excerpt segments
      applyCollapsedContent(segments, lensSection.segments, lensSection, lensPath, files);
    }

    // Create a section for this lens
    // Optional can come from either:
    // 1. The LO reference in the module (section.fields.optional) - makes ALL lenses optional
    // 2. The individual lens reference in the LO (lensRef.optional) - makes just this lens optional
    const resultSection: Section = {
      type: sectionType,
      meta,
      segments,
      optional: section.fields.optional?.toLowerCase() === 'true' || lensRef.optional,
      learningOutcomeId: lo.id ?? null,
      learningOutcomeName: loPath.split('/').pop()?.replace(/\.md$/i, '') ?? null,
      contentId: lens.id ?? null,
      tldr: lens.tldr,
      videoId: videoId ?? null,
      ...computeSectionStats(segments),
    };

    sections.push(resultSection);
  }

  // After lens processing, add test section if present with inline segments
  if (lo.test) {
    const testSection = buildTestSection(
      lo.test,
      lo.id ?? null,
      loPath.split('/').pop()?.replace(/\.md$/i, '') ?? null,
      loPath, files, visitedPaths, tierMap, errors
    );
    if (testSection) sections.push(testSection);
  }

  return { sections, errors };
}

/**
 * Flatten an Uncategorized section by parsing its ## Lens: references.
 * Each lens becomes its own section with the appropriate type (lens-video, lens-article, or page).
 */
function flattenUncategorizedSection(
  section: { type: string; title: string; fields: Record<string, string>; body: string; line: number },
  modulePath: string,
  files: Map<string, string>,
  visitedPaths: Set<string>,
  tierMap?: Map<string, ContentTier>
): FlattenMultipleSectionsResult {
  const errors: ContentError[] = [];
  const sections: Section[] = [];

  // Parse the section body for ## Lens: subsections
  const lensRefs = parseUncategorizedLensRefs(section.body, modulePath);

  // If no lens refs found, warn and return empty array
  if (lensRefs.length === 0) {
    errors.push({
      file: modulePath,
      line: section.line,
      message: 'Uncategorized section has no ## Lens: references — this section will produce no output',
      suggestion: "Add '## Lens: [[../Lenses/lens-name.md|Display]]' references",
      severity: 'warning',
    });
    return { sections: [], errors };
  }

  // Process each lens reference as a separate section
  for (const lensRef of lensRefs) {
    const lensPath = findFileWithExtension(lensRef.resolvedPath, files);
    if (!lensPath) {
      // Find similar files to suggest
      const similarFiles = findSimilarFiles(lensRef.resolvedPath, files, 'Lenses');
      const suggestion = formatSuggestion(similarFiles, modulePath) ?? 'Check the file path in the wiki-link';

      errors.push({
        file: modulePath,
        message: `Referenced lens file not found: ${lensRef.resolvedPath}`,
        suggestion,
        severity: 'error',
      });
      continue;
    }

    // Check tier violation (Uncategorized/Module → Lens)
    if (tierMap) {
      const parentTier = tierMap.get(modulePath) ?? 'production';
      const childTier = tierMap.get(lensPath) ?? 'production';
      const violation = checkTierViolation(modulePath, parentTier, lensPath, childTier, 'lens');
      if (violation) {
        errors.push(violation);
      }
      if (childTier === 'ignored') {
        continue;
      }
    }

    // Check for circular reference
    if (visitedPaths.has(lensPath)) {
      errors.push({
        file: modulePath,
        message: `Circular reference detected: ${lensPath}`,
        severity: 'error',
      });
      continue;
    }
    visitedPaths.add(lensPath);

    const lensContent = files.get(lensPath)!;

    // Parse the lens
    const lensResult = parseLens(lensContent, lensPath);
    errors.push(...lensResult.errors);

    if (!lensResult.lens) {
      continue;
    }

    const lens = lensResult.lens;

    // Each lens becomes its own section
    let sectionType: 'page' | 'lens-video' | 'lens-article' = 'page';
    const meta: SectionMeta = { title: section.title };
    const segments: Segment[] = [];
    let videoId: string | undefined;

    // Process each section in the lens
    for (const lensSection of lens.sections) {
      // Determine section type from lens section
      if (lensSection.type === 'lens-article') {
        sectionType = 'lens-article';

        // Extract article metadata from the article file's frontmatter
        if (lensSection.source) {
          const articleWikilink = parseWikilink(lensSection.source);
          if (articleWikilink && !articleWikilink.error) {
            const articlePathResolved = resolveWikilinkPath(articleWikilink.path, lensPath);
            const articlePath = findFileWithExtension(articlePathResolved, files);
            if (articlePath) {
              const articleContent = files.get(articlePath)!;
              const articleFrontmatter = parseFrontmatter(articleContent, articlePath);

              // Extract metadata fields
              if (articleFrontmatter.frontmatter.title) {
                meta.title = articleFrontmatter.frontmatter.title as string;
              }
              if (articleFrontmatter.frontmatter.author) {
                const raw = articleFrontmatter.frontmatter.author;
                meta.author = Array.isArray(raw) ? raw.join(', ') : String(raw);
              }
              if (articleFrontmatter.frontmatter.source_url) {
                meta.sourceUrl = articleFrontmatter.frontmatter.source_url as string;
              }
              if (articleFrontmatter.frontmatter.published) {
                meta.published = String(articleFrontmatter.frontmatter.published);
              }
            }
          }
        }
      } else if (lensSection.type === 'page') {
        sectionType = 'page';
        // For page sections, use the title from the ### Page: header
        if (lensSection.title) {
          meta.title = lensSection.title;
        }
      } else if (lensSection.type === 'lens-video') {
        sectionType = 'lens-video';

        // Extract video metadata from the video transcript file's frontmatter
        if (lensSection.source) {
          const videoWikilink = parseWikilink(lensSection.source);
          if (videoWikilink && !videoWikilink.error) {
            const videoPathResolved = resolveWikilinkPath(videoWikilink.path, lensPath);
            const videoPath = findFileWithExtension(videoPathResolved, files);
            if (videoPath) {
              const videoContent = files.get(videoPath)!;
              const videoFrontmatter = parseFrontmatter(videoContent, videoPath);

              // Extract metadata fields
              if (videoFrontmatter.frontmatter.title) {
                meta.title = videoFrontmatter.frontmatter.title as string;
              }
              if (videoFrontmatter.frontmatter.channel) {
                meta.channel = videoFrontmatter.frontmatter.channel as string;
              }
              // Extract video ID from YouTube URL
              if (videoFrontmatter.frontmatter.url) {
                const extractedVideoId = extractVideoIdFromUrl(videoFrontmatter.frontmatter.url as string);
                if (extractedVideoId) {
                  videoId = extractedVideoId;
                }
              }
            }
          }
        }
      }

      // Process segments
      for (const parsedSegment of lensSection.segments) {
        const segmentResult = convertSegment(
          parsedSegment,
          lensSection,
          lensPath,
          files,
          visitedPaths,
          tierMap
        );
        errors.push(...segmentResult.errors);

        if (segmentResult.segment) {
          segments.push(segmentResult.segment);
        }
      }

      // Apply collapsed content to article-excerpt segments
      applyCollapsedContent(segments, lensSection.segments, lensSection, lensPath, files);
    }

    // Create a section for this lens
    const resultSection: Section = {
      type: sectionType,
      meta,
      segments,
      optional: lensRef.optional,
      learningOutcomeId: null,
      learningOutcomeName: null,
      contentId: lens.id ?? null,
      tldr: lens.tldr,
      videoId: videoId ?? null,
      ...computeSectionStats(segments),
    };

    sections.push(resultSection);
  }

  return { sections, errors };
}

/**
 * Parse ## Lens: subsections from an Uncategorized section's body.
 * Returns an array of lens references with resolved paths.
 */
function parseUncategorizedLensRefs(
  body: string,
  parentPath: string
): Array<{ source: string; resolvedPath: string; optional: boolean }> {
  const lensRefs: Array<{ source: string; resolvedPath: string; optional: boolean }> = [];
  const lines = body.split('\n');

  let inLensSection = false;
  let currentFields: Record<string, string> = {};
  let currentField: string | null = null;
  let currentValue: string[] = [];

  const LENS_HEADER_PATTERN = /^##\s+Lens:\s*(.*)$/i;
  const FIELD_PATTERN = /^(\w+)::\s*(.*)$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for ## Lens: header
    const lensMatch = line.match(LENS_HEADER_PATTERN);
    if (lensMatch) {
      // Save previous lens if we were in one
      if (inLensSection) {
        // First, finalize current field if we were collecting one
        // This must happen BEFORE checking currentFields.source
        if (currentField) {
          currentFields[currentField] = currentValue.join('\n').trim();
        }

        if (currentFields.source) {
          const wikilink = parseWikilink(currentFields.source);
          if (wikilink) {
            const resolvedPath = resolveWikilinkPath(wikilink.path, parentPath);
            lensRefs.push({
              source: currentFields.source,
              resolvedPath,
              optional: currentFields.optional?.toLowerCase() === 'true',
            });
          }
        }
      }

      inLensSection = true;
      currentFields = {};
      currentField = null;
      currentValue = [];
      continue;
    }

    // Check for another ## header (end of Lens section)
    if (line.match(/^##\s+\S/) && inLensSection) {
      // Save current lens
      if (currentField) {
        currentFields[currentField] = currentValue.join('\n').trim();
      }

      if (currentFields.source) {
        const wikilink = parseWikilink(currentFields.source);
        if (wikilink && !wikilink.error) {
          const resolvedPath = resolveWikilinkPath(wikilink.path, parentPath);
          lensRefs.push({
            source: currentFields.source,
            resolvedPath,
            optional: currentFields.optional?.toLowerCase() === 'true',
          });
        }
      }

      inLensSection = false;
      currentFields = {};
      currentField = null;
      currentValue = [];
      continue;
    }

    if (inLensSection) {
      // Parse fields
      const fieldMatch = line.match(FIELD_PATTERN);
      if (fieldMatch) {
        // Save previous field
        if (currentField) {
          currentFields[currentField] = currentValue.join('\n').trim();
        }
        currentField = fieldMatch[1];
        const inlineValue = fieldMatch[2].trim();
        currentValue = inlineValue ? [inlineValue] : [];
      } else if (currentField) {
        // Check if line starts a new section header
        if (line.match(/^#/)) {
          currentFields[currentField] = currentValue.join('\n').trim();
          currentField = null;
          currentValue = [];
        } else {
          currentValue.push(line);
        }
      }
    }
  }

  // Don't forget the last lens section
  if (inLensSection) {
    if (currentField) {
      currentFields[currentField] = currentValue.join('\n').trim();
    }

    if (currentFields.source) {
      const wikilink = parseWikilink(currentFields.source);
      if (wikilink) {
        const resolvedPath = resolveWikilinkPath(wikilink.path, parentPath);
        lensRefs.push({
          source: currentFields.source,
          resolvedPath,
          optional: currentFields.optional?.toLowerCase() === 'true',
        });
      }
    }
  }

  return lensRefs;
}

/**
 * After converting segments, apply collapsed_before/collapsed_after to article-excerpt segments.
 * This resolves the article source once and calls bundleArticleWithCollapsed to compute
 * which parts of the article are outside the excerpted ranges.
 */
function applyCollapsedContent(
  segments: Segment[],
  parsedSegments: ParsedLensSegment[],
  lensSection: ParsedLensSection,
  lensPath: string,
  files: Map<string, string>,
): void {
  // Only process lens-article sections with article-excerpt segments
  if (lensSection.type !== 'lens-article' || !lensSection.source) return;

  // Collect article-excerpt segment indices
  const excerptIndices: number[] = [];
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].type === 'article-excerpt') {
      excerptIndices.push(i);
    }
  }
  if (excerptIndices.length === 0) return;

  // Map to parsed segments to get anchors (order-preserving)
  const parsedExcerpts = parsedSegments.filter(ps => ps.type === 'article-excerpt');
  const excerptInfos = excerptIndices.map((segIdx, i) => ({
    index: segIdx,
    from: parsedExcerpts[i]?.fromAnchor,
    to: parsedExcerpts[i]?.toAnchor,
  }));

  // Only apply collapsed if at least one excerpt has anchors
  const hasAnchors = excerptInfos.some(e => e.from || e.to);
  if (!hasAnchors) return;

  // Resolve article path
  const wikilink = parseWikilink(lensSection.source);
  if (!wikilink || wikilink.error) return;

  const articlePathResolved = resolveWikilinkPath(wikilink.path, lensPath);
  const articlePath = findFileWithExtension(articlePathResolved, files);
  if (!articlePath) return;

  const articleContent = files.get(articlePath)!;

  // Call bundleArticleWithCollapsed
  const collapsedResults = bundleArticleWithCollapsed(
    articleContent,
    excerptInfos.map(e => ({ from: e.from, to: e.to })),
    articlePath,
  );

  // Overlay collapsed_before/collapsed_after onto segments
  for (let i = 0; i < excerptInfos.length && i < collapsedResults.length; i++) {
    const segIdx = excerptInfos[i].index;
    const collapsed = collapsedResults[i];
    const segment = segments[segIdx] as ArticleExcerptSegment;
    if (collapsed.collapsed_before) {
      segment.collapsed_before = collapsed.collapsed_before;
    }
    if (collapsed.collapsed_after) {
      segment.collapsed_after = collapsed.collapsed_after;
    }
  }
}

interface ConvertSegmentResult {
  segment: Segment | null;
  errors: ContentError[];
}

/**
 * Convert a parsed lens segment into a final flattened segment.
 * For article-excerpt and video-excerpt, this involves extracting content from source files.
 */
function convertSegment(
  parsedSegment: ParsedLensSegment,
  lensSection: ParsedLensSection,
  lensPath: string,
  files: Map<string, string>,
  visitedPaths: Set<string>,
  tierMap?: Map<string, ContentTier>
): ConvertSegmentResult {
  const errors: ContentError[] = [];

  switch (parsedSegment.type) {
    case 'text': {
      const segment: TextSegment = {
        type: 'text',
        content: parsedSegment.content,
      };
      if (parsedSegment.optional) {
        segment.optional = true;
      }
      return { segment, errors };
    }

    case 'chat': {
      const segment: ChatSegment = {
        type: 'chat',
      };
      if (parsedSegment.instructions) {
        segment.instructions = parsedSegment.instructions;
      }
      if (parsedSegment.hidePreviousContentFromUser) {
        segment.hidePreviousContentFromUser = true;
      }
      if (parsedSegment.hidePreviousContentFromTutor) {
        segment.hidePreviousContentFromTutor = true;
      }
      if (parsedSegment.optional) {
        segment.optional = true;
      }
      return { segment, errors };
    }

    case 'article-excerpt': {
      // Need to resolve the article path from the lens section's source field
      if (!lensSection.source) {
        errors.push({
          file: lensPath,
          message: 'Article section missing source:: field for article-excerpt',
          severity: 'error',
        });
        return { segment: null, errors };
      }

      const wikilink = parseWikilink(lensSection.source);
      if (!wikilink || wikilink.error) {
        const suggestion = wikilink?.correctedPath
          ? `Did you mean '[[${wikilink.correctedPath}]]'?`
          : undefined;
        errors.push({
          file: lensPath,
          message: `Invalid wikilink in article source: ${lensSection.source}`,
          suggestion,
          severity: 'error',
        });
        return { segment: null, errors };
      }

      const articlePathResolved = resolveWikilinkPath(wikilink.path, lensPath);
      const articlePath = findFileWithExtension(articlePathResolved, files);

      if (!articlePath) {
        // Find similar files to suggest
        const similarFiles = findSimilarFiles(articlePathResolved, files, 'articles');
        const suggestion = formatSuggestion(similarFiles, lensPath) ?? 'Check the file path in the wiki-link';

        errors.push({
          file: lensPath,
          message: `Referenced article file not found: ${articlePathResolved}`,
          suggestion,
          severity: 'error',
        });
        return { segment: null, errors };
      }

      // Check tier violation (Lens → Article)
      if (tierMap) {
        const parentTier = tierMap.get(lensPath) ?? 'production';
        const childTier = tierMap.get(articlePath) ?? 'production';
        const violation = checkTierViolation(lensPath, parentTier, articlePath, childTier, 'article');
        if (violation) {
          errors.push(violation);
        }
        if (childTier === 'ignored') {
          return { segment: null, errors };
        }
      }

      // Check if the article path points back to an already-visited structural file
      // This would indicate a circular reference (e.g., a lens source pointing back to an LO)
      // Note: We only check, we don't add article paths to visitedPaths since
      // multiple segments can legitimately reference the same article
      if (visitedPaths.has(articlePath)) {
        errors.push({
          file: lensPath,
          message: `Circular reference detected: ${articlePath}`,
          severity: 'error',
        });
        return { segment: null, errors };
      }

      const articleContent = files.get(articlePath)!;

      // Extract the excerpt
      const excerptResult = extractArticleExcerpt(
        articleContent,
        parsedSegment.fromAnchor,
        parsedSegment.toAnchor,
        articlePath
      );

      if (excerptResult.error) {
        errors.push({ ...excerptResult.error, file: lensPath });
        return { segment: null, errors };
      }

      const segment: ArticleExcerptSegment = {
        type: 'article-excerpt',
        content: excerptResult.content!,
      };
      if (parsedSegment.optional) {
        segment.optional = true;
      }
      return { segment, errors };
    }

    case 'video-excerpt': {
      // Need to resolve the video/transcript path from the lens section's source field
      if (!lensSection.source) {
        errors.push({
          file: lensPath,
          message: 'Video section missing source:: field for video-excerpt',
          severity: 'error',
        });
        return { segment: null, errors };
      }

      const wikilink = parseWikilink(lensSection.source);
      if (!wikilink || wikilink.error) {
        const suggestion = wikilink?.correctedPath
          ? `Did you mean '[[${wikilink.correctedPath}]]'?`
          : undefined;
        errors.push({
          file: lensPath,
          message: `Invalid wikilink in video source: ${lensSection.source}`,
          suggestion,
          severity: 'error',
        });
        return { segment: null, errors };
      }

      const videoPathResolved = resolveWikilinkPath(wikilink.path, lensPath);
      const videoPath = findFileWithExtension(videoPathResolved, files);

      if (!videoPath) {
        // Find similar files to suggest
        const similarFiles = findSimilarFiles(videoPathResolved, files, 'video_transcripts');
        const suggestion = formatSuggestion(similarFiles, lensPath) ?? 'Check the file path in the wiki-link';

        errors.push({
          file: lensPath,
          message: `Referenced video transcript file not found: ${videoPathResolved}`,
          suggestion,
          severity: 'error',
        });
        return { segment: null, errors };
      }

      // Check tier violation (Lens → Video)
      if (tierMap) {
        const parentTier = tierMap.get(lensPath) ?? 'production';
        const childTier = tierMap.get(videoPath) ?? 'production';
        const violation = checkTierViolation(lensPath, parentTier, videoPath, childTier, 'video transcript');
        if (violation) {
          errors.push(violation);
        }
        if (childTier === 'ignored') {
          return { segment: null, errors };
        }
      }

      // Check if the video path points back to an already-visited structural file
      // This would indicate a circular reference
      // Note: We only check, we don't add video paths to visitedPaths since
      // multiple segments can legitimately reference the same video
      if (visitedPaths.has(videoPath)) {
        errors.push({
          file: lensPath,
          message: `Circular reference detected: ${videoPath}`,
          severity: 'error',
        });
        return { segment: null, errors };
      }

      const transcriptContent = files.get(videoPath)!;

      // Look for corresponding .timestamps.json file
      // e.g., video_transcripts/foo.md -> video_transcripts/foo.timestamps.json
      const timestampsPath = videoPath.replace(/\.md$/, '.timestamps.json');
      let timestamps: TimestampEntry[] | undefined;
      // Debug: Log path resolution (uncomment to debug)
      // console.log('DEBUG videoPath:', videoPath);
      // console.log('DEBUG timestampsPath:', timestampsPath);
      // console.log('DEBUG files has timestamps:', files.has(timestampsPath));
      if (files.has(timestampsPath)) {
        try {
          timestamps = JSON.parse(files.get(timestampsPath)!) as TimestampEntry[];
          // console.log('DEBUG loaded timestamps count:', timestamps.length);
        } catch {
          // JSON parse error - will fall back to inline timestamps
        }
      }

      // Extract the video excerpt
      const excerptResult = extractVideoExcerpt(
        transcriptContent,
        parsedSegment.fromTimeStr,
        parsedSegment.toTimeStr,
        videoPath,
        timestamps
      );

      if (excerptResult.error) {
        errors.push({ ...excerptResult.error, file: lensPath });
        return { segment: null, errors };
      }

      const segment: VideoExcerptSegment = {
        type: 'video-excerpt',
        from: excerptResult.from!,
        to: excerptResult.to!,
        transcript: excerptResult.transcript!,
      };
      if (parsedSegment.optional) {
        segment.optional = true;
      }
      return { segment, errors };
    }

    case 'question': {
      const segment: QuestionSegment = {
        type: 'question',
        content: parsedSegment.content,
      };
      if (parsedSegment.assessmentInstructions) segment.assessmentInstructions = parsedSegment.assessmentInstructions;
      if (parsedSegment.maxTime) segment.maxTime = parsedSegment.maxTime;
      if (parsedSegment.maxChars !== undefined) segment.maxChars = parsedSegment.maxChars;
      if (parsedSegment.enforceVoice) segment.enforceVoice = true;
      if (parsedSegment.optional) segment.optional = true;
      if (parsedSegment.feedback) segment.feedback = true;
      return { segment, errors };
    }

    case 'roleplay': {
      const segment: RoleplaySegment = {
        type: 'roleplay',
        id: parsedSegment.id,
        content: parsedSegment.content,
        aiInstructions: parsedSegment.aiInstructions,
      };
      if (parsedSegment.openingMessage) segment.openingMessage = parsedSegment.openingMessage;
      if (parsedSegment.assessmentInstructions) segment.assessmentInstructions = parsedSegment.assessmentInstructions;
      if (parsedSegment.optional) segment.optional = true;
      if (parsedSegment.feedback) segment.feedback = true;
      return { segment, errors };
    }

    default:
      return { segment: null, errors };
  }
}

/**
 * Flatten a single Lens file into a FlattenedModule.
 *
 * This wraps a standalone Lens as a single-section module so it can be
 * rendered by the frontend using the existing Module.tsx component.
 *
 * The resulting module has:
 * - slug: 'lens/' + fileNameToSlug(lensPath)
 * - title: extracted from source metadata or lens header
 * - sections: exactly one section (lens-article, lens-video, or page)
 *
 * @param lensPath - Path to the lens file within the files Map
 * @param files - Map of all file paths to their content
 * @param tierMap - Optional tier map for filtering ignored content
 * @param preParsedLens - Optional pre-parsed lens to avoid re-parsing
 * @returns Flattened module with a single section, plus any errors
 */
export function flattenLens(
  lensPath: string,
  files: Map<string, string>,
  tierMap?: Map<string, ContentTier>,
  preParsedLens?: ParsedLens,
): FlattenModuleResult {
  const errors: ContentError[] = [];

  // Skip ignored lenses
  if (tierMap?.get(lensPath) === 'ignored') {
    return { module: null, modules: [], errors };
  }

  const lensContent = files.get(lensPath);
  if (!lensContent) {
    errors.push({
      file: lensPath,
      message: `Lens file not found: ${lensPath}`,
      severity: 'error',
    });
    return { module: null, modules: [], errors };
  }

  // Use pre-parsed lens if provided, otherwise parse
  const lens = preParsedLens ?? (() => {
    const lensResult = parseLens(lensContent, lensPath);
    errors.push(...lensResult.errors);
    return lensResult.lens;
  })();

  if (!lens) {
    return { module: null, modules: [], errors };
  }

  const visitedPaths = new Set<string>([lensPath]);

  // Process lens sections into a single flattened Section
  let sectionType: 'page' | 'lens-video' | 'lens-article' = 'page';
  const meta: SectionMeta = {};
  const segments: Segment[] = [];
  let videoId: string | undefined;

  for (const lensSection of lens.sections) {
    if (lensSection.type === 'lens-article') {
      sectionType = 'lens-article';

      // Extract article metadata from the article file's frontmatter
      if (lensSection.source) {
        const articleWikilink = parseWikilink(lensSection.source);
        if (articleWikilink && !articleWikilink.error) {
          const articlePathResolved = resolveWikilinkPath(articleWikilink.path, lensPath);
          const articlePath = findFileWithExtension(articlePathResolved, files);
          if (articlePath) {
            const articleContent = files.get(articlePath)!;
            const articleFrontmatter = parseFrontmatter(articleContent, articlePath);
            if (articleFrontmatter.frontmatter.title)
              meta.title = articleFrontmatter.frontmatter.title as string;
            if (articleFrontmatter.frontmatter.author)
              meta.author = articleFrontmatter.frontmatter.author as string;
            if (articleFrontmatter.frontmatter.source_url)
              meta.sourceUrl = articleFrontmatter.frontmatter.source_url as string;
            if (articleFrontmatter.frontmatter.published)
              meta.published = String(articleFrontmatter.frontmatter.published);
          }
        }
      }
    } else if (lensSection.type === 'page') {
      sectionType = 'page';
      if (lensSection.title) meta.title = lensSection.title;
    } else if (lensSection.type === 'lens-video') {
      sectionType = 'lens-video';

      // Extract video metadata from the video transcript file's frontmatter
      if (lensSection.source) {
        const videoWikilink = parseWikilink(lensSection.source);
        if (videoWikilink && !videoWikilink.error) {
          const videoPathResolved = resolveWikilinkPath(videoWikilink.path, lensPath);
          const videoPath = findFileWithExtension(videoPathResolved, files);
          if (videoPath) {
            const videoContent = files.get(videoPath)!;
            const videoFrontmatter = parseFrontmatter(videoContent, videoPath);
            if (videoFrontmatter.frontmatter.title)
              meta.title = videoFrontmatter.frontmatter.title as string;
            if (videoFrontmatter.frontmatter.channel)
              meta.channel = videoFrontmatter.frontmatter.channel as string;
            if (videoFrontmatter.frontmatter.url) {
              const extractedId = extractVideoIdFromUrl(videoFrontmatter.frontmatter.url as string);
              if (extractedId) videoId = extractedId;
            }
          }
        }
      }
    }

    // Process segments
    for (const parsedSegment of lensSection.segments) {
      const segmentResult = convertSegment(parsedSegment, lensSection, lensPath, files, visitedPaths, tierMap);
      errors.push(...segmentResult.errors);
      if (segmentResult.segment) segments.push(segmentResult.segment);
    }

    // Apply collapsed content to article-excerpt segments
    applyCollapsedContent(segments, lensSection.segments, lensSection, lensPath, files);
  }

  // Fallback title from filename if not extracted from source metadata
  if (!meta.title) {
    meta.title = fileNameToSlug(lensPath).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  const section: Section = {
    type: sectionType,
    meta,
    segments,
    optional: false,
    learningOutcomeId: null,
    learningOutcomeName: null,
    contentId: lens.id ?? null,
    tldr: lens.tldr,
    videoId: videoId ?? null,
    ...computeSectionStats(segments),
  };

  const flattenedModule: FlattenedModule = {
    slug: 'lens/' + fileNameToSlug(lensPath),
    title: meta.title ?? fileNameToSlug(lensPath),
    contentId: lens.id ?? null,
    sections: [section],
  };

  return { module: flattenedModule, modules: [flattenedModule], errors };
}
