// src/flattener/index.ts
import type {
  FlattenedModule,
  Section,
  Segment,
  TextSegment,
  ChatSegment,
  ArticleSegment,
  VideoSegment,
  QuestionSegment,
  RoleplaySegment,
  ContentError,
  SectionMeta,
} from '../index.js';
import type { ContentTier } from '../validator/tier.js';
import { checkTierViolation } from '../validator/tier.js';
import { parseModule, type ParsedModule, hasFieldBeforeSegmentHeaders } from '../parser/module.js';
import { parseLearningOutcome, type ParsedTestRef } from '../parser/learning-outcome.js';
import { parseLens, type ParsedLens, type ParsedLensSegment, type ParsedArticleSegment } from '../parser/lens.js';
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
    if (seg.type === 'text' || seg.type === 'article') {
      words += countWords(seg.content);
    } else if (seg.type === 'video') {
      if (seg.to != null) videoSeconds += seg.to - seg.from;
    }
  }
  const stats: { wordCount?: number; videoDurationSeconds?: number } = {};
  if (words > 0) stats.wordCount = words;
  if (videoSeconds > 0) stats.videoDurationSeconds = videoSeconds;
  return stats;
}

/** Derive display type from segment content for UI icons/labels. */
function computeDisplayType(segments: Segment[]): 'lens-article' | 'lens-video' | 'lens-mixed' | undefined {
  let hasArticle = false;
  let hasVideo = false;
  for (const seg of segments) {
    if (seg.type === 'article') hasArticle = true;
    if (seg.type === 'video') hasVideo = true;
  }
  if (hasArticle && hasVideo) return 'lens-mixed';
  if (hasArticle) return 'lens-article';
  if (hasVideo) return 'lens-video';
  return undefined;
}

/**
 * Extract YouTube video ID from a YouTube URL.
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

// ─── Shared helper: flatten a single ParsedLens into output segments ───

interface FlattenSingleLensResult {
  segments: Segment[];
  errors: ContentError[];
}

/**
 * Flatten a single ParsedLens into output Segments.
 * This is the shared core used by all lens-processing functions.
 *
 * For each segment in the lens, calls convertSegment to resolve article/video content.
 * Then applies collapsed content for article segments from the same source.
 */
function flattenSingleLens(
  lens: ParsedLens,
  lensPath: string,
  files: Map<string, string>,
  visitedPaths: Set<string>,
  tierMap?: Map<string, ContentTier>
): FlattenSingleLensResult {
  const errors: ContentError[] = [];
  const segments: Segment[] = [];

  for (const parsedSegment of lens.segments) {
    const segmentResult = convertSegment(parsedSegment, lensPath, files, visitedPaths, tierMap);
    errors.push(...segmentResult.errors);
    if (segmentResult.segment) {
      segments.push(segmentResult.segment);
    }
  }

  // Apply collapsed content for article segments
  applyCollapsedContent(segments, lens.segments, lensPath, files);

  return { segments, errors };
}

// ─── Module flattening ───

/**
 * Flatten a module by resolving all references to Learning Outcomes, Lenses, and content.
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

  // Helper: process a section (LO or Lens) and return Section[]
  function processSection(
    section: { type: string; title: string; rawType: string; fields: Record<string, string>; body: string; line: number; level: number; children?: any[]; inlineLens?: ParsedLens },
    _subsectionLevel?: number
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
    } else if (section.type === 'lens') {
      // Referenced lens (has source::) or inline lens
      const sectionVisitedPaths = new Set(visitedPaths);
      const result = flattenLensSection(
        section,
        modulePath,
        files,
        sectionVisitedPaths,
        tierMap,
        section.inlineLens
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

      // Process children
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

  for (const parsedSegment of testRef.segments) {
    const segmentResult = convertSegment(
      parsedSegment,
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
      const { segments, errors: flattenErrors } = flattenSingleLens(lens, lensPath, files, sectionVisitedPaths, tierMap);
      errors.push(...flattenErrors);

      const lo = loResult.learningOutcome!;
      items.push({
        type: 'lens',
        meta: { title: lens.title || section.title },
        segments,
        optional: section.fields.optional?.toLowerCase() === 'true' || lensRef.optional,
        learningOutcomeId: lo.id ?? null,
        learningOutcomeName: loPath.split('/').pop()?.replace(/\.md$/i, '') ?? null,
        contentId: lens.id ?? null,
        tldr: lens.tldr,
        summaryForTutor: lens.summaryForTutor,
        ...computeSectionStats(segments),
        displayType: computeDisplayType(segments),
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

  // Also emit LO parse errors
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

  // Check tier violation (module -> LO)
  if (tierMap) {
    const parentTier = tierMap.get(modulePath) ?? 'production';
    const childTier = tierMap.get(loPath) ?? 'production';
    const violation = checkTierViolation(modulePath, parentTier, loPath, childTier, 'learning outcome', section.line);
    if (violation) {
      errors.push(violation);
    }
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

    // Check tier violation (LO -> Lens)
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

    // Flatten lens segments using shared helper
    const { segments, errors: flattenErrors } = flattenSingleLens(lens, lensPath, files, visitedPaths, tierMap);
    errors.push(...flattenErrors);

    // Create a section for this lens
    const resultSection: Section = {
      type: 'lens',
      meta: { title: lens.title || section.title },
      segments,
      optional: section.fields.optional?.toLowerCase() === 'true' || lensRef.optional,
      learningOutcomeId: lo.id ?? null,
      learningOutcomeName: loPath.split('/').pop()?.replace(/\.md$/i, '') ?? null,
      contentId: lens.id ?? null,
      tldr: lens.tldr,
      summaryForTutor: lens.summaryForTutor,
      ...computeSectionStats(segments),
      displayType: computeDisplayType(segments),
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
 * Flatten a # Lens: section from a module file.
 * Handles both referenced lenses (with source:: wikilink) and inline lenses (with id:: + segments).
 */
function flattenLensSection(
  section: { type: string; title: string; fields: Record<string, string>; body: string; line: number; level: number },
  modulePath: string,
  files: Map<string, string>,
  visitedPaths: Set<string>,
  tierMap?: Map<string, ContentTier>,
  inlineLens?: ParsedLens
): FlattenMultipleSectionsResult {
  const errors: ContentError[] = [];
  const sections: Section[] = [];

  // Inline lens: has id:: + segments (no source:: at section level)
  if (inlineLens) {
    const { segments, errors: flattenErrors } = flattenSingleLens(inlineLens, modulePath, files, visitedPaths, tierMap);
    errors.push(...flattenErrors);

    const resultSection: Section = {
      type: 'lens',
      meta: { title: inlineLens.title || section.title },
      segments,
      optional: section.fields.optional?.toLowerCase() === 'true',
      learningOutcomeId: null,
      learningOutcomeName: null,
      contentId: inlineLens.id ?? null,
      tldr: inlineLens.tldr,
      summaryForTutor: inlineLens.summaryForTutor,
      ...computeSectionStats(segments),
      displayType: computeDisplayType(segments),
    };

    sections.push(resultSection);
    return { sections, errors };
  }

  // Referenced lens: has source:: at section level (not from segment fields)
  const hasSectionSource = hasFieldBeforeSegmentHeaders(section.body, 'source', section.level);
  const source = hasSectionSource ? section.fields.source : undefined;
  if (!source) {
    errors.push({
      file: modulePath,
      line: section.line,
      message: 'Lens section missing source:: field (or id:: for inline lens)',
      suggestion: "Add 'source:: [[../Lenses/filename.md|Display]]' or 'id:: <uuid>' with #### segments",
      severity: 'error',
    });
    return { sections: [], errors };
  }

  // Parse and resolve the wikilink
  const wikilink = parseWikilink(source);
  if (!wikilink || wikilink.error) {
    const suggestion = wikilink?.correctedPath
      ? `Did you mean '[[${wikilink.correctedPath}]]'?`
      : 'Use format [[../Lenses/filename.md|Display Text]]';
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

  const lensPathResolved = resolveWikilinkPath(wikilink.path, modulePath);
  const lensPath = findFileWithExtension(lensPathResolved, files);

  if (!lensPath) {
    const similarFiles = findSimilarFiles(lensPathResolved, files, 'Lenses');
    const suggestion = formatSuggestion(similarFiles, modulePath) ?? 'Check the file path in the wiki-link';

    errors.push({
      file: modulePath,
      message: `Referenced lens file not found: ${lensPathResolved}`,
      suggestion,
      severity: 'error',
    });
    return { sections: [], errors };
  }

  // Check tier violation
  if (tierMap) {
    const parentTier = tierMap.get(modulePath) ?? 'production';
    const childTier = tierMap.get(lensPath) ?? 'production';
    const violation = checkTierViolation(modulePath, parentTier, lensPath, childTier, 'lens');
    if (violation) {
      errors.push(violation);
    }
    if (childTier === 'ignored') {
      return { sections: [], errors };
    }
  }

  // Check for circular reference
  if (visitedPaths.has(lensPath)) {
    errors.push({
      file: modulePath,
      message: `Circular reference detected: ${lensPath}`,
      severity: 'error',
    });
    return { sections: [], errors };
  }
  visitedPaths.add(lensPath);

  const lensContent = files.get(lensPath)!;
  const lensResult = parseLens(lensContent, lensPath);
  errors.push(...lensResult.errors);

  if (!lensResult.lens) {
    return { sections: [], errors };
  }

  const lens = lensResult.lens;
  const { segments, errors: flattenErrors } = flattenSingleLens(lens, lensPath, files, visitedPaths, tierMap);
  errors.push(...flattenErrors);

  const resultSection: Section = {
    type: 'lens',
    meta: { title: lens.title || section.title },
    segments,
    optional: section.fields.optional?.toLowerCase() === 'true',
    learningOutcomeId: null,
    learningOutcomeName: null,
    contentId: lens.id ?? null,
    tldr: lens.tldr,
    summaryForTutor: lens.summaryForTutor,
    ...computeSectionStats(segments),
    displayType: computeDisplayType(segments),
  };

  sections.push(resultSection);
  return { sections, errors };
}

// ─── Collapsed content and segment conversion ───

/**
 * After converting segments, apply collapsed_before/collapsed_after to article segments.
 * Groups article segments by their resolved source path, then calls bundleArticleWithCollapsed
 * for each group.
 */
function applyCollapsedContent(
  segments: Segment[],
  parsedSegments: ParsedLensSegment[],
  lensPath: string,
  files: Map<string, string>,
): void {
  // Build groups of article segments by resolved source path
  const sourceGroups = new Map<string, { segmentIndex: number; fromAnchor?: string; toAnchor?: string }[]>();

  // Map output article segments back to parsed segments for source info
  let articleOutputIdx = 0;
  for (let i = 0; i < parsedSegments.length; i++) {
    const ps = parsedSegments[i];
    if (ps.type !== 'article') continue;

    // Find corresponding output segment
    while (articleOutputIdx < segments.length && segments[articleOutputIdx].type !== 'article') {
      articleOutputIdx++;
    }
    if (articleOutputIdx >= segments.length) break;

    if (ps.source) {
      const wikilink = parseWikilink(ps.source);
      if (wikilink && !wikilink.error) {
        const resolved = resolveWikilinkPath(wikilink.path, lensPath);
        const actualPath = findFileWithExtension(resolved, files);
        if (actualPath) {
          if (!sourceGroups.has(actualPath)) {
            sourceGroups.set(actualPath, []);
          }
          sourceGroups.get(actualPath)!.push({
            segmentIndex: articleOutputIdx,
            fromAnchor: ps.fromAnchor,
            toAnchor: ps.toAnchor,
          });
        }
      }
    }
    articleOutputIdx++;
  }

  // For each source group, apply collapsed content
  for (const [articlePath, excerptInfos] of sourceGroups) {
    // Only apply collapsed if at least one excerpt has anchors
    const hasAnchors = excerptInfos.some(e => e.fromAnchor || e.toAnchor);
    if (!hasAnchors) continue;

    const articleContent = files.get(articlePath);
    if (!articleContent) continue;

    const collapsedResults = bundleArticleWithCollapsed(
      articleContent,
      excerptInfos.map(e => ({ from: e.fromAnchor, to: e.toAnchor })),
      articlePath,
    );

    for (let i = 0; i < excerptInfos.length && i < collapsedResults.length; i++) {
      const segIdx = excerptInfos[i].segmentIndex;
      const collapsed = collapsedResults[i];
      const segment = segments[segIdx] as ArticleSegment;
      if (collapsed.collapsed_before) {
        segment.collapsed_before = collapsed.collapsed_before;
      }
      if (collapsed.collapsed_after) {
        segment.collapsed_after = collapsed.collapsed_after;
      }
    }
  }
}

interface ConvertSegmentResult {
  segment: Segment | null;
  errors: ContentError[];
}

/**
 * Convert a parsed lens segment into a final flattened segment.
 * For article and video, this involves extracting content from source files.
 * Source comes from the parsed segment itself (set via inheritance in parseLens).
 */
function convertSegment(
  parsedSegment: ParsedLensSegment,
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

    case 'article': {
      // Source comes from the parsed segment (set via inheritance in parseLens)
      if (!parsedSegment.source) {
        errors.push({
          file: lensPath,
          message: 'Article segment missing source (should have been set via inheritance)',
          severity: 'error',
        });
        return { segment: null, errors };
      }

      const wikilink = parseWikilink(parsedSegment.source);
      if (!wikilink || wikilink.error) {
        const suggestion = wikilink?.correctedPath
          ? `Did you mean '[[${wikilink.correctedPath}]]'?`
          : undefined;
        errors.push({
          file: lensPath,
          message: `Invalid wikilink in article source: ${parsedSegment.source}`,
          suggestion,
          severity: 'error',
        });
        return { segment: null, errors };
      }

      const articlePathResolved = resolveWikilinkPath(wikilink.path, lensPath);
      const articlePath = findFileWithExtension(articlePathResolved, files);

      if (!articlePath) {
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

      // Check tier violation (Lens -> Article)
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

      if (visitedPaths.has(articlePath)) {
        errors.push({
          file: lensPath,
          message: `Circular reference detected: ${articlePath}`,
          severity: 'error',
        });
        return { segment: null, errors };
      }

      const articleContent = files.get(articlePath)!;

      // Extract article metadata from frontmatter
      const articleFrontmatter = parseFrontmatter(articleContent, articlePath);
      const fm = articleFrontmatter.frontmatter;

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

      const segment: ArticleSegment = {
        type: 'article',
        content: excerptResult.content!,
      };

      // Populate metadata from article frontmatter
      if (fm.title) segment.title = fm.title as string;
      if (fm.author) {
        const raw = fm.author;
        segment.author = Array.isArray(raw) ? raw.join(', ') : String(raw);
      }
      if (fm.source_url) segment.sourceUrl = fm.source_url as string;
      if (fm.published) segment.published = String(fm.published);

      if (parsedSegment.optional) {
        segment.optional = true;
      }
      return { segment, errors };
    }

    case 'video': {
      // Source comes from the parsed segment (set via inheritance in parseLens)
      if (!parsedSegment.source) {
        errors.push({
          file: lensPath,
          message: 'Video segment missing source (should have been set via inheritance)',
          severity: 'error',
        });
        return { segment: null, errors };
      }

      const wikilink = parseWikilink(parsedSegment.source);
      if (!wikilink || wikilink.error) {
        const suggestion = wikilink?.correctedPath
          ? `Did you mean '[[${wikilink.correctedPath}]]'?`
          : undefined;
        errors.push({
          file: lensPath,
          message: `Invalid wikilink in video source: ${parsedSegment.source}`,
          suggestion,
          severity: 'error',
        });
        return { segment: null, errors };
      }

      const videoPathResolved = resolveWikilinkPath(wikilink.path, lensPath);
      const videoPath = findFileWithExtension(videoPathResolved, files);

      if (!videoPath) {
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

      // Check tier violation (Lens -> Video)
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

      if (visitedPaths.has(videoPath)) {
        errors.push({
          file: lensPath,
          message: `Circular reference detected: ${videoPath}`,
          severity: 'error',
        });
        return { segment: null, errors };
      }

      const transcriptContent = files.get(videoPath)!;

      // Extract video metadata from frontmatter
      const videoFrontmatter = parseFrontmatter(transcriptContent, videoPath);
      const vfm = videoFrontmatter.frontmatter;

      // Look for corresponding .timestamps.json file
      const timestampsPath = videoPath.replace(/\.md$/, '.timestamps.json');
      let timestamps: TimestampEntry[] | undefined;
      if (files.has(timestampsPath)) {
        try {
          timestamps = JSON.parse(files.get(timestampsPath)!) as TimestampEntry[];
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

      const segment: VideoSegment = {
        type: 'video',
        from: excerptResult.from!,
        to: excerptResult.to!,
        transcript: excerptResult.transcript!,
      };

      // Populate metadata from video transcript frontmatter
      if (vfm.title) segment.title = vfm.title as string;
      if (vfm.channel) segment.channel = vfm.channel as string;
      if (vfm.url) {
        const extractedId = extractVideoIdFromUrl(vfm.url as string);
        if (extractedId) segment.videoId = extractedId;
      }

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

  // Flatten lens segments using shared helper
  const { segments, errors: flattenErrors } = flattenSingleLens(lens, lensPath, files, visitedPaths, tierMap);
  errors.push(...flattenErrors);

  // Derive title: frontmatter > first article/video segment > filename
  const meta: SectionMeta = {};
  if (lens.title) {
    meta.title = lens.title;
  } else {
    for (const seg of segments) {
      if (seg.type === 'article' && seg.title) {
        meta.title = seg.title;
        break;
      } else if (seg.type === 'video' && seg.title) {
        meta.title = seg.title;
        break;
      }
    }
    if (!meta.title) {
      meta.title = fileNameToSlug(lensPath).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }
  }

  const section: Section = {
    type: 'lens',
    meta,
    segments,
    optional: false,
    learningOutcomeId: null,
    learningOutcomeName: null,
    contentId: lens.id ?? null,
    tldr: lens.tldr,
    summaryForTutor: lens.summaryForTutor,
    ...computeSectionStats(segments),
    displayType: computeDisplayType(segments),
  };

  const flattenedModule: FlattenedModule = {
    slug: 'lens/' + fileNameToSlug(lensPath),
    title: meta.title ?? fileNameToSlug(lensPath),
    contentId: lens.id ?? null,
    sections: [section],
  };

  return { module: flattenedModule, modules: [flattenedModule], errors };
}
