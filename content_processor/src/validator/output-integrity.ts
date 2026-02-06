import type { ContentError, FlattenedModule } from '../index.js';

/**
 * Broad safety-net validation on the flattened output.
 * Catches empty sections (no segments) and empty segments (no content)
 * that specific validators might have missed.
 */
export function validateOutputIntegrity(
  modules: FlattenedModule[],
  slugToPath?: Map<string, string>,
): ContentError[] {
  const errors: ContentError[] = [];

  for (const module of modules) {
    const file = slugToPath?.get(module.slug) ?? module.slug;

    for (const section of module.sections) {
      const sectionLabel = section.meta.title ?? section.type;

      if (section.segments.length === 0) {
        errors.push({
          file,
          message: `Section "${sectionLabel}" has no segments`,
          severity: 'error',
        });
        continue;
      }

      for (let i = 0; i < section.segments.length; i++) {
        const segment = section.segments[i];

        switch (segment.type) {
          case 'text':
            if (!segment.content?.trim()) {
              errors.push({
                file,
                message: `Empty text segment in "${sectionLabel}" (segment ${i + 1})`,
                severity: 'error',
              });
            }
            break;
          case 'article-excerpt':
            if (!segment.content?.trim()) {
              errors.push({
                file,
                message: `Empty article-excerpt segment in "${sectionLabel}" (segment ${i + 1})`,
                severity: 'error',
              });
            }
            break;
          case 'video-excerpt':
            if (!segment.transcript?.trim()) {
              errors.push({
                file,
                message: `Empty video-excerpt transcript in "${sectionLabel}" (segment ${i + 1})`,
                severity: 'error',
              });
            }
            break;
          // chat segments have no required content body
        }
      }
    }
  }

  return errors;
}
