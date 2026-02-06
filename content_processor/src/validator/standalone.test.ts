// src/validator/standalone.test.ts
import { describe, it, expect } from 'vitest';
import { processContent } from '../index.js';

describe('standalone file validation', () => {
  describe('Lenses not referenced by modules', () => {
    it('reports structural errors in standalone Lenses', () => {
      const files = new Map([
        // A lens with missing required content:: field in Text segment
        ['Lenses/orphan-lens.md', `---
id: 550e8400-e29b-41d4-a716-446655440001
---
### Page: Missing Content

#### Text
`],  // Missing content:: field
      ]);

      const result = processContent(files);

      // Should catch the missing content:: field even though no module uses this lens
      expect(result.errors.some(e =>
        e.file.includes('orphan-lens') &&
        e.message.toLowerCase().includes('content')
      )).toBe(true);
    });

    it('reports missing id in standalone Lens', () => {
      const files = new Map([
        ['Lenses/no-id-lens.md', `---
title: Missing ID
---
### Page: Intro

#### Text
content:: Hello world
`],
      ]);

      const result = processContent(files);

      expect(result.errors.some(e =>
        e.file.includes('no-id-lens') &&
        e.message.toLowerCase().includes('id')
      )).toBe(true);
    });

    it('validates article excerpt anchors in standalone Lens', () => {
      const files = new Map([
        ['Lenses/bad-anchor-lens.md', `---
id: 550e8400-e29b-41d4-a716-446655440002
---
### Article: Test
source:: [[../articles/test.md]]

#### Article-excerpt
from:: This anchor does not exist in the article
to:: Neither does this one
`],
        ['articles/test.md', `---
title: Test
---

The actual article content is completely different.
`],
      ]);

      const result = processContent(files);

      // Should report anchor not found error
      expect(result.errors.some(e =>
        e.file.includes('bad-anchor-lens') &&
        e.message.toLowerCase().includes('not found')
      )).toBe(true);
    });

    it('validates video excerpt timestamps in standalone Lens', () => {
      const files = new Map([
        ['Lenses/bad-timestamp-lens.md', `---
id: 550e8400-e29b-41d4-a716-446655440003
---
### Video: Test Video
source:: [[../video_transcripts/test.md]]

#### Video-excerpt
from:: 5:00
to:: 10:00
`],
        ['video_transcripts/test.md', `---
title: Test Video
---

0:00 - Introduction to the topic
1:00 - First main point
2:00 - Second main point
3:00 - Conclusion
`],
      ]);

      const result = processContent(files);

      // Should report timestamp not found (5:00 doesn't exist)
      expect(result.errors.some(e =>
        e.file.includes('bad-timestamp-lens') &&
        e.message.toLowerCase().includes('not found')
      )).toBe(true);
    });

    it('reports missing source file in standalone Lens', () => {
      const files = new Map([
        ['Lenses/missing-source-lens.md', `---
id: 550e8400-e29b-41d4-a716-446655440004
---
### Article: Test
source:: [[../articles/nonexistent.md]]

#### Article-excerpt
from:: start
to:: end
`],
      ]);

      const result = processContent(files);

      // Should report source file not found
      expect(result.errors.some(e =>
        e.file.includes('missing-source-lens') &&
        e.message.toLowerCase().includes('not found')
      )).toBe(true);
    });
  });

  describe('Learning Outcomes not referenced by modules', () => {
    it('reports structural errors in standalone Learning Outcomes', () => {
      const files = new Map([
        // An LO with missing source field - NOT referenced by any module
        ['Learning Outcomes/orphan-lo.md', `---
id: 550e8400-e29b-41d4-a716-446655440010
---
## Lens: Test
`],  // Missing source:: field
      ]);

      const result = processContent(files);

      // Should catch the missing source:: field
      expect(result.errors.some(e =>
        e.file.includes('orphan-lo') &&
        e.message.toLowerCase().includes('source')
      )).toBe(true);
    });

    it('reports missing id in standalone Learning Outcome', () => {
      const files = new Map([
        ['Learning Outcomes/no-id-lo.md', `---
title: Missing ID
---
## Lens: Test
source:: [[../Lenses/test.md]]
`],
      ]);

      const result = processContent(files);

      expect(result.errors.some(e =>
        e.file.includes('no-id-lo') &&
        e.message.toLowerCase().includes('id')
      )).toBe(true);
    });

    it('reports missing Lens section in standalone Learning Outcome', () => {
      const files = new Map([
        ['Learning Outcomes/no-lens-lo.md', `---
id: 550e8400-e29b-41d4-a716-446655440011
---
Just some text, no Lens section.
`],
      ]);

      const result = processContent(files);

      expect(result.errors.some(e =>
        e.file.includes('no-lens-lo') &&
        e.message.toLowerCase().includes('lens')
      )).toBe(true);
    });
  });

  describe('no false positives', () => {
    it('does not report errors for valid standalone Lens', () => {
      const files = new Map([
        ['Lenses/valid-lens.md', `---
id: 550e8400-e29b-41d4-a716-446655440020
---
### Page: Intro

#### Text
content:: This is valid content.

#### Chat
instructions:: Discuss the topic.
`],
      ]);

      const result = processContent(files);

      const lensErrors = result.errors.filter(e => e.file.includes('valid-lens'));
      expect(lensErrors).toHaveLength(0);
    });

    it('does not report errors for valid standalone Learning Outcome', () => {
      const files = new Map([
        ['Learning Outcomes/valid-lo.md', `---
id: 550e8400-e29b-41d4-a716-446655440021
---
## Lens: Introduction
source:: [[../Lenses/intro.md]]
`],
        ['Lenses/intro.md', `---
id: 550e8400-e29b-41d4-a716-446655440022
---
### Page: Intro

#### Text
content:: Hello
`],
      ]);

      const result = processContent(files);

      const loErrors = result.errors.filter(e => e.file.includes('valid-lo'));
      expect(loErrors).toHaveLength(0);
    });
  });
});
