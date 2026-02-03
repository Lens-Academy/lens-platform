// src/flattener/index.ts
import type {
  FlattenedModule,
  Section,
  Segment,
  TextSegment,
  ChatSegment,
  ArticleExcerptSegment,
  VideoExcerptSegment,
  ContentError,
  SectionMeta,
} from '../index.js';
import { parseModule } from '../parser/module.js';
import { parseLearningOutcome } from '../parser/learning-outcome.js';
import { parseLens, type ParsedLensSegment, type ParsedLensSection } from '../parser/lens.js';
import { parseWikilink, resolveWikilinkPath } from '../parser/wikilink.js';
import { extractArticleExcerpt } from '../bundler/article.js';
import { extractVideoExcerpt } from '../bundler/video.js';

export interface FlattenModuleResult {
  module: FlattenedModule | null;
  errors: ContentError[];
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
 * @returns Flattened module with resolved sections and segments, plus any errors
 */
export function flattenModule(
  modulePath: string,
  files: Map<string, string>
): FlattenModuleResult {
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
    return { module: null, errors };
  }

  // Parse the module
  const moduleResult = parseModule(moduleContent, modulePath);
  errors.push(...moduleResult.errors);

  if (!moduleResult.module) {
    return { module: null, errors };
  }

  const parsedModule = moduleResult.module;
  const flattenedSections: Section[] = [];

  // Process each section in the module
  for (const section of parsedModule.sections) {
    if (section.type === 'learning-outcome') {
      // Resolve the Learning Outcome reference
      const result = flattenLearningOutcomeSection(
        section,
        modulePath,
        files
      );
      errors.push(...result.errors);

      if (result.section) {
        flattenedSections.push(result.section);
      } else if (result.errorMessage) {
        // Record the first error as the module-level error
        if (!moduleError) {
          moduleError = result.errorMessage;
        }
      }
    } else if (section.type === 'page') {
      // Page sections don't have LO references, they have inline content
      // For now, create a basic page section
      const pageSection: Section = {
        type: 'page',
        meta: { title: section.title },
        segments: [],
        optional: section.fields.optional === 'true',
      };
      flattenedSections.push(pageSection);
    } else if (section.type === 'uncategorized') {
      // Uncategorized sections are similar to pages
      const uncategorizedSection: Section = {
        type: 'page',
        meta: { title: section.title },
        segments: [],
        optional: section.fields.optional === 'true',
      };
      flattenedSections.push(uncategorizedSection);
    }
  }

  const flattenedModule: FlattenedModule = {
    slug: parsedModule.slug,
    title: parsedModule.title,
    contentId: parsedModule.contentId,
    sections: flattenedSections,
  };

  if (moduleError) {
    flattenedModule.error = moduleError;
  }

  return { module: flattenedModule, errors };
}

interface FlattenSectionResult {
  section: Section | null;
  errors: ContentError[];
  errorMessage?: string;
}

/**
 * Flatten a Learning Outcome section by resolving its LO file and all referenced lenses.
 */
function flattenLearningOutcomeSection(
  section: { type: string; title: string; fields: Record<string, string>; line: number },
  modulePath: string,
  files: Map<string, string>
): FlattenSectionResult {
  const errors: ContentError[] = [];

  // Get the source wikilink
  const source = section.fields.source;
  if (!source) {
    const err: ContentError = {
      file: modulePath,
      line: section.line,
      message: 'Learning Outcome section missing source:: field',
      suggestion: "Add 'source:: [[../Learning Outcomes/filename.md|Display]]'",
      severity: 'error',
    };
    errors.push(err);
    return { section: null, errors, errorMessage: err.message };
  }

  // Parse and resolve the wikilink
  const wikilink = parseWikilink(source);
  if (!wikilink) {
    const err: ContentError = {
      file: modulePath,
      line: section.line,
      message: `Invalid wikilink format: ${source}`,
      suggestion: 'Use format [[../Learning Outcomes/filename.md|Display Text]]',
      severity: 'error',
    };
    errors.push(err);
    return { section: null, errors, errorMessage: err.message };
  }

  const loPath = resolveWikilinkPath(wikilink.path, modulePath);

  // Get the LO file content
  const loContent = files.get(loPath);
  if (!loContent) {
    const err: ContentError = {
      file: modulePath,
      line: section.line,
      message: `Referenced file not found: ${loPath}`,
      suggestion: 'Check the file path in the wiki-link',
      severity: 'error',
    };
    errors.push(err);
    return { section: null, errors, errorMessage: err.message };
  }

  // Parse the Learning Outcome
  const loResult = parseLearningOutcome(loContent, loPath);
  errors.push(...loResult.errors);

  if (!loResult.learningOutcome) {
    return {
      section: null,
      errors,
      errorMessage: `Failed to parse Learning Outcome: ${loPath}`,
    };
  }

  const lo = loResult.learningOutcome;

  // Flatten all lenses in this LO
  // For now, we'll take all segments from all lenses and combine them
  const allSegments: Segment[] = [];
  let sectionType: 'page' | 'lens-video' | 'lens-article' = 'page';
  const meta: SectionMeta = { title: section.title };

  for (const lensRef of lo.lenses) {
    const lensContent = files.get(lensRef.resolvedPath);
    if (!lensContent) {
      const err: ContentError = {
        file: loPath,
        message: `Referenced lens file not found: ${lensRef.resolvedPath}`,
        suggestion: 'Check the file path in the wiki-link',
        severity: 'error',
      };
      errors.push(err);
      continue;
    }

    // Parse the lens
    const lensResult = parseLens(lensContent, lensRef.resolvedPath);
    errors.push(...lensResult.errors);

    if (!lensResult.lens) {
      continue;
    }

    const lens = lensResult.lens;

    // Process each section in the lens
    for (const lensSection of lens.sections) {
      // Determine section type from lens section
      if (lensSection.type === 'lens-article') {
        sectionType = 'lens-article';
      } else if (lensSection.type === 'lens-video') {
        sectionType = 'lens-video';
      }

      // Process segments
      for (const parsedSegment of lensSection.segments) {
        const segmentResult = convertSegment(
          parsedSegment,
          lensSection,
          lensRef.resolvedPath,
          files
        );
        errors.push(...segmentResult.errors);

        if (segmentResult.segment) {
          allSegments.push(segmentResult.segment);
        }
      }
    }
  }

  const resultSection: Section = {
    type: sectionType,
    meta,
    segments: allSegments,
    optional: section.fields.optional === 'true',
    learningOutcomeId: lo.id,
  };

  return { section: resultSection, errors };
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
  files: Map<string, string>
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
      if (!wikilink) {
        errors.push({
          file: lensPath,
          message: `Invalid wikilink in article source: ${lensSection.source}`,
          severity: 'error',
        });
        return { segment: null, errors };
      }

      const articlePath = resolveWikilinkPath(wikilink.path, lensPath);
      const articleContent = files.get(articlePath);

      if (!articleContent) {
        errors.push({
          file: lensPath,
          message: `Referenced article file not found: ${articlePath}`,
          suggestion: 'Check the file path in the wiki-link',
          severity: 'error',
        });
        return { segment: null, errors };
      }

      // Extract the excerpt
      const excerptResult = extractArticleExcerpt(
        articleContent,
        parsedSegment.fromAnchor,
        parsedSegment.toAnchor,
        articlePath
      );

      if (excerptResult.error) {
        errors.push(excerptResult.error);
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
      if (!wikilink) {
        errors.push({
          file: lensPath,
          message: `Invalid wikilink in video source: ${lensSection.source}`,
          severity: 'error',
        });
        return { segment: null, errors };
      }

      const videoPath = resolveWikilinkPath(wikilink.path, lensPath);
      const transcriptContent = files.get(videoPath);

      if (!transcriptContent) {
        errors.push({
          file: lensPath,
          message: `Referenced video transcript file not found: ${videoPath}`,
          suggestion: 'Check the file path in the wiki-link',
          severity: 'error',
        });
        return { segment: null, errors };
      }

      // Extract the video excerpt
      const excerptResult = extractVideoExcerpt(
        transcriptContent,
        parsedSegment.fromTimeStr,
        parsedSegment.toTimeStr,
        videoPath
      );

      if (excerptResult.error) {
        errors.push(excerptResult.error);
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

    default:
      return { segment: null, errors };
  }
}
