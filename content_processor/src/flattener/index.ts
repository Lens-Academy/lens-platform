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
import { parseModule, parsePageTextSegments } from '../parser/module.js';
import { parseLearningOutcome } from '../parser/learning-outcome.js';
import { parseLens, type ParsedLensSegment, type ParsedLensSection } from '../parser/lens.js';
import { parseWikilink, resolveWikilinkPath, findFileWithExtension, findSimilarFiles, formatSuggestion } from '../parser/wikilink.js';
import { parseFrontmatter } from '../parser/frontmatter.js';
import { extractArticleExcerpt } from '../bundler/article.js';
import { extractVideoExcerpt, type TimestampEntry } from '../bundler/video.js';

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
 * @param visitedPaths - Optional set of already-visited paths for cycle detection
 * @returns Flattened module with resolved sections and segments, plus any errors
 */
export function flattenModule(
  modulePath: string,
  files: Map<string, string>,
  visitedPaths: Set<string> = new Set()
): FlattenModuleResult {
  // Check for circular reference
  if (visitedPaths.has(modulePath)) {
    return {
      module: null,
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
      // Create a copy of visitedPaths for this section's reference chain
      // This allows the same file to be referenced in different sections
      // while still detecting cycles within a single chain
      const sectionVisitedPaths = new Set(visitedPaths);
      const result = flattenLearningOutcomeSection(
        section,
        modulePath,
        files,
        sectionVisitedPaths
      );
      errors.push(...result.errors);
      flattenedSections.push(...result.sections);
    } else if (section.type === 'page') {
      // Page sections don't have LO references, they have inline content
      // Parse the section body for ## Text subsections
      const textResult = parsePageTextSegments(section.body, modulePath, section.line);
      errors.push(...textResult.errors);

      const pageSection: Section = {
        type: 'page',
        meta: { title: section.title },
        segments: textResult.segments,
        optional: section.fields.optional === 'true',
        contentId: section.fields.id ?? null,
        learningOutcomeId: null,
        learningOutcomeName: null,
        videoId: null,
      };

      flattenedSections.push(pageSection);
    } else if (section.type === 'uncategorized') {
      // Uncategorized sections can contain ## Lens: references
      // Each lens becomes its own section (lens-video, lens-article, or page)
      const sectionVisitedPaths = new Set(visitedPaths);
      const result = flattenUncategorizedSection(
        section,
        modulePath,
        files,
        sectionVisitedPaths
      );
      errors.push(...result.errors);
      flattenedSections.push(...result.sections);
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
  visitedPaths: Set<string>
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
  if (!wikilink) {
    errors.push({
      file: modulePath,
      line: section.line,
      message: `Invalid wikilink format: ${source}`,
      suggestion: 'Use format [[../Learning Outcomes/filename.md|Display Text]]',
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
          if (articleWikilink) {
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
                meta.author = articleFrontmatter.frontmatter.author as string;
              }
              if (articleFrontmatter.frontmatter.sourceUrl) {
                meta.sourceUrl = articleFrontmatter.frontmatter.sourceUrl as string;
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
          if (videoWikilink) {
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
          visitedPaths
        );
        errors.push(...segmentResult.errors);

        if (segmentResult.segment) {
          segments.push(segmentResult.segment);
        }
      }
    }

    // Create a section for this lens
    // Optional can come from either:
    // 1. The LO reference in the module (section.fields.optional) - makes ALL lenses optional
    // 2. The individual lens reference in the LO (lensRef.optional) - makes just this lens optional
    const resultSection: Section = {
      type: sectionType,
      meta,
      segments,
      optional: section.fields.optional === 'true' || lensRef.optional,
      learningOutcomeId: lo.id ?? null,
      learningOutcomeName: loPath.split('/').pop()?.replace(/\.md$/i, '') ?? null,
      contentId: lens.id ?? null,
      videoId: videoId ?? null,
    };

    sections.push(resultSection);
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
  visitedPaths: Set<string>
): FlattenMultipleSectionsResult {
  const errors: ContentError[] = [];
  const sections: Section[] = [];

  // Parse the section body for ## Lens: subsections
  const lensRefs = parseUncategorizedLensRefs(section.body, modulePath);

  // If no lens refs found, return empty array
  if (lensRefs.length === 0) {
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
          if (articleWikilink) {
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
                meta.author = articleFrontmatter.frontmatter.author as string;
              }
              if (articleFrontmatter.frontmatter.sourceUrl) {
                meta.sourceUrl = articleFrontmatter.frontmatter.sourceUrl as string;
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
          if (videoWikilink) {
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
          visitedPaths
        );
        errors.push(...segmentResult.errors);

        if (segmentResult.segment) {
          segments.push(segmentResult.segment);
        }
      }
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
      videoId: videoId ?? null,
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
              optional: currentFields.optional === 'true',
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
        if (wikilink) {
          const resolvedPath = resolveWikilinkPath(wikilink.path, parentPath);
          lensRefs.push({
            source: currentFields.source,
            resolvedPath,
            optional: currentFields.optional === 'true',
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
          optional: currentFields.optional === 'true',
        });
      }
    }
  }

  return lensRefs;
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
  visitedPaths: Set<string>
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
