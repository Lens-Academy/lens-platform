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

  describe('content tier filtering', () => {
    it('skips validator-ignore tagged files entirely', () => {
      const files = new Map([
        // Module tagged validator-ignore — should produce zero errors and zero modules
        ['modules/ignored.md', `---
slug: ignored-mod
title: Ignored Module
tags: [validator-ignore]
---
# Page: Draft
This is ignored.
`],
        // Article tagged validator-ignore — missing required fields but should be skipped
        ['articles/ignored-article.md', `---
title: Unfinished
tags: [validator-ignore]
---
Missing author and source_url.
`],
        // Valid module NOT ignored — should be processed
        ['modules/real.md', `---
slug: real
title: Real Module
---
# Page: Intro
Real content.
`],
      ]);

      const result = processContent(files);

      // Only the non-ignored module should appear
      expect(result.modules).toHaveLength(1);
      expect(result.modules[0].slug).toBe('real');

      // The ignored files should NOT produce any errors
      expect(result.errors.filter(e => e.file.includes('ignored')).length).toBe(0);
    });

    it('WIP-tagged file errors get category "wip"', () => {
      const files = new Map([
        // Article tagged wip, missing required fields -> should produce errors with category 'wip'
        ['articles/draft.md', `---
title: Draft Article
tags: [wip]
---
Missing author and source_url.
`],
      ]);

      const result = processContent(files);

      const draftErrors = result.errors.filter(e => e.file.includes('draft'));
      expect(draftErrors.length).toBeGreaterThan(0);
      for (const err of draftErrors) {
        expect(err.category).toBe('wip');
      }
    });

    it('production (untagged) file errors get category "production"', () => {
      const files = new Map([
        // Article with no tags, missing required fields -> should produce errors with category 'production'
        ['articles/bad.md', `---
title: Bad Article
---
Missing author and source_url.
`],
      ]);

      const result = processContent(files);

      const badErrors = result.errors.filter(e => e.file.includes('bad'));
      expect(badErrors.length).toBeGreaterThan(0);
      for (const err of badErrors) {
        expect(err.category).toBe('production');
      }
    });
  });

  describe('tier violations: module → LO', () => {
    it('errors when production module references WIP learning outcome', () => {
      const files = new Map([
        ['modules/prod-mod.md', `---
slug: prod-mod
title: Production Module
---
# Learning Outcome: WIP LO
source:: [[../Learning Outcomes/wip-lo.md|WIP LO]]
`],
        ['Learning Outcomes/wip-lo.md', `---
id: 550e8400-e29b-41d4-a716-446655440030
tags: [wip]
---
## Lens: Test
source:: [[../Lenses/test.md]]
`],
        ['Lenses/test.md', `---
id: 550e8400-e29b-41d4-a716-446655440031
---
### Page: Intro
#### Text
content:: Hello
`],
      ]);

      const result = processContent(files);

      const tierError = result.errors.find(e =>
        e.file === 'modules/prod-mod.md' &&
        e.message.includes('WIP')
      );
      expect(tierError).toBeDefined();
      expect(tierError?.category).toBe('production');
    });

    it('errors when production module references ignored learning outcome', () => {
      const files = new Map([
        ['modules/prod-mod2.md', `---
slug: prod-mod2
title: Production Module
---
# Learning Outcome: Ignored LO
source:: [[../Learning Outcomes/ignored-lo.md|Ignored LO]]
`],
        ['Learning Outcomes/ignored-lo.md', `---
id: 550e8400-e29b-41d4-a716-446655440032
tags: [validator-ignore]
---
## Lens: Test
source:: [[../Lenses/test2.md]]
`],
        ['Lenses/test2.md', `---
id: 550e8400-e29b-41d4-a716-446655440033
---
### Page: Intro
#### Text
content:: Hello
`],
      ]);

      const result = processContent(files);

      const tierError = result.errors.find(e =>
        e.file === 'modules/prod-mod2.md' &&
        e.message.includes('ignored')
      );
      expect(tierError).toBeDefined();
      expect(tierError?.category).toBe('production');
    });

    it('errors when WIP module references ignored learning outcome', () => {
      const files = new Map([
        ['modules/draft-mod.md', `---
slug: draft-mod
title: Draft Module
tags: [wip]
---
# Learning Outcome: Ignored LO
source:: [[../Learning Outcomes/ignored-lo2.md|Ignored LO]]
`],
        ['Learning Outcomes/ignored-lo2.md', `---
id: 550e8400-e29b-41d4-a716-446655440034
tags: [validator-ignore]
---
## Lens: Test
source:: [[../Lenses/test3.md]]
`],
        ['Lenses/test3.md', `---
id: 550e8400-e29b-41d4-a716-446655440035
---
### Page: Intro
#### Text
content:: Hello
`],
      ]);

      const result = processContent(files);

      const tierError = result.errors.find(e =>
        e.file === 'modules/draft-mod.md' &&
        e.message.includes('ignored')
      );
      expect(tierError).toBeDefined();
      expect(tierError?.category).toBe('wip');
    });

    it('does NOT error when WIP module references production learning outcome', () => {
      const files = new Map([
        ['modules/draft-mod2.md', `---
slug: draft-mod2
title: Draft Module
tags: [wip]
---
# Learning Outcome: Prod LO
source:: [[../Learning Outcomes/prod-lo.md|Prod LO]]
`],
        ['Learning Outcomes/prod-lo.md', `---
id: 550e8400-e29b-41d4-a716-446655440036
---
## Lens: Test
source:: [[../Lenses/test4.md]]
`],
        ['Lenses/test4.md', `---
id: 550e8400-e29b-41d4-a716-446655440037
---
### Page: Intro
#### Text
content:: Hello
`],
      ]);

      const result = processContent(files);

      const tierErrors = result.errors.filter(e =>
        e.message.includes('WIP') || e.message.includes('ignored')
      );
      expect(tierErrors).toHaveLength(0);
    });
  });

  describe('tier violations: LO → Lens', () => {
    it('errors when production LO references WIP lens (via module)', () => {
      const files = new Map([
        ['modules/mod-a.md', `---
slug: mod-a
title: Module A
---
# Learning Outcome: LO A
source:: [[../Learning Outcomes/prod-lo-a.md|LO A]]
`],
        ['Learning Outcomes/prod-lo-a.md', `---
id: 550e8400-e29b-41d4-a716-446655440040
---
## Lens: Draft Lens
source:: [[../Lenses/draft-lens-a.md]]
`],
        ['Lenses/draft-lens-a.md', `---
id: 550e8400-e29b-41d4-a716-446655440041
tags: [wip]
---
### Page: Intro
#### Text
content:: Hello
`],
      ]);

      const result = processContent(files);

      const tierError = result.errors.find(e =>
        e.file === 'Learning Outcomes/prod-lo-a.md' &&
        e.message.includes('WIP')
      );
      expect(tierError).toBeDefined();
      expect(tierError?.category).toBe('production');
    });

    it('errors when production standalone LO references WIP lens', () => {
      const files = new Map([
        ['Learning Outcomes/standalone-prod-lo.md', `---
id: 550e8400-e29b-41d4-a716-446655440042
---
## Lens: Draft Lens
source:: [[../Lenses/draft-lens-b.md]]
`],
        ['Lenses/draft-lens-b.md', `---
id: 550e8400-e29b-41d4-a716-446655440043
tags: [wip]
---
### Page: Intro
#### Text
content:: Hello
`],
      ]);

      const result = processContent(files);

      const tierError = result.errors.find(e =>
        e.file === 'Learning Outcomes/standalone-prod-lo.md' &&
        e.message.includes('WIP')
      );
      expect(tierError).toBeDefined();
      expect(tierError?.category).toBe('production');
    });

    it('does NOT error when WIP LO references WIP lens', () => {
      const files = new Map([
        ['Learning Outcomes/draft-lo.md', `---
id: 550e8400-e29b-41d4-a716-446655440044
tags: [wip]
---
## Lens: Draft Lens
source:: [[../Lenses/draft-lens-c.md]]
`],
        ['Lenses/draft-lens-c.md', `---
id: 550e8400-e29b-41d4-a716-446655440045
tags: [wip]
---
### Page: Intro
#### Text
content:: Hello
`],
      ]);

      const result = processContent(files);

      const tierErrors = result.errors.filter(e =>
        e.message.includes('WIP') && e.message.includes('lens')
      );
      expect(tierErrors).toHaveLength(0);
    });
  });

  describe('tier violations: Lens → Article/Video', () => {
    it('errors when production lens references WIP article (via convertSegment)', () => {
      const files = new Map([
        ['modules/mod-b.md', `---
slug: mod-b
title: Module B
---
# Learning Outcome: LO B
source:: [[../Learning Outcomes/lo-b.md|LO B]]
`],
        ['Learning Outcomes/lo-b.md', `---
id: 550e8400-e29b-41d4-a716-446655440050
---
## Lens: Article Lens
source:: [[../Lenses/article-lens.md]]
`],
        ['Lenses/article-lens.md', `---
id: 550e8400-e29b-41d4-a716-446655440051
---
### Article: Test Article
source:: [[../articles/draft-article.md]]

#### Article-excerpt
from:: Start
to:: End
`],
        ['articles/draft-article.md', `---
title: Draft Article
author: Jane
source_url: https://example.com
tags: [wip]
---

Start

Some content here.

End
`],
      ]);

      const result = processContent(files);

      const tierError = result.errors.find(e =>
        e.file === 'Lenses/article-lens.md' &&
        e.message.includes('WIP')
      );
      expect(tierError).toBeDefined();
      expect(tierError?.category).toBe('production');
    });

    it('errors when production lens references WIP video (via convertSegment)', () => {
      const files = new Map([
        ['modules/mod-c.md', `---
slug: mod-c
title: Module C
---
# Learning Outcome: LO C
source:: [[../Learning Outcomes/lo-c.md|LO C]]
`],
        ['Learning Outcomes/lo-c.md', `---
id: 550e8400-e29b-41d4-a716-446655440052
---
## Lens: Video Lens
source:: [[../Lenses/video-lens.md]]
`],
        ['Lenses/video-lens.md', `---
id: 550e8400-e29b-41d4-a716-446655440053
---
### Video: Test Video
source:: [[../video_transcripts/draft-video.md]]

#### Video-excerpt
from:: 0:00
to:: 1:00
`],
        ['video_transcripts/draft-video.md', `---
title: Draft Video
channel: Test
url: "https://youtube.com/watch?v=abc123"
tags: [wip]
---

0:00 - Hello world.
1:00 - End of video.
`],
        ['video_transcripts/draft-video.timestamps.json', JSON.stringify([
          { text: 'Hello world.', start: '0:00.00' },
          { text: 'End of video.', start: '1:00.00' },
        ])],
      ]);

      const result = processContent(files);

      const tierError = result.errors.find(e =>
        e.file === 'Lenses/video-lens.md' &&
        e.message.includes('WIP')
      );
      expect(tierError).toBeDefined();
      expect(tierError?.category).toBe('production');
    });

    it('errors when production standalone lens references WIP article (via validateLensExcerpts)', () => {
      const files = new Map([
        ['Lenses/standalone-article-lens.md', `---
id: 550e8400-e29b-41d4-a716-446655440054
---
### Article: Test Article
source:: [[../articles/draft-article-b.md]]

#### Article-excerpt
from:: Start
to:: End
`],
        ['articles/draft-article-b.md', `---
title: Draft Article B
author: Jane
source_url: https://example.com
tags: [wip]
---

Start

Some content here.

End
`],
      ]);

      const result = processContent(files);

      const tierError = result.errors.find(e =>
        e.file === 'Lenses/standalone-article-lens.md' &&
        e.message.includes('WIP')
      );
      expect(tierError).toBeDefined();
      expect(tierError?.category).toBe('production');
    });

    it('does NOT error when WIP lens references WIP article', () => {
      const files = new Map([
        ['Lenses/draft-article-lens.md', `---
id: 550e8400-e29b-41d4-a716-446655440055
tags: [wip]
---
### Article: Test Article
source:: [[../articles/draft-article-c.md]]

#### Article-excerpt
from:: Start
to:: End
`],
        ['articles/draft-article-c.md', `---
title: Draft Article C
author: Jane
source_url: https://example.com
tags: [wip]
---

Start

Some content here.

End
`],
      ]);

      const result = processContent(files);

      const tierErrors = result.errors.filter(e =>
        e.message.includes('WIP') && e.message.includes('article')
      );
      expect(tierErrors).toHaveLength(0);
    });
  });

  describe('tier violations: Course → Module', () => {
    it('errors when production course references WIP module', () => {
      const files = new Map([
        ['courses/prod-course.md', `---
slug: prod-course
title: Production Course
---
# Module: [[../modules/draft-mod-x.md|Draft Module]]
`],
        ['modules/draft-mod-x.md', `---
slug: draft-mod-x
title: Draft Module X
tags: [wip]
---
# Page: Intro
## Text
content:: Hello
`],
      ]);

      const result = processContent(files);

      const tierError = result.errors.find(e =>
        e.file === 'courses/prod-course.md' &&
        e.message.includes('WIP')
      );
      expect(tierError).toBeDefined();
      expect(tierError?.category).toBe('production');
    });

    it('errors when production course references ignored module', () => {
      const files = new Map([
        ['courses/prod-course-2.md', `---
slug: prod-course-2
title: Production Course 2
---
# Module: [[../modules/ignored-mod-x.md|Ignored Module]]
`],
        ['modules/ignored-mod-x.md', `---
slug: ignored-mod-x
title: Ignored Module X
tags: [validator-ignore]
---
# Page: Intro
## Text
content:: Hello
`],
      ]);

      const result = processContent(files);

      const tierError = result.errors.find(e =>
        e.file === 'courses/prod-course-2.md' &&
        e.message.includes('ignored')
      );
      expect(tierError).toBeDefined();
      expect(tierError?.category).toBe('production');
    });

    it('does NOT error when WIP course references WIP module', () => {
      const files = new Map([
        ['courses/draft-course.md', `---
slug: draft-course
title: Draft Course
tags: [wip]
---
# Module: [[../modules/draft-mod-y.md|Draft Module]]
`],
        ['modules/draft-mod-y.md', `---
slug: draft-mod-y
title: Draft Module Y
tags: [wip]
---
# Page: Intro
## Text
content:: Hello
`],
      ]);

      const result = processContent(files);

      const tierErrors = result.errors.filter(e =>
        e.file === 'courses/draft-course.md' &&
        (e.message.includes('WIP') || e.message.includes('ignored'))
      );
      expect(tierErrors).toHaveLength(0);
    });
  });

  describe('tier violations: Uncategorized → Lens', () => {
    it('errors when production module uncategorized section references WIP lens', () => {
      const files = new Map([
        ['modules/prod-uncat-mod.md', `---
slug: prod-uncat-mod
title: Production Uncat Module
---
# Uncategorized: Section A
## Lens: Draft Lens
source:: [[../Lenses/draft-lens-d.md]]
`],
        ['Lenses/draft-lens-d.md', `---
id: 550e8400-e29b-41d4-a716-446655440060
tags: [wip]
---
### Page: Intro
#### Text
content:: Hello
`],
      ]);

      const result = processContent(files);

      const tierError = result.errors.find(e =>
        e.file === 'modules/prod-uncat-mod.md' &&
        e.message.includes('WIP')
      );
      expect(tierError).toBeDefined();
      expect(tierError?.category).toBe('production');
    });

    it('errors when production module uncategorized section references ignored lens', () => {
      const files = new Map([
        ['modules/prod-uncat-mod-2.md', `---
slug: prod-uncat-mod-2
title: Production Uncat Module 2
---
# Uncategorized: Section B
## Lens: Ignored Lens
source:: [[../Lenses/ignored-lens-e.md]]
`],
        ['Lenses/ignored-lens-e.md', `---
id: 550e8400-e29b-41d4-a716-446655440061
tags: [validator-ignore]
---
### Page: Intro
#### Text
content:: Hello
`],
      ]);

      const result = processContent(files);

      const tierError = result.errors.find(e =>
        e.file === 'modules/prod-uncat-mod-2.md' &&
        e.message.includes('ignored')
      );
      expect(tierError).toBeDefined();
      expect(tierError?.category).toBe('production');
    });

    it('does NOT error when WIP module uncategorized section references WIP lens', () => {
      const files = new Map([
        ['modules/draft-uncat-mod.md', `---
slug: draft-uncat-mod
title: Draft Uncat Module
tags: [wip]
---
# Uncategorized: Section C
## Lens: Draft Lens
source:: [[../Lenses/draft-lens-f.md]]
`],
        ['Lenses/draft-lens-f.md', `---
id: 550e8400-e29b-41d4-a716-446655440062
tags: [wip]
---
### Page: Intro
#### Text
content:: Hello
`],
      ]);

      const result = processContent(files);

      const tierErrors = result.errors.filter(e =>
        e.file === 'modules/draft-uncat-mod.md' &&
        (e.message.includes('WIP') || e.message.includes('ignored'))
      );
      expect(tierErrors).toHaveLength(0);
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
