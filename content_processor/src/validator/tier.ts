// src/validator/tier.ts — Content tier classification and violation checks
import type { ContentError } from '../index.js';
import { parseFrontmatter } from '../parser/frontmatter.js';

export type ContentTier = 'production' | 'wip' | 'ignored';

/**
 * Determine content tier from frontmatter tags.
 * - tags containing 'validator-ignore' → 'ignored'
 * - tags containing 'wip' → 'wip'
 * - otherwise → 'production'
 */
export function getTierFromFrontmatter(frontmatter: Record<string, unknown>): ContentTier {
  const tags = frontmatter.tags;
  if (!Array.isArray(tags)) return 'production';
  const normalized = tags.map((t: unknown) => String(t).toLowerCase());
  if (normalized.includes('validator-ignore')) return 'ignored';
  if (normalized.includes('wip') || normalized.includes('work-in-progress')) return 'wip';
  return 'production';
}

/**
 * Build a tier map for all .md files by parsing their frontmatter tags.
 */
export function buildTierMap(files: Map<string, string>): Map<string, ContentTier> {
  const tierMap = new Map<string, ContentTier>();
  for (const [path, content] of files.entries()) {
    if (!path.endsWith('.md')) continue;
    const { frontmatter } = parseFrontmatter(content, path);
    tierMap.set(path, getTierFromFrontmatter(frontmatter));
  }
  return tierMap;
}

/**
 * Check for tier violations when a parent references a child.
 * Returns a ContentError if the reference violates tier rules, null otherwise.
 */
export function checkTierViolation(
  parentPath: string,
  parentTier: ContentTier,
  childPath: string,
  childTier: ContentTier,
  childLabel: string,
  line?: number,
): ContentError | null {
  // Ignored parents are never processed (filtered upstream)
  if (parentTier === 'ignored') return null;

  // Production parent → child must be production
  if (parentTier === 'production' && childTier === 'wip') {
    return {
      file: parentPath,
      line,
      message: `References WIP ${childLabel}: ${childPath}`,
      suggestion: `Remove the WIP tag from ${childPath}, or add tags: [wip] to this file`,
      severity: 'error',
      category: 'production',
    };
  }
  if (parentTier === 'production' && childTier === 'ignored') {
    return {
      file: parentPath,
      line,
      message: `References ignored ${childLabel}: ${childPath}`,
      suggestion: `Remove the validator-ignore tag from ${childPath}, or add tags: [wip] to this file`,
      severity: 'error',
      category: 'production',
    };
  }

  // WIP parent → child must not be ignored
  if (parentTier === 'wip' && childTier === 'ignored') {
    return {
      file: parentPath,
      line,
      message: `References ignored ${childLabel}: ${childPath}`,
      suggestion: `Remove the validator-ignore tag from ${childPath}`,
      severity: 'error',
      category: 'wip',
    };
  }

  return null;
}
