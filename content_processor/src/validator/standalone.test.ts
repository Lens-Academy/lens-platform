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

  describe('articles', () => {
    it('reports no errors for valid article', () => {
      const files = new Map([
        ['articles/valid.md', `---
title: Test Article
author: Jane Doe
source_url: https://example.com/article
---

The article body.
`],
      ]);

      const result = processContent(files);

      const articleErrors = result.errors.filter(e => e.file.includes('valid'));
      expect(articleErrors).toHaveLength(0);
    });

    it('reports missing required fields in article', () => {
      const files = new Map([
        ['articles/bad.md', `---
title: Test
---

Body.
`],
      ]);

      const result = processContent(files);

      expect(result.errors.some(e =>
        e.file.includes('bad') &&
        e.message.toLowerCase().includes('author')
      )).toBe(true);
      expect(result.errors.some(e =>
        e.file.includes('bad') &&
        e.message.toLowerCase().includes('source_url')
      )).toBe(true);
    });

    it('reports wiki-link image errors in article', () => {
      const files = new Map([
        ['articles/wiki-img.md', `---
title: Test
author: Jane
source_url: https://example.com
---

![[image.png]]
`],
      ]);

      const result = processContent(files);

      expect(result.errors.some(e =>
        e.file.includes('wiki-img') &&
        (e.message.toLowerCase().includes('wiki-link') || e.message.toLowerCase().includes('wikilink'))
      )).toBe(true);
    });
  });

  describe('video transcripts', () => {
    it('reports no errors for valid video transcript', () => {
      const files = new Map([
        ['video_transcripts/valid.md', `---
title: Test Video
channel: Test Channel
url: "https://example.com/video"
---

0:00 - Hello world.
`],
        ['video_transcripts/valid.timestamps.json', JSON.stringify([
          { text: 'Hello world.', start: '0:00.00' },
        ])],
      ]);

      const result = processContent(files);

      const vtErrors = result.errors.filter(e => e.file.includes('valid'));
      expect(vtErrors).toHaveLength(0);
    });

    it('reports missing required fields in video transcript', () => {
      const files = new Map([
        ['video_transcripts/bad.md', `---
title: Test
---

Transcript text.
`],
      ]);

      const result = processContent(files);

      expect(result.errors.some(e =>
        e.file.includes('bad') &&
        e.message.toLowerCase().includes('channel')
      )).toBe(true);
      expect(result.errors.some(e =>
        e.file.includes('bad') &&
        e.message.toLowerCase().includes('url')
      )).toBe(true);
    });
  });

  describe('timestamps.json', () => {
    it('reports no errors for valid timestamps', () => {
      const files = new Map([
        ['video_transcripts/test.md', `---
title: Test Video
channel: Test Channel
url: "https://example.com/video"
---

Transcript.
`],
        ['video_transcripts/test.timestamps.json', JSON.stringify([
          { text: 'Hello', start: '0:00.40' },
          { text: 'world', start: '0:00.88' },
        ])],
      ]);

      const result = processContent(files);

      const tsErrors = result.errors.filter(e => e.file.includes('timestamps'));
      expect(tsErrors).toHaveLength(0);
    });

    it('reports errors for invalid timestamps', () => {
      const files = new Map([
        ['video_transcripts/bad.timestamps.json', '{ not valid json'],
      ]);

      const result = processContent(files);

      expect(result.errors.some(e =>
        e.file.includes('bad.timestamps') &&
        e.message.toLowerCase().includes('json')
      )).toBe(true);
    });
  });

  describe('video transcript / timestamps.json pairing', () => {
    it('reports error when video transcript has no timestamps.json', () => {
      const files = new Map([
        ['video_transcripts/lonely.md', `---
title: Lonely Video
channel: Test Channel
url: "https://example.com/video"
---

Some transcript text.
`],
      ]);

      const result = processContent(files);

      expect(result.errors.some(e =>
        e.file === 'video_transcripts/lonely.md' &&
        e.message.includes('timestamps.json') &&
        e.severity === 'error'
      )).toBe(true);
    });

    it('reports warning when timestamps.json has no matching transcript', () => {
      const files = new Map([
        ['video_transcripts/orphan.timestamps.json', JSON.stringify([
          { text: 'Hello', start: '0:00.40' },
        ])],
      ]);

      const result = processContent(files);

      expect(result.errors.some(e =>
        e.file === 'video_transcripts/orphan.timestamps.json' &&
        e.message.includes('.md') &&
        e.severity === 'warning'
      )).toBe(true);
    });

    it('reports no pairing errors when both exist', () => {
      const files = new Map([
        ['video_transcripts/paired.md', `---
title: Paired Video
channel: Test Channel
url: "https://example.com/video"
---

Transcript text.
`],
        ['video_transcripts/paired.timestamps.json', JSON.stringify([
          { text: 'Hello', start: '0:00.40' },
        ])],
      ]);

      const result = processContent(files);

      const pairingErrors = result.errors.filter(e =>
        e.file.includes('paired') &&
        (e.message.includes('timestamps.json') || e.message.includes('.md'))
      );
      expect(pairingErrors).toHaveLength(0);
    });
  });

  describe('WIP filtering', () => {
    it('skips files in WIP directories by default', () => {
      const files = new Map([
        // Module inside a WIP directory - should be skipped
        ['modules/WIP-draft/draft.md', `---
slug: wip-draft
title: Draft Module
---
# Page: Draft
This is a draft.
`],
        // Article inside a WIP directory - should be skipped
        ['articles/wip/unfinished.md', `---
title: Unfinished
---
Missing author and source_url.
`],
        // Valid module NOT in WIP directory - should be processed
        ['modules/real.md', `---
slug: real
title: Real Module
---
# Page: Intro
Real content.
`],
      ]);

      const result = processContent(files);

      // Only the non-WIP module should appear
      expect(result.modules).toHaveLength(1);
      expect(result.modules[0].slug).toBe('real');

      // The article missing fields should NOT produce errors (skipped)
      expect(result.errors.filter(e => e.file.includes('wip')).length).toBe(0);
    });

    it('processes WIP files when includeWip is true', () => {
      const files = new Map([
        ['modules/WIP-draft/draft.md', `---
slug: wip-draft
title: Draft Module
---
# Page: Draft
This is a draft.
`],
      ]);

      const result = processContent(files, { includeWip: true });

      expect(result.modules).toHaveLength(1);
      expect(result.modules[0].slug).toBe('wip-draft');
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

  describe('unrecognized file warnings', () => {
    it('warns about files in near-miss directory "Module" instead of "modules"', () => {
      const files = new Map([
        ['Module/intro.md', `---
slug: intro
title: Introduction
---
# Page: Intro
`],
      ]);

      const result = processContent(files);

      expect(result.errors.some(e =>
        e.severity === 'warning' &&
        e.file === 'Module/intro.md' &&
        e.message.includes('not recognized')
      )).toBe(true);
    });

    it('suggests correct directory for near-miss "course"', () => {
      const files = new Map([
        ['course/my-course.md', `---
slug: my-course
title: My Course
---
`],
      ]);

      const result = processContent(files);

      expect(result.errors.some(e =>
        e.file === 'course/my-course.md' &&
        e.suggestion?.includes('courses/')
      )).toBe(true);
    });

    it('suggests correct directory for near-miss "Lens" (singular)', () => {
      const files = new Map([
        ['Lens/my-lens.md', `---
id: 550e8400-e29b-41d4-a716-446655440001
---
### Page: Intro
#### Text
content:: Hello
`],
      ]);

      const result = processContent(files);

      expect(result.errors.some(e =>
        e.file === 'Lens/my-lens.md' &&
        e.suggestion?.includes('Lenses/')
      )).toBe(true);
    });

    it('does not warn about files in correctly named directories', () => {
      const files = new Map([
        ['modules/valid.md', `---
slug: valid
title: Valid
---
# Page: Test
## Text
content:: Hello
`],
      ]);

      const result = processContent(files);

      expect(result.errors.filter(e =>
        e.message.includes('not recognized')
      )).toHaveLength(0);
    });
  });
});
