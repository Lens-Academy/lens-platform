// src/flattener/test-helpers.ts
// Shared test fixture builders for flattener tests

/**
 * Minimal lens file that produces a page-type section with text content.
 */
export function pageLens(id: string, title: string, content: string): string {
  return `---
id: ${id}
---

### Page: ${title}

#### Text
content:: ${content}
`;
}

/**
 * Minimal LO file referencing N lenses (flat, no submodules).
 */
export function simpleLO(
  id: string,
  lensRefs: { path: string; optional?: boolean }[]
): string {
  const sections = lensRefs.map(ref => {
    let section = `## Lens:\nsource:: [[${ref.path}]]`;
    if (ref.optional) section += '\noptional:: true';
    return section;
  }).join('\n\n');

  return `---
id: '${id}'
---

${sections}
`;
}

/**
 * LO file WITH ## Submodule: markers between lenses.
 */
export function loWithSubmodules(
  id: string,
  groups: { title: string; slug?: string; lensRefs: string[] }[]
): string {
  const sections = groups.map(group => {
    const header = group.slug
      ? `## Submodule: ${group.title}\nslug:: ${group.slug}`
      : `## Submodule: ${group.title}`;
    const lenses = group.lensRefs.map(ref =>
      `### Lens:\nsource:: [[${ref}]]`
    ).join('\n\n');
    return `${header}\n\n${lenses}`;
  }).join('\n\n');

  return `---
id: '${id}'
---

${sections}
`;
}

/**
 * Build Map from a parts object.
 */
export function buildFiles(parts: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(parts));
}
