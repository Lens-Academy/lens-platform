import { describe, it, expect } from 'vitest';
import { processContent } from '../index.js';

describe('course slug alias collision detection', () => {
  const makeLens = (id: string) => `---
id: ${id}
---

# Lens: Test Lens
## Text
content`;

  const makeModule = (slug: string, lensPath: string) => `---
slug: ${slug}
title: ${slug}
---

# Lens: Test
source:: [[${lensPath}]]`;

  it('errors when alias collides with another course primary slug', () => {
    const files = new Map([
      ['courses/a.md', `---
slug: course-a
title: Course A
slug-aliases: course-b
---

# Module: [[../modules/mod-a.md|Mod A]]
`],
      ['courses/b.md', `---
slug: course-b
title: Course B
---

# Module: [[../modules/mod-b.md|Mod B]]
`],
      ['modules/mod-a.md', makeModule('mod-a', '../Lenses/lens-a.md')],
      ['modules/mod-b.md', makeModule('mod-b', '../Lenses/lens-b.md')],
      ['Lenses/lens-a.md', makeLens('00000000-0000-0000-0000-000000000001')],
      ['Lenses/lens-b.md', makeLens('00000000-0000-0000-0000-000000000002')],
    ]);

    const result = processContent(files);
    const aliasErrors = result.errors.filter(e =>
      e.message.includes('alias') && e.message.includes('course-b')
    );
    expect(aliasErrors.length).toBeGreaterThan(0);
    expect(aliasErrors[0].severity).toBe('error');
  });

  it('errors when two courses share the same alias', () => {
    const files = new Map([
      ['courses/a.md', `---
slug: course-a
title: Course A
slug-aliases: shared-alias
---

# Module: [[../modules/mod-a.md|Mod A]]
`],
      ['courses/b.md', `---
slug: course-b
title: Course B
slug-aliases: shared-alias
---

# Module: [[../modules/mod-b.md|Mod B]]
`],
      ['modules/mod-a.md', makeModule('mod-a', '../Lenses/lens-a.md')],
      ['modules/mod-b.md', makeModule('mod-b', '../Lenses/lens-b.md')],
      ['Lenses/lens-a.md', makeLens('00000000-0000-0000-0000-000000000001')],
      ['Lenses/lens-b.md', makeLens('00000000-0000-0000-0000-000000000002')],
    ]);

    const result = processContent(files);
    const aliasErrors = result.errors.filter(e =>
      e.message.includes('alias') && e.message.includes('shared-alias')
    );
    expect(aliasErrors.length).toBeGreaterThan(0);
  });

  it('errors when alias matches own primary slug', () => {
    const files = new Map([
      ['courses/a.md', `---
slug: course-a
title: Course A
slug-aliases: course-a
---

# Module: [[../modules/mod-a.md|Mod A]]
`],
      ['modules/mod-a.md', makeModule('mod-a', '../Lenses/lens-a.md')],
      ['Lenses/lens-a.md', makeLens('00000000-0000-0000-0000-000000000001')],
    ]);

    const result = processContent(files);
    const aliasErrors = result.errors.filter(e =>
      e.message.includes('alias') && e.message.includes('course-a')
    );
    expect(aliasErrors.length).toBeGreaterThan(0);
  });

  it('allows valid aliases with no collisions', () => {
    const files = new Map([
      ['courses/a.md', `---
slug: course-a
title: Course A
slug-aliases: old-course-a
---

# Module: [[../modules/mod-a.md|Mod A]]
`],
      ['modules/mod-a.md', makeModule('mod-a', '../Lenses/lens-a.md')],
      ['Lenses/lens-a.md', makeLens('00000000-0000-0000-0000-000000000001')],
    ]);

    const result = processContent(files);
    const aliasErrors = result.errors.filter(e => e.message.includes('alias'));
    expect(aliasErrors).toHaveLength(0);
  });
});
