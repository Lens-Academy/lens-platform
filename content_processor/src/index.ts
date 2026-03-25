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
  parentSlug?: string;
  parentTitle?: string;
  error?: string;
  warnings?: string[];
}

export interface Course {
  slug: string;
  title: string;
  slugAliases?: string[];
  progression: ProgressionItem[];
  error?: string;
}

export interface Section {
  type: 'lens' | 'test';
  displayType?: 'lens-article' | 'lens-video' | 'lens-mixed';
  meta: SectionMeta;
  segments: Segment[];
  optional?: boolean;
  hide?: boolean;
  feedback?: boolean;
  contentId: string | null;
  learningOutcomeId: string | null;
  learningOutcomeName: string | null;
  wordCount?: number;              // word count of text + article segments
  videoDurationSeconds?: number;   // total seconds of video segments
  tldr?: string;
  summaryForTutor?: string;
}

export interface SectionMeta {
  title?: string;
}

export interface ProgressionItem {
  type: 'module' | 'meeting';
  slug?: string;      // Frontmatter slug — set by processContent after resolving path
  path?: string;      // Raw wikilink path — set by course parser, removed by processContent
  name?: string;
  optional?: boolean;
}

export interface ContentError {
  file: string;
  line?: number;
  message: string;
  suggestion?: string;
  severity: 'error' | 'warning';
  category?: 'production' | 'wip';
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

export interface ArticleSegment {
  type: 'article';
  content: string;              // Extracted excerpt content
  collapsed_before?: string;    // Content between previous excerpt and this one (snake_case for Python compat)
  collapsed_after?: string;     // Content after this excerpt to end/next excerpt
  title?: string;               // From article frontmatter
  author?: string;              // From article frontmatter
  sourceUrl?: string;           // From article frontmatter
  published?: string;           // From article frontmatter
  optional?: boolean;
}

export interface VideoSegment {
  type: 'video';
  from: number;                 // Start time in seconds
  to: number | null;            // End time in seconds (null = until end)
  transcript: string;           // Extracted transcript content
  title?: string;               // From video transcript frontmatter
  channel?: string;             // From video transcript frontmatter
  videoId?: string;             // YouTube video ID from transcript URL
  optional?: boolean;
}

export interface QuestionSegment {
  type: 'question';
  content: string;
  assessmentInstructions?: string;
  maxTime?: string;
  maxChars?: number;
  enforceVoice?: boolean;
  optional?: boolean;
  feedback?: boolean;
}

export interface RoleplaySegment {
  type: 'roleplay';
  id: string;                     // UUID for session isolation
  content: string;
  aiInstructions: string;
  openingMessage?: string;
  assessmentInstructions?: string;
  optional?: boolean;
  feedback?: boolean;
}

export type Segment = TextSegment | ChatSegment | ArticleSegment | VideoSegment | QuestionSegment | RoleplaySegment;

import { flattenModule, flattenLens } from './flattener/index.js';
import { populateCardModuleSlugs, resolveInlineLensModuleSlugs } from './flattener/resolve-text-links.js';
import { parseModule, hasFieldBeforeSegmentHeaders } from './parser/module.js';
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
import { buildTierMap, checkTierViolation, type ContentTier } from './validator/tier.js';
export type { ContentTier } from './validator/tier.js';
export { checkTierViolation } from './validator/tier.js';

import type { ParsedSection } from './parser/sections.js';

/**
 * Recursively collect UUIDs from inline lens sections (including submodule children).
 */
function collectInlineLensUUIDs(
  sections: ParsedSection[],
  path: string,
  uuidEntries: UuidEntry[],
  errors: ContentError[]
): void {
  for (const section of sections) {
    if (section.type === 'lens') {
      if (section.inlineLens) {
        // Inline lens — id already validated in parseInlineLens
        uuidEntries.push({ uuid: section.fields.id, file: path, field: 'section id' });
      } else if (!hasFieldBeforeSegmentHeaders(section.body, 'source', section.level) && !section.fields.id) {
        // No section-level source:: and no id:: → missing required id
        errors.push({
          file: path,
          line: section.line,
          message: `Inline Lens section '${section.title}' is missing required id:: field`,
          suggestion: 'Add an id:: field with a UUID (e.g., id:: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)',
          severity: 'error',
        });
      } else if (section.fields.id) {
        // Has id:: — collect UUID
        uuidEntries.push({ uuid: section.fields.id, file: path, field: 'section id' });
      }
    }
    if (section.children) {
      collectInlineLensUUIDs(section.children, path, uuidEntries, errors);
    }
  }
}

/**
 * Validate lens excerpts by checking if source files exist and anchors/timestamps are valid.
 * Iterates flat segments, using each segment's source field (set via inheritance in parseLens).
 */
function validateLensExcerpts(
  lens: ParsedLens,
  lensPath: string,
  files: Map<string, string>,
  tierMap?: Map<string, ContentTier>
): ContentError[] {
  const errors: ContentError[] = [];

  for (const segment of lens.segments) {
    if (segment.type === 'article' && segment.source) {
      const wikilink = parseWikilink(segment.source);
      if (!wikilink || wikilink.error) continue;

      const resolvedPath = resolveWikilinkPath(wikilink.path, lensPath);
      const actualPath = findFileWithExtension(resolvedPath, files);

      if (!actualPath) {
        const similarFiles = findSimilarFiles(resolvedPath, files, 'articles');
        const suggestion = formatSuggestion(similarFiles, lensPath) ?? 'Check that the file exists and the path is correct';
        errors.push({ file: lensPath, message: `Source file not found: ${resolvedPath}`, suggestion, severity: 'error' });
        continue;
      }

      if (tierMap) {
        const parentTier = tierMap.get(lensPath) ?? 'production';
        const childTier = tierMap.get(actualPath) ?? 'production';
        const violation = checkTierViolation(lensPath, parentTier, actualPath, childTier, 'article');
        if (violation) { errors.push(violation); continue; }
        if (childTier === 'ignored') continue;
      }

      const sourceContent = files.get(actualPath)!;
      const result = extractArticleExcerpt(sourceContent, segment.fromAnchor, segment.toAnchor, actualPath);
      if (result.error) {
        errors.push({ ...result.error, file: lensPath });
      }
    } else if (segment.type === 'video' && segment.source) {
      const wikilink = parseWikilink(segment.source);
      if (!wikilink || wikilink.error) continue;

      const resolvedPath = resolveWikilinkPath(wikilink.path, lensPath);
      const actualPath = findFileWithExtension(resolvedPath, files);

      if (!actualPath) {
        const similarFiles = findSimilarFiles(resolvedPath, files, 'video_transcripts');
        const suggestion = formatSuggestion(similarFiles, lensPath) ?? 'Check that the file exists and the path is correct';
        errors.push({ file: lensPath, message: `Source file not found: ${resolvedPath}`, suggestion, severity: 'error' });
        continue;
      }

      if (tierMap) {
        const parentTier = tierMap.get(lensPath) ?? 'production';
        const childTier = tierMap.get(actualPath) ?? 'production';
        const violation = checkTierViolation(lensPath, parentTier, actualPath, childTier, 'video transcript');
        if (violation) { errors.push(violation); continue; }
        if (childTier === 'ignored') continue;
      }

      const timestampsPath = actualPath.replace(/\.md$/, '.timestamps.json');
      let timestamps: TimestampEntry[] | undefined;
      if (files.has(timestampsPath)) {
        try { timestamps = JSON.parse(files.get(timestampsPath)!) as TimestampEntry[]; } catch { /* fall back */ }
      }

      const sourceContent = files.get(actualPath)!;
      const result = extractVideoExcerpt(sourceContent, segment.fromTimeStr, segment.toTimeStr, actualPath, timestamps);
      if (result.error) {
        errors.push({ ...result.error, file: lensPath });
      }
    }
  }

  return errors;
}

export function processContent(files: Map<string, string>): ProcessResult {
  const modules: FlattenedModule[] = [];
  const courses: Course[] = [];
  const errors: ContentError[] = [];
  const urlsToValidate: UrlToValidate[] = [];
  const uuidEntries: UuidEntry[] = [];
  const slugEntries: SlugEntry[] = [];
  const slugToPath = new Map<string, string>();
  const filePathToSlug = new Map<string, string>();  // Reverse: file path → slug (survives duplicate slugs)
  const courseSlugToFile = new Map<string, string>();
  const parentSlugToChildren = new Map<string, string[]>();

  // Pre-scan: build tier map from frontmatter tags
  const tierMap = buildTierMap(files);

  // Identify file types by path
  for (const [path, content] of files.entries()) {
    // Skip ignored files entirely
    if (tierMap.get(path) === 'ignored') {
      continue;
    }

    if (path.startsWith('modules/')) {
      const result = flattenModule(path, files, new Set(), tierMap);

      for (const mod of result.modules) {
        modules.push(mod);
        slugToPath.set(mod.slug, path);

        // Track parent→children mapping for course expansion
        if (mod.parentSlug) {
          if (!parentSlugToChildren.has(mod.parentSlug)) {
            parentSlugToChildren.set(mod.parentSlug, []);
          }
          parentSlugToChildren.get(mod.parentSlug)!.push(mod.slug);
        } else {
          filePathToSlug.set(path, mod.slug);
        }

        slugEntries.push({ slug: mod.slug, file: path });

        if (mod.contentId) {
          uuidEntries.push({
            uuid: mod.contentId,
            file: path,
            field: 'contentId',
          });
        }
      }

      // If no submodules, set filePathToSlug for the primary module
      if (result.modules.length === 1 && !result.modules[0].parentSlug) {
        filePathToSlug.set(path, result.modules[0].slug);
      } else if (result.modules.length > 0 && result.modules[0].parentSlug) {
        // For split modules, map the file path to the parent slug
        filePathToSlug.set(path, result.modules[0].parentSlug);
      }

      // Collect section-level id:: fields from Lens sections (inline lenses).
      // Referenced lenses (with source::) get their id from the lens file itself.
      if (result.modules.length > 0) {
        const rawParse = parseModule(content, path);
        if (rawParse.module) {
          collectInlineLensUUIDs(rawParse.module.sections, path, uuidEntries, errors);
        }
      }

      errors.push(...result.errors);
    } else if (path.startsWith('courses/')) {
      const result = parseCourse(content, path);

      if (result.course) {
        courses.push(result.course);
        courseSlugToFile.set(result.course.slug, path);
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
            continue;
          }

          // Check tier violation (LO → Lens)
          const parentTier = tierMap.get(path) ?? 'production';
          const childTier = tierMap.get(lensPath) ?? 'production';
          const violation = checkTierViolation(path, parentTier, lensPath, childTier, 'lens');
          if (violation) {
            errors.push(violation);
            continue;
          }
          if (childTier === 'ignored') {
            continue;
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

      // Collect id for UUID validation
      if (result.lens?.id) {
        uuidEntries.push({
          uuid: result.lens.id,
          file: path,
          field: 'id',
        });
      }

      // Flatten lens as standalone module (pass pre-parsed lens to avoid re-parsing)
      if (result.lens) {
        const lensModuleResult = flattenLens(path, files, tierMap, result.lens);
        if (lensModuleResult.module) {
          modules.push(lensModuleResult.module);
          slugEntries.push({ slug: lensModuleResult.module.slug, file: path });
          slugToPath.set(lensModuleResult.module.slug, path);
        }
        errors.push(...lensModuleResult.errors);
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

  // Build contentId → moduleSlug mapping and populate moduleSlug in cross-module card links.
  // Prefer real modules over standalone lenses (lens/ prefix) — a lens that appears in
  // both a module and as a standalone should map to the module.
  const contentIdToModuleSlug = new Map<string, string>();
  for (const mod of modules) {
    if (mod.slug.startsWith('lens/')) continue; // Skip standalone lenses
    for (const section of mod.sections) {
      if (section.contentId) {
        contentIdToModuleSlug.set(section.contentId, mod.slug);
      }
    }
  }
  for (const mod of modules) {
    populateCardModuleSlugs(mod.sections, contentIdToModuleSlug);
    resolveInlineLensModuleSlugs(mod.sections, contentIdToModuleSlug);
  }

  // Resolve course module paths to frontmatter slugs.
  // Use filePathToSlug (built during module parsing) instead of inverting slugToPath,
  // because slugToPath loses entries when duplicate slugs exist.
  for (const course of courses) {
    const courseFile = courseSlugToFile.get(course.slug) ?? 'courses/';

    for (const item of course.progression) {
      if (item.type === 'module' && item.path) {
        // Resolve wikilink path relative to the course file
        const resolved = resolveWikilinkPath(item.path, courseFile);
        const actualFile = findFileWithExtension(resolved, files);

        if (actualFile && filePathToSlug.has(actualFile)) {
          item.slug = filePathToSlug.get(actualFile)!;
        } else {
          // Try matching just the filename stem against module file stems
          const stem = item.path.split('/').pop() ?? item.path;
          let matched = false;
          for (const [filePath, slug] of filePathToSlug.entries()) {
            const fileStem = filePath.replace(/\.md$/, '').split('/').pop() ?? '';
            if (fileStem === stem) {
              item.slug = slug;
              matched = true;
              break;
            }
          }

          if (!matched) {
            errors.push({
              file: courseFile,
              message: `Module reference could not be resolved: "${item.path}"`,
              suggestion: 'Check that the wikilink path points to an existing module file',
              severity: 'error',
            });
          }
        }

        // Clean up internal path field from output
        delete item.path;
      }
    }

    // Remove unresolved module items (no slug after resolution)
    course.progression = course.progression.filter(
      item => item.type !== 'module' || item.slug !== undefined
    );

    // Expand split modules: replace parent slug with child submodule slugs
    const expanded: typeof course.progression = [];
    for (const item of course.progression) {
      if (item.type === 'module' && item.slug && parentSlugToChildren.has(item.slug)) {
        const children = parentSlugToChildren.get(item.slug)!;
        for (const childSlug of children) {
          expanded.push({ ...item, slug: childSlug });
        }
      } else {
        expanded.push(item);
      }
    }
    course.progression = expanded;
  }

  // Check tier violations: Course → Module
  for (const course of courses) {
    const coursePath = courseSlugToFile.get(course.slug);
    if (!coursePath) continue;

    for (const item of course.progression) {
      if (item.type !== 'module' || !item.slug) continue;

      const modulePath = slugToPath.get(item.slug);

      if (modulePath && tierMap.has(modulePath)) {
        const parentTier = tierMap.get(coursePath) ?? 'production';
        const childTier = tierMap.get(modulePath) ?? 'production';
        const violation = checkTierViolation(coursePath, parentTier, modulePath, childTier, 'module');
        if (violation) {
          errors.push(violation);
        }
      }
    }
  }

  // Validate course slug alias collisions
  {
    // Map of all course slugs (primary + aliases) -> source file
    const allCourseSlugs = new Map<string, string>(); // slug -> file

    // Register primary slugs first
    for (const course of courses) {
      const file = courseSlugToFile.get(course.slug) ?? 'courses/';
      allCourseSlugs.set(course.slug, file);
    }

    // Check each alias against all known slugs
    for (const course of courses) {
      const file = courseSlugToFile.get(course.slug) ?? 'courses/';
      const tier = tierMap.get(file) ?? 'production';
      for (const alias of course.slugAliases ?? []) {
        const existing = allCourseSlugs.get(alias);
        if (existing) {
          errors.push({
            file,
            message: `Course slug alias '${alias}' collides with ${existing === file ? 'its own primary slug' : `slug in ${existing}`}`,
            suggestion: `Choose a different alias or remove the conflicting slug`,
            severity: tier === 'wip' ? 'warning' : 'error',
          });
        } else {
          allCourseSlugs.set(alias, file);
        }
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
    tierMap.get(p) !== 'ignored'
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
    const expectedMd = tsPath.replace(/\.timestamps\.json$/, '.md');
    if (tierMap.get(expectedMd) === 'ignored') continue;
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

  // Post-process: assign category to errors that don't already have one
  for (const error of errors) {
    if (!error.category) {
      const tier = tierMap.get(error.file);
      error.category = tier === 'wip' ? 'wip' : 'production';
    }
  }

  return { modules, courses, errors, urlsToValidate };
}
