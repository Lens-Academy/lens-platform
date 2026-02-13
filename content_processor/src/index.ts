export interface UrlToValidate {
  url: string;
  file: string;
  line: number;
  label: string;
}

export interface ProcessResult {
  modules: FlattenedModule[];
  courses: Course[];
  errors: ContentError[];
  urlsToValidate: UrlToValidate[];
}

export interface FlattenedModule {
  slug: string;
  title: string;
  contentId: string | null;
  sections: Section[];
  error?: string;
  warnings?: string[];
}

export interface Course {
  slug: string;
  title: string;
  progression: ProgressionItem[];
  error?: string;
}

export interface Section {
  type: 'page' | 'lens-video' | 'lens-article';
  meta: SectionMeta;
  segments: Segment[];
  optional?: boolean;
  contentId: string | null;
  learningOutcomeId: string | null;
  learningOutcomeName: string | null;
  videoId: string | null;  // video sections only
}

export interface SectionMeta {
  title?: string;
  author?: string;      // article sections only
  sourceUrl?: string;   // article sections only
  channel?: string;     // video sections only
}

export interface ProgressionItem {
  type: 'module' | 'meeting';
  slug?: string;
  number?: number;
  optional?: boolean;
}

export interface ContentError {
  file: string;
  line?: number;
  message: string;
  suggestion?: string;
  severity: 'error' | 'warning';
}

// Segment types with their specific fields
export interface TextSegment {
  type: 'text';
  content: string;
  optional?: boolean;
}

export interface ChatSegment {
  type: 'chat';
  instructions?: string;
  hidePreviousContentFromUser?: boolean;
  hidePreviousContentFromTutor?: boolean;
  optional?: boolean;
}

export interface ArticleExcerptSegment {
  type: 'article-excerpt';
  content: string;              // Extracted excerpt content
  collapsed_before?: string;    // Content between previous excerpt and this one (snake_case for Python compat)
  collapsed_after?: string;     // Content after this excerpt to end/next excerpt
  optional?: boolean;
}

export interface VideoExcerptSegment {
  type: 'video-excerpt';
  from: number;                 // Start time in seconds
  to: number | null;            // End time in seconds (null = until end)
  transcript: string;           // Extracted transcript content
  optional?: boolean;
}

export type Segment = TextSegment | ChatSegment | ArticleExcerptSegment | VideoExcerptSegment;

import { flattenModule } from './flattener/index.js';
import { parseModule } from './parser/module.js';
import { parseCourse } from './parser/course.js';
import { parseLearningOutcome } from './parser/learning-outcome.js';
import { parseLens, type ParsedLens } from './parser/lens.js';
import { parseWikilink, resolveWikilinkPath, findFileWithExtension, findSimilarFiles, formatSuggestion } from './parser/wikilink.js';
import { validateUuids, type UuidEntry } from './validator/uuid.js';
import { detectDuplicateSlugs, type SlugEntry } from './validator/duplicates.js';
import { validateOutputIntegrity } from './validator/output-integrity.js';
import { extractArticleExcerpt } from './bundler/article.js';
import { extractVideoExcerpt, type TimestampEntry } from './bundler/video.js';
import { parseArticle } from './parser/article.js';
import { parseVideoTranscript } from './parser/video-transcript.js';
import { validateTimestamps } from './validator/timestamps.js';
import { levenshtein } from './validator/field-typos.js';

/**
 * Validate lens excerpts by checking if source files exist and anchors/timestamps are valid.
 */
function validateLensExcerpts(
  lens: ParsedLens,
  lensPath: string,
  files: Map<string, string>
): ContentError[] {
  const errors: ContentError[] = [];

  for (const section of lens.sections) {
    // Skip sections without source (e.g., Text sections)
    if (!section.source) continue;

    // Resolve the source wikilink to get the actual file path
    const wikilink = parseWikilink(section.source);
    if (!wikilink || wikilink.error) continue;

    const resolvedPath = resolveWikilinkPath(wikilink.path, lensPath);
    const actualPath = findFileWithExtension(resolvedPath, files);

    if (!actualPath) {
      // Find similar files to suggest
      const expectedDir = section.type.includes('article') ? 'articles' : 'video_transcripts';
      const similarFiles = findSimilarFiles(resolvedPath, files, expectedDir);
      const suggestion = formatSuggestion(similarFiles, lensPath) ?? 'Check that the file exists and the path is correct';

      errors.push({
        file: lensPath,
        line: section.line,
        message: `Source file not found: ${resolvedPath}`,
        suggestion,
        severity: 'error',
      });
      continue;
    }

    const sourceContent = files.get(actualPath)!;

    // Validate article excerpts
    if (section.type === 'article' || section.type === 'lens-article') {
      for (const segment of section.segments) {
        if (segment.type === 'article-excerpt') {
          const result = extractArticleExcerpt(
            sourceContent,
            segment.fromAnchor,
            segment.toAnchor,
            actualPath
          );
          if (result.error) {
            errors.push({ ...result.error, file: lensPath });
          }
        }
      }
    }

    // Validate video excerpts
    if (section.type === 'video' || section.type === 'lens-video') {
      // Look for corresponding .timestamps.json file
      const timestampsPath = actualPath.replace(/\.md$/, '.timestamps.json');
      let timestamps: TimestampEntry[] | undefined;
      if (files.has(timestampsPath)) {
        try {
          timestamps = JSON.parse(files.get(timestampsPath)!) as TimestampEntry[];
        } catch {
          // JSON parse error - will fall back to inline timestamps
        }
      }

      for (const segment of section.segments) {
        if (segment.type === 'video-excerpt') {
          const result = extractVideoExcerpt(
            sourceContent,
            segment.fromTimeStr,
            segment.toTimeStr,
            actualPath,
            timestamps
          );
          if (result.error) {
            errors.push({ ...result.error, file: lensPath });
          }
        }
      }
    }
  }

  return errors;
}

export interface ProcessOptions {
  includeWip?: boolean;
}

/**
 * Check if a file path contains a WIP directory segment (case-insensitive).
 */
function isWipPath(path: string): boolean {
  return path.split('/').some(segment => segment.toLowerCase().includes('wip'));
}

export function processContent(files: Map<string, string>, options: ProcessOptions = {}): ProcessResult {
  const modules: FlattenedModule[] = [];
  const courses: Course[] = [];
  const errors: ContentError[] = [];
  const urlsToValidate: UrlToValidate[] = [];
  const uuidEntries: UuidEntry[] = [];
  const slugEntries: SlugEntry[] = [];
  const slugToPath = new Map<string, string>();

  // Identify file types by path
  for (const [path, content] of files.entries()) {
    // Skip WIP directories unless includeWip is set
    if (!options.includeWip && isWipPath(path)) {
      continue;
    }

    if (path.startsWith('modules/')) {
      const result = flattenModule(path, files);

      if (result.module) {
        modules.push(result.module);
        slugToPath.set(result.module.slug, path);

        // Collect slug for duplicate detection
        slugEntries.push({
          slug: result.module.slug,
          file: path,
        });

        // Collect module contentId for UUID validation
        if (result.module.contentId) {
          uuidEntries.push({
            uuid: result.module.contentId,
            file: path,
            field: 'contentId',
          });
        }

        // Collect section-level id:: fields from raw # Page: sections.
        // (Lens-derived sections inherit lens.id which is validated separately.)
        const rawParse = parseModule(content, path);
        if (rawParse.module) {
          for (const section of rawParse.module.sections) {
            if (section.type === 'page' && section.fields.id) {
              uuidEntries.push({
                uuid: section.fields.id,
                file: path,
                field: 'section id',
              });
            }
          }
        }
      }

      errors.push(...result.errors);
    } else if (path.startsWith('courses/')) {
      const result = parseCourse(content, path);

      if (result.course) {
        courses.push(result.course);
      }

      errors.push(...result.errors);
    } else if (path.startsWith('Learning Outcomes/') || path.includes('/Learning Outcomes/')) {
      // Fully validate Learning Outcome (structure, fields, wikilink syntax)
      const result = parseLearningOutcome(content, path);
      errors.push(...result.errors);

      // Check that referenced lens files exist
      if (result.learningOutcome) {
        for (const lensRef of result.learningOutcome.lenses) {
          const lensPath = findFileWithExtension(lensRef.resolvedPath, files);
          if (!lensPath) {
            // Find similar files to suggest
            const similarFiles = findSimilarFiles(lensRef.resolvedPath, files, 'Lenses');
            const suggestion = formatSuggestion(similarFiles, path) ?? 'Check the file path in the wiki-link';

            errors.push({
              file: path,
              message: `Referenced lens file not found: ${lensRef.resolvedPath}`,
              suggestion,
              severity: 'error',
            });
          }
        }
      }

      // Collect id for UUID validation
      if (result.learningOutcome?.id) {
        uuidEntries.push({
          uuid: result.learningOutcome.id,
          file: path,
          field: 'id',
        });
      }
    } else if (path.startsWith('Lenses/') || path.includes('/Lenses/')) {
      // Fully validate Lens (structure, segments, fields)
      const result = parseLens(content, path);
      errors.push(...result.errors);

      // Validate excerpts (source files exist, anchors/timestamps valid)
      if (result.lens) {
        const excerptErrors = validateLensExcerpts(result.lens, path, files);
        errors.push(...excerptErrors);
      }

      // Collect id for UUID validation
      if (result.lens?.id) {
        uuidEntries.push({
          uuid: result.lens.id,
          file: path,
          field: 'id',
        });
      }
    } else if (path.endsWith('.timestamps.json')) {
      const tsErrors = validateTimestamps(content, path);
      errors.push(...tsErrors);
    } else if (path.startsWith('articles/') || path.includes('/articles/')) {
      const result = parseArticle(content, path);
      errors.push(...result.errors);
      if (result.article) {
        urlsToValidate.push({ url: result.article.sourceUrl, file: path, line: 2, label: 'source_url' });
        for (const img of result.article.imageUrls) {
          urlsToValidate.push({ url: img.url, file: path, line: img.line, label: 'Image URL' });
        }
      }
    } else if (path.startsWith('video_transcripts/') || path.includes('/video_transcripts/')) {
      const result = parseVideoTranscript(content, path);
      errors.push(...result.errors);
      if (result.transcript) {
        urlsToValidate.push({ url: result.transcript.url, file: path, line: 2, label: 'url' });
      }
    } else {
      // File didn't match any known directory pattern — check for near-misses via Levenshtein distance
      const dir = path.split('/')[0];
      const VALID_DIRS = ['modules', 'courses', 'articles', 'Lenses', 'video_transcripts', 'Learning Outcomes'];
      let closest = '';
      let minDist = Infinity;
      for (const valid of VALID_DIRS) {
        const dist = levenshtein(dir.toLowerCase(), valid.toLowerCase());
        if (dist < minDist) {
          minDist = dist;
          closest = valid;
        }
      }
      // Threshold: distance <= 3 or <= 40% of the directory name length (whichever is smaller)
      const threshold = Math.min(3, Math.ceil(dir.length * 0.4));
      if (minDist > 0 && minDist <= threshold) {
        errors.push({
          file: path,
          message: `File in directory '${dir}/' not recognized as content`,
          suggestion: `Did you mean '${closest}/'?`,
          severity: 'warning',
        });
      }
    }
  }

  // Validate all collected UUIDs
  const uuidValidation = validateUuids(uuidEntries);
  errors.push(...uuidValidation.errors);

  // Validate for duplicate slugs
  const duplicateSlugErrors = detectDuplicateSlugs(slugEntries);
  errors.push(...duplicateSlugErrors);

  // Validate video transcript / timestamps.json pairing
  const transcriptPaths = [...files.keys()].filter(p =>
    (p.startsWith('video_transcripts/') || p.includes('/video_transcripts/')) &&
    p.endsWith('.md') &&
    (options.includeWip || !isWipPath(p))
  );
  const timestampPaths = new Set(
    [...files.keys()].filter(p => p.endsWith('.timestamps.json'))
  );

  for (const mdPath of transcriptPaths) {
    const expectedTs = mdPath.replace(/\.md$/, '.timestamps.json');
    if (!timestampPaths.has(expectedTs)) {
      errors.push({
        file: mdPath,
        message: `Missing timestamps.json: expected ${expectedTs}`,
        severity: 'error',
      });
    }
  }

  for (const tsPath of timestampPaths) {
    if (!options.includeWip && isWipPath(tsPath)) continue;
    const expectedMd = tsPath.replace(/\.timestamps\.json$/, '.md');
    if (!files.has(expectedMd)) {
      errors.push({
        file: tsPath,
        message: `Orphaned timestamps file: no matching .md transcript found`,
        severity: 'warning',
      });
    }
  }

  // Safety-net: catch empty sections/segments in final output
  const integrityErrors = validateOutputIntegrity(modules, slugToPath);
  errors.push(...integrityErrors);

  return { modules, courses, errors, urlsToValidate };
}
