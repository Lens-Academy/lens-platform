// src/flattener/index.test.ts
import { describe, it, expect } from 'vitest';
import { flattenModule } from './index.js';

describe('flattenModule', () => {
  it('resolves learning outcome references', () => {
    // LO with 2 lenses should produce 2 sections (one per lens)
    const files = new Map([
      ['modules/intro.md', `---
slug: intro
title: Intro
---

# Learning Outcome: Topic
source:: [[../Learning Outcomes/lo1.md|LO1]]
`],
      ['Learning Outcomes/lo1.md', `---
id: 550e8400-e29b-41d4-a716-446655440001
---

## Lens:
source:: [[../Lenses/video-lens.md|Video Lens]]

## Lens:
source:: [[../Lenses/article-lens.md|Article Lens]]
`],
      ['Lenses/video-lens.md', `---
id: 550e8400-e29b-41d4-a716-446655440002
---

### Video: Introduction Video
source:: [[../video_transcripts/intro.md|Intro Video]]

#### Video-excerpt
from:: 0:00
to:: 1:00
`],
      ['Lenses/article-lens.md', `---
id: 550e8400-e29b-41d4-a716-446655440003
---

### Article: Deep Dive
source:: [[../articles/deep-dive.md|Article]]

#### Article-excerpt
from:: "Start here"
to:: "end here"
`],
      ['video_transcripts/intro.md', `---
title: Intro Video
channel: Test Channel
url: https://youtube.com/watch?v=abc123
---

0:00 - Welcome to the video.
1:00 - End of excerpt.
`],
      ['articles/deep-dive.md', `---
title: Deep Dive Article
author: Jane Doe
sourceUrl: https://example.com/article
---

Start here with some content and end here.
`],
    ]);

    const result = flattenModule('modules/intro.md', files);

    expect(result.module).toBeDefined();
    expect(result.module?.slug).toBe('intro');
    expect(result.module?.title).toBe('Intro');
    expect(result.errors).toHaveLength(0);

    // Each lens should become its own section
    expect(result.module?.sections).toHaveLength(2);

    // First section: video lens
    expect(result.module?.sections[0].type).toBe('lens-video');
    expect(result.module?.sections[0].learningOutcomeId).toBe('550e8400-e29b-41d4-a716-446655440001');
    expect(result.module?.sections[0].meta.title).toBe('Intro Video');
    expect(result.module?.sections[0].meta.channel).toBe('Test Channel');

    // Second section: article lens
    expect(result.module?.sections[1].type).toBe('lens-article');
    expect(result.module?.sections[1].learningOutcomeId).toBe('550e8400-e29b-41d4-a716-446655440001');
    expect(result.module?.sections[1].meta.title).toBe('Deep Dive Article');
    expect(result.module?.sections[1].meta.author).toBe('Jane Doe');
  });

  it('returns error for missing reference', () => {
    const files = new Map([
      ['modules/broken.md', `---
slug: broken
title: Broken
---

# Learning Outcome: Missing
source:: [[../Learning Outcomes/nonexistent.md|Missing]]
`],
    ]);

    const result = flattenModule('modules/broken.md', files);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain('not found');
    // Module should still be returned for partial success (with empty sections)
    expect(result.module).toBeDefined();
    expect(result.module?.slug).toBe('broken');
    expect(result.module?.sections).toHaveLength(0);
  });

  it('resolves article excerpt references', () => {
    const files = new Map([
      ['modules/reading.md', `---
slug: reading
title: Reading Module
---

# Learning Outcome: Reading Topic
source:: [[../Learning Outcomes/lo-reading.md|Reading LO]]
`],
      ['Learning Outcomes/lo-reading.md', `---
id: 550e8400-e29b-41d4-a716-446655440010
---

## Lens: Article Lens
source:: [[../Lenses/lens-article.md|Article Lens]]
`],
      ['Lenses/lens-article.md', `---
id: 550e8400-e29b-41d4-a716-446655440011
---

### Article: Deep Dive
source:: [[../articles/sample.md|Sample Article]]

#### Article-excerpt
from:: "The key insight"
to:: "this concept."
`],
      ['articles/sample.md', `# Sample Article

Introduction paragraph.

The key insight is that AI alignment requires careful
consideration of human values. Understanding
this concept.

Conclusion.
`],
    ]);

    const result = flattenModule('modules/reading.md', files);

    expect(result.module).toBeDefined();
    expect(result.errors).toHaveLength(0);
    expect(result.module?.sections[0].type).toBe('lens-article');
    expect(result.module?.sections[0].segments[0].type).toBe('article-excerpt');
    const excerpt = result.module?.sections[0].segments[0] as { type: 'article-excerpt'; content: string };
    expect(excerpt.content).toContain('AI alignment');
  });

  it('resolves video excerpt references', () => {
    const files = new Map([
      ['modules/video.md', `---
slug: video
title: Video Module
---

# Learning Outcome: Video Topic
source:: [[../Learning Outcomes/lo-video.md|Video LO]]
`],
      ['Learning Outcomes/lo-video.md', `---
id: 550e8400-e29b-41d4-a716-446655440020
---

## Lens: Video Lens
source:: [[../Lenses/lens-video.md|Video Lens]]
`],
      ['Lenses/lens-video.md', `---
id: 550e8400-e29b-41d4-a716-446655440021
---

### Video: Expert Interview
source:: [[../video_transcripts/interview.md|Interview]]

#### Video-excerpt
from:: 1:30
to:: 2:00
`],
      ['video_transcripts/interview.md', `0:00 - Welcome to the video.
0:30 - Today we discuss AI safety.
1:00 - Let's start with basics.
1:30 - The first key point is alignment.
2:00 - Moving on to the next topic.
2:30 - More content here.
`],
    ]);

    const result = flattenModule('modules/video.md', files);

    expect(result.module).toBeDefined();
    expect(result.errors).toHaveLength(0);
    expect(result.module?.sections[0].type).toBe('lens-video');
    expect(result.module?.sections[0].segments[0].type).toBe('video-excerpt');
    const excerpt = result.module?.sections[0].segments[0] as { type: 'video-excerpt'; from: number; to: number; transcript: string };
    expect(excerpt.from).toBe(90);  // 1:30 = 90 seconds
    expect(excerpt.to).toBe(120);   // 2:00 = 120 seconds
    expect(excerpt.transcript).toContain('alignment');
  });

  it('handles missing lens file gracefully', () => {
    const files = new Map([
      ['modules/broken-lens.md', `---
slug: broken-lens
title: Broken Lens
---

# Learning Outcome: Topic
source:: [[../Learning Outcomes/lo1.md|LO1]]
`],
      ['Learning Outcomes/lo1.md', `---
id: 550e8400-e29b-41d4-a716-446655440001
---

## Lens: Missing Lens
source:: [[../Lenses/nonexistent.md|Missing]]
`],
    ]);

    const result = flattenModule('modules/broken-lens.md', files);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.message.includes('not found'))).toBe(true);
  });

  it('optional LO in module makes ALL its lenses optional', () => {
    // When a Learning Outcome reference in the module has optional:: true,
    // ALL lenses within that LO should inherit the optional flag.
    const files = new Map([
      ['modules/optional.md', `---
slug: optional
title: Optional Module
---

# Learning Outcome: Required Topic
source:: [[../Learning Outcomes/lo-required.md|Required LO]]

# Learning Outcome: Optional Topic
source:: [[../Learning Outcomes/lo-optional.md|Optional LO]]
optional:: true
`],
      ['Learning Outcomes/lo-required.md', `---
id: 550e8400-e29b-41d4-a716-446655440001
---

## Lens:
source:: [[../Lenses/lens1.md|Lens 1]]
`],
      ['Learning Outcomes/lo-optional.md', `---
id: 550e8400-e29b-41d4-a716-446655440002
---

## Lens:
source:: [[../Lenses/lens2.md|Lens 2]]

## Lens:
source:: [[../Lenses/lens3.md|Lens 3]]
`],
      ['Lenses/lens1.md', `---
id: 550e8400-e29b-41d4-a716-446655440010
---

### Page: Content 1

#### Text
content:: Required content.
`],
      ['Lenses/lens2.md', `---
id: 550e8400-e29b-41d4-a716-446655440011
---

### Page: Content 2

#### Text
content:: Optional content A.
`],
      ['Lenses/lens3.md', `---
id: 550e8400-e29b-41d4-a716-446655440012
---

### Page: Content 3

#### Text
content:: Optional content B.
`],
    ]);

    const result = flattenModule('modules/optional.md', files);

    expect(result.module).toBeDefined();
    expect(result.errors).toHaveLength(0);
    // 1 lens from required LO + 2 lenses from optional LO = 3 sections
    expect(result.module?.sections).toHaveLength(3);
    // Lens from required LO: NOT optional
    expect(result.module?.sections[0].optional).toBe(false);
    // Both lenses from optional LO: SHOULD BE optional (inherited from LO)
    expect(result.module?.sections[1].optional).toBe(true);
    expect(result.module?.sections[2].optional).toBe(true);
  });

  it('flattens Page section with ## Text content segments', () => {
    const files = new Map([
      ['modules/page-test.md', `---
slug: page-test
title: Page Test Module
---

# Page: Welcome
id:: d1e2f3a4-5678-90ab-cdef-1234567890ab

## Text
content::
This is the welcome text.
It spans multiple lines.
`],
    ]);

    const result = flattenModule('modules/page-test.md', files);

    expect(result.module).toBeDefined();
    expect(result.module?.sections).toHaveLength(1);
    expect(result.module?.sections[0].type).toBe('page');
    expect(result.module?.sections[0].contentId).toBe('d1e2f3a4-5678-90ab-cdef-1234567890ab');
    expect(result.module?.sections[0].segments).toHaveLength(1);
    expect(result.module?.sections[0].segments[0].type).toBe('text');
    const textSegment = result.module?.sections[0].segments[0] as { type: 'text'; content: string };
    expect(textSegment.content).toContain('welcome text');
    expect(textSegment.content).toContain('multiple lines');
  });

  it('flattens Page section with multiple ## Text subsections', () => {
    const files = new Map([
      ['modules/multi-text.md', `---
slug: multi-text
title: Multi Text Module
---

# Page: Introduction
id:: aaaa-bbbb-cccc-dddd

## Text
content::
First paragraph of text.

## Text
content::
Second paragraph of text.
`],
    ]);

    const result = flattenModule('modules/multi-text.md', files);

    expect(result.module).toBeDefined();
    expect(result.module?.sections).toHaveLength(1);
    expect(result.module?.sections[0].segments).toHaveLength(2);
    const seg0 = result.module?.sections[0].segments[0] as { type: 'text'; content: string };
    const seg1 = result.module?.sections[0].segments[1] as { type: 'text'; content: string };
    expect(seg0.content).toContain('First paragraph');
    expect(seg1.content).toContain('Second paragraph');
  });

  it('flattens Uncategorized section with Lens references', () => {
    const files = new Map([
      ['modules/test.md', `---
slug: test
title: Test
---

# Uncategorized:
## Lens:
source:: [[../Lenses/lens1.md|Lens 1]]
`],
      ['Lenses/lens1.md', `---
id: lens-1-id
---

### Page: Content

#### Text
content:: This is lens content.
`],
    ]);

    const result = flattenModule('modules/test.md', files);

    expect(result.module?.sections).toHaveLength(1);
    expect(result.module?.sections[0].segments[0].content).toBe('This is lens content.');
  });

  it('extracts article metadata into section meta', () => {
    const files = new Map([
      ['modules/test.md', `---
slug: test
title: Test
---

# Learning Outcome: Read Article
source:: [[../Learning Outcomes/lo1.md|LO1]]
`],
      ['Learning Outcomes/lo1.md', `---
id: lo-id
---

## Lens:
source:: [[../Lenses/article-lens.md|Lens]]
`],
      ['Lenses/article-lens.md', `---
id: lens-id
---

### Article: Good Article
source:: [[../articles/test-article.md|Article]]

#### Article-excerpt
from:: "Start here"
to:: "End here"
`],
      ['articles/test-article.md', `---
title: The Article Title
author: John Doe
sourceUrl: https://example.com/article
---

Start here with some content. End here with more.
`],
    ]);

    const result = flattenModule('modules/test.md', files);

    expect(result.module?.sections[0].meta.title).toBe('The Article Title');
    expect(result.module?.sections[0].meta.author).toBe('John Doe');
    expect(result.module?.sections[0].meta.sourceUrl).toBe('https://example.com/article');
  });

  it('extracts video metadata into section meta', () => {
    const files = new Map([
      ['modules/test.md', `---
slug: test
title: Test
---

# Learning Outcome: Watch Video
source:: [[../Learning Outcomes/lo1.md|LO1]]
`],
      ['Learning Outcomes/lo1.md', `---
id: lo-id
---

## Lens:
source:: [[../Lenses/video-lens.md|Lens]]
`],
      ['Lenses/video-lens.md', `---
id: lens-id
---

### Video: Good Video
source:: [[../video_transcripts/test-video.md|Video]]

#### Video-excerpt
from:: 0:00
to:: 5:00
`],
      ['video_transcripts/test-video.md', `---
title: The Video Title
channel: Kurzgesagt
url: https://youtube.com/watch?v=abc123
---

0:00 - Start of video content.
5:00 - End of excerpt.
`],
    ]);

    const result = flattenModule('modules/test.md', files);

    expect(result.module?.sections[0].meta.title).toBe('The Video Title');
    expect(result.module?.sections[0].meta.channel).toBe('Kurzgesagt');
  });

  it('sets section contentId from lens frontmatter id', () => {
    const files = new Map([
      ['modules/test.md', `---
slug: test
title: Test
---

# Learning Outcome: Topic
source:: [[../Learning Outcomes/lo1.md|LO1]]
`],
      ['Learning Outcomes/lo1.md', `---
id: lo-id
---

## Lens:
source:: [[../Lenses/lens1.md|Lens]]
`],
      ['Lenses/lens1.md', `---
id: 3dd47fce-a0fe-4e03-916d-a160fe697dd0
---

### Page: Content

#### Text
content:: Some content.
`],
    ]);

    const result = flattenModule('modules/test.md', files);

    expect(result.module?.sections[0].contentId).toBe('3dd47fce-a0fe-4e03-916d-a160fe697dd0');
  });

  it('flattens Uncategorized section with multiline source fields', () => {
    // Bug: when source:: has no inline value and the wikilink is on the next line,
    // the lens refs aren't being collected properly because the field value isn't
    // finalized before checking if source exists.
    const files = new Map([
      ['modules/test.md', `---
slug: test
title: Test
---

# Uncategorized:
## Lens:
source::
![[../Lenses/lens1.md]]

## Lens:
source::
![[../Lenses/lens2.md]]
`],
      ['Lenses/lens1.md', `---
id: lens-1-id
---

### Page: Content 1

#### Text
content:: First lens content.
`],
      ['Lenses/lens2.md', `---
id: lens-2-id
---

### Page: Content 2

#### Text
content:: Second lens content.
`],
    ]);

    const result = flattenModule('modules/test.md', files);

    // Each lens should become its own section
    expect(result.errors).toHaveLength(0);
    expect(result.module?.sections).toHaveLength(2);
    expect(result.module?.sections[0].segments).toHaveLength(1);
    expect(result.module?.sections[1].segments).toHaveLength(1);
    expect((result.module?.sections[0].segments[0] as any).content).toBe('First lens content.');
    expect((result.module?.sections[1].segments[0] as any).content).toBe('Second lens content.');
  });

  it('individual lens within LO can be marked optional', () => {
    // When an individual lens reference within an LO has optional:: true,
    // only THAT specific lens should be optional (not all lenses in the LO).
    const files = new Map([
      ['modules/test.md', `---
slug: test
title: Test
---

# Learning Outcome: Topic
source:: [[../Learning Outcomes/lo1.md|LO1]]
`],
      ['Learning Outcomes/lo1.md', `---
id: 550e8400-e29b-41d4-a716-446655440001
---

## Lens:
source:: [[../Lenses/lens1.md|Lens 1]]

## Lens:
optional:: true
source:: [[../Lenses/lens2.md|Lens 2]]

## Lens:
source:: [[../Lenses/lens3.md|Lens 3]]
`],
      ['Lenses/lens1.md', `---
id: 550e8400-e29b-41d4-a716-446655440010
---

### Page: Content 1

#### Text
content:: Required content A.
`],
      ['Lenses/lens2.md', `---
id: 550e8400-e29b-41d4-a716-446655440011
---

### Page: Content 2

#### Text
content:: Optional content.
`],
      ['Lenses/lens3.md', `---
id: 550e8400-e29b-41d4-a716-446655440012
---

### Page: Content 3

#### Text
content:: Required content B.
`],
    ]);

    const result = flattenModule('modules/test.md', files);

    expect(result.module).toBeDefined();
    expect(result.errors).toHaveLength(0);
    expect(result.module?.sections).toHaveLength(3);
    // First lens: NOT optional
    expect(result.module?.sections[0].optional).toBe(false);
    // Second lens: SHOULD BE optional (from LO's individual lens reference)
    expect(result.module?.sections[1].optional).toBe(true);
    // Third lens: NOT optional
    expect(result.module?.sections[2].optional).toBe(false);
  });

  it('flattens Lens with ### Page: section to type page', () => {
    // A Lens using ### Page: (instead of ### Article: or ### Video:)
    // should produce a section with type 'page' and properly populated segments
    const files = new Map([
      ['modules/test.md', `---
slug: test
title: Test
---

# Learning Outcome: Topic
source:: [[../Learning Outcomes/lo1.md|LO1]]
`],
      ['Learning Outcomes/lo1.md', `---
id: lo-id
---

## Lens:
source:: [[../Lenses/page-lens.md|Page Lens]]
`],
      ['Lenses/page-lens.md', `---
id: page-lens-id
---

### Page: External Resource
#### Text
content::
We refer you to an external interactive resource.

#### Chat: Discussion
instructions:: Discuss what you learned from the external resource.
`],
    ]);

    const result = flattenModule('modules/test.md', files);

    expect(result.errors).toHaveLength(0);
    expect(result.module?.sections).toHaveLength(1);
    // Key assertion: section type should be 'page'
    expect(result.module?.sections[0].type).toBe('page');
    // Title from ### Page: header
    expect(result.module?.sections[0].meta.title).toBe('External Resource');
    // Should have 2 segments: text and chat
    expect(result.module?.sections[0].segments).toHaveLength(2);
    expect(result.module?.sections[0].segments[0].type).toBe('text');
    expect(result.module?.sections[0].segments[1].type).toBe('chat');
  });

  it('flattens Page section with ## Text and ## Chat segments', () => {
    const files = new Map([
      ['modules/chat-test.md', `---
slug: chat-test
title: Chat Test Module
---

# Page: Discussion Page
id:: d1e2f3a4-5678-90ab-cdef-1234567890ab

## Text
content::
Read the following material carefully.

## Chat
instructions:: Discuss what you learned from the material above.
`],
    ]);

    const result = flattenModule('modules/chat-test.md', files);

    expect(result.module).toBeDefined();
    expect(result.errors).toHaveLength(0);
    expect(result.module?.sections).toHaveLength(1);
    expect(result.module?.sections[0].type).toBe('page');
    expect(result.module?.sections[0].segments).toHaveLength(2);
    expect(result.module?.sections[0].segments[0].type).toBe('text');
    expect(result.module?.sections[0].segments[1].type).toBe('chat');
    const chatSeg = result.module?.sections[0].segments[1] as { type: 'chat'; instructions: string };
    expect(chatSeg.instructions).toContain('Discuss');
  });

  it('detects circular reference and returns error', () => {
    // Create a cycle: Module -> LO-A -> Lens-B -> (references back to LO-A)
    // The lens has an article section that points back to the LO file
    const files = new Map([
      ['modules/circular.md', `---
slug: circular
title: Circular
---

# Learning Outcome: Loop
source:: [[../Learning Outcomes/lo-a.md|LO A]]
`],
      ['Learning Outcomes/lo-a.md', `---
id: lo-a-id
---

## Lens:
source:: [[../Lenses/lens-b.md|Lens B]]
`],
      ['Lenses/lens-b.md', `---
id: lens-b-id
---

### Article: Back to LO
source:: [[../Learning Outcomes/lo-a.md|Back to A]]

#### Article-excerpt
from:: "Start"
to:: "End"
`],
    ]);

    const result = flattenModule('modules/circular.md', files);

    expect(result.errors.some(e => e.message.toLowerCase().includes('circular'))).toBe(true);
  });
});
