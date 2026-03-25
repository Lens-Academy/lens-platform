// src/flattener/index.test.ts
import { describe, it, expect } from 'vitest';
import { flattenModule, flattenLens, validateBoundaries, splitAtBoundaries, isBoundary, type BoundaryMarker, type FlatItem } from './index.js';
import type { ArticleSegment, Section } from '../index.js';
import { processContent } from '../index.js';
import { pageLens, simpleLO, loWithSubmodules, buildFiles } from './test-helpers.js';

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

#### Video
source:: [[../video_transcripts/intro.md|Intro Video]]
from:: 0:00
to:: 1:00
`],
      ['Lenses/article-lens.md', `---
id: 550e8400-e29b-41d4-a716-446655440003
---

#### Article
source:: [[../articles/deep-dive.md|Article]]
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
source_url: https://example.com/article
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

    // First section: video lens - meta.title comes from LO section title
    expect(result.module?.sections[0].type).toBe('lens');
    expect(result.module?.sections[0].learningOutcomeId).toBe('550e8400-e29b-41d4-a716-446655440001');
    expect(result.module?.sections[0].meta.title).toBe('Topic');

    // Second section: article lens
    expect(result.module?.sections[1].type).toBe('lens');
    expect(result.module?.sections[1].learningOutcomeId).toBe('550e8400-e29b-41d4-a716-446655440001');
    expect(result.module?.sections[1].meta.title).toBe('Topic');
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

#### Article
source:: [[../articles/sample.md|Sample Article]]
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
    expect(result.module?.sections[0].type).toBe('lens');
    expect(result.module?.sections[0].segments[0].type).toBe('article');
    const excerpt = result.module?.sections[0].segments[0] as { type: 'article'; content: string };
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

#### Video
source:: [[../video_transcripts/interview.md|Interview]]
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
    expect(result.module?.sections[0].type).toBe('lens');
    expect(result.module?.sections[0].segments[0].type).toBe('video');
    const excerpt = result.module?.sections[0].segments[0] as { type: 'video'; from: number; to: number; transcript: string };
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

#### Text
content:: Required content.
`],
      ['Lenses/lens2.md', `---
id: 550e8400-e29b-41d4-a716-446655440011
---

#### Text
content:: Optional content A.
`],
      ['Lenses/lens3.md', `---
id: 550e8400-e29b-41d4-a716-446655440012
---

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

  it('flattens referenced Lens section from module', () => {
    const files = new Map([
      ['modules/lens-test.md', `---
slug: lens-test
title: Lens Test Module
---

# Lens: Welcome
source:: [[../Lenses/welcome.md]]
`],
      ['Lenses/welcome.md', `---
id: d1e2f3a4-5678-90ab-cdef-1234567890ab
---

#### Text
content::
This is the welcome text.
It spans multiple lines.
`],
    ]);

    const result = flattenModule('modules/lens-test.md', files);

    expect(result.module).toBeDefined();
    expect(result.module?.sections).toHaveLength(1);
    expect(result.module?.sections[0].type).toBe('lens');
    expect(result.module?.sections[0].contentId).toBe('d1e2f3a4-5678-90ab-cdef-1234567890ab');
    expect(result.module?.sections[0].segments).toHaveLength(1);
    expect(result.module?.sections[0].segments[0].type).toBe('text');
    const textSegment = result.module?.sections[0].segments[0] as { type: 'text'; content: string };
    expect(textSegment.content).toContain('welcome text');
    expect(textSegment.content).toContain('multiple lines');
  });

  it('flattens Lens with multiple text segments', () => {
    const files = new Map([
      ['modules/multi-text.md', `---
slug: multi-text
title: Multi Text Module
---

# Lens: Introduction
source:: [[../Lenses/intro.md]]
`],
      ['Lenses/intro.md', `---
id: aaaa-bbbb-cccc-dddd
---

#### Text
content::
First paragraph of text.

#### Text
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

  it('flattens Lens section with source reference', () => {
    const files = new Map([
      ['modules/test.md', `---
slug: test
title: Test
---

# Lens:
source:: [[../Lenses/lens1.md|Lens 1]]
`],
      ['Lenses/lens1.md', `---
id: lens-1-id
---

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

#### Article
source:: [[../articles/test-article.md|Article]]
from:: "Start here"
to:: "End here"
`],
      ['articles/test-article.md', `---
title: The Article Title
author: John Doe
source_url: https://example.com/article
---

Start here with some content. End here with more.
`],
    ]);

    const result = flattenModule('modules/test.md', files);

    // meta.title comes from LO section header, article metadata is on the segment
    expect(result.module?.sections[0].meta.title).toBe('Read Article');
    const articleSeg = result.module?.sections[0].segments[0] as any;
    expect(articleSeg.type).toBe('article');
    expect(articleSeg.title).toBe('The Article Title');
    expect(articleSeg.author).toBe('John Doe');
    expect(articleSeg.sourceUrl).toBe('https://example.com/article');
  });

  it('extracts video metadata into segment', () => {
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

#### Video
source:: [[../video_transcripts/test-video.md|Video]]
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

    // meta.title comes from LO section header, video metadata is on the segment
    expect(result.module?.sections[0].meta.title).toBe('Watch Video');
    const videoSeg = result.module?.sections[0].segments[0] as any;
    expect(videoSeg.type).toBe('video');
    expect(videoSeg.title).toBe('The Video Title');
    expect(videoSeg.channel).toBe('Kurzgesagt');
    expect(videoSeg.videoId).toBe('abc123');
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

#### Text
content:: Some content.
`],
    ]);

    const result = flattenModule('modules/test.md', files);

    expect(result.module?.sections[0].contentId).toBe('3dd47fce-a0fe-4e03-916d-a160fe697dd0');
  });

  it('flattens multiple Lens sections in module', () => {
    const files = new Map([
      ['modules/test.md', `---
slug: test
title: Test
---

# Lens:
source:: [[../Lenses/lens1.md]]

# Lens:
source:: [[../Lenses/lens2.md]]
`],
      ['Lenses/lens1.md', `---
id: lens-1-id
---

#### Text
content:: First lens content.
`],
      ['Lenses/lens2.md', `---
id: lens-2-id
---

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

  it('errors when Lens section has no source:: field', () => {
    const files = new Map<string, string>();
    files.set('modules/test.md', `---
slug: test
title: Test Module
id: 550e8400-e29b-41d4-a716-446655440099
---

# Lens:
`);

    const result = flattenModule('modules/test.md', files);

    expect(result.errors.some(e =>
      e.severity === 'error' &&
      e.message.includes('source')
    )).toBe(true);
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

#### Text
content:: Required content A.
`],
      ['Lenses/lens2.md', `---
id: 550e8400-e29b-41d4-a716-446655440011
---

#### Text
content:: Optional content.
`],
      ['Lenses/lens3.md', `---
id: 550e8400-e29b-41d4-a716-446655440012
---

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

  it('flattens text-only lens as type lens', () => {
    // A text-only lens should produce a section with type lens
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

#### Text
content::
We refer you to an external interactive resource.

#### Chat
instructions:: Discuss what you learned from the external resource.
`],
    ]);

    const result = flattenModule('modules/test.md', files);

    expect(result.errors).toHaveLength(0);
    expect(result.module?.sections).toHaveLength(1);
    // Key assertion: section type should be 'lens'
    expect(result.module?.sections[0].type).toBe('lens');
    // Title from     expect(result.module?.sections[0].meta.title).toBe('External Resource');
    // Should have 2 segments: text and chat
    expect(result.module?.sections[0].segments).toHaveLength(2);
    expect(result.module?.sections[0].segments[0].type).toBe('text');
    expect(result.module?.sections[0].segments[1].type).toBe('chat');
  });

  it('flattens Lens with text and chat segments', () => {
    const files = new Map([
      ['modules/chat-test.md', `---
slug: chat-test
title: Chat Test Module
---

# Lens: Discussion
source:: [[../Lenses/discussion.md]]
`],
      ['Lenses/discussion.md', `---
id: d1e2f3a4-5678-90ab-cdef-1234567890ab
---

#### Text
content::
Read the following material carefully.

#### Chat
instructions:: Discuss what you learned from the material above.
`],
    ]);

    const result = flattenModule('modules/chat-test.md', files);

    expect(result.module).toBeDefined();
    expect(result.errors).toHaveLength(0);
    expect(result.module?.sections).toHaveLength(1);
    expect(result.module?.sections[0].type).toBe('lens');
    expect(result.module?.sections[0].segments).toHaveLength(2);
    expect(result.module?.sections[0].segments[0].type).toBe('text');
    expect(result.module?.sections[0].segments[1].type).toBe('chat');
    const chatSeg = result.module?.sections[0].segments[1] as { type: 'chat'; instructions: string };
    expect(chatSeg.instructions).toContain('Discuss');
  });

  it('uses specific error from parseWikilink instead of generic "Invalid wikilink format"', () => {
    const files = new Map([
      ['modules/bad-path.md', `---
slug: bad-path
title: Bad Path
---

# Learning Outcome: Bad
source:: [[../../Learning Outcomes/lo1.md|Too Many Dots]]
`],
    ]);

    const result = flattenModule('modules/bad-path.md', files);

    expect(result.errors.length).toBeGreaterThan(0);
    // Should use the specific error from parseWikilink, not "Invalid wikilink format"
    expect(result.errors[0].message).not.toContain('Invalid wikilink format');
    expect(result.errors[0].message).toContain("too many '../'");
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

#### Article
source:: [[../Learning Outcomes/lo-a.md|Back to A]]
from:: "Start"
to:: "End"
`],
    ]);

    const result = flattenModule('modules/circular.md', files);

    expect(result.errors.some(e => e.message.toLowerCase().includes('circular'))).toBe(true);
  });

  it('carries tldr from lens frontmatter into flattened section', () => {
    const files = buildFiles({
      'modules/test-module.md': `---
slug: test-module
title: Test Module
contentId: 550e8400-e29b-41d4-a716-446655440000
---

# Learning Outcome: Topic
source:: [[../Learning Outcomes/lo1.md|LO1]]
`,
      'Learning Outcomes/lo1.md': simpleLO('550e8400-e29b-41d4-a716-446655440010', [
        { path: '../Lenses/my-lens.md' },
      ]),
      'Lenses/my-lens.md': `---
id: 550e8400-e29b-41d4-a716-446655440001
tldr: This is a short summary of the lens content
---

#### Text
content:: Hello world.
`,
    });

    const result = processContent(files);
    const mod = result.modules.find(m => m.slug === 'test-module');
    expect(mod).toBeDefined();
    const lensSection = mod!.sections.find(s => s.contentId === '550e8400-e29b-41d4-a716-446655440001');
    expect(lensSection?.tldr).toBe('This is a short summary of the lens content');
  });

  it('carries summaryForTutor from lens frontmatter into flattened section', () => {
    const files = buildFiles({
      'modules/test-module.md': `---
slug: test-module
title: Test Module
contentId: 550e8400-e29b-41d4-a716-446655440000
---

# Learning Outcome: Topic
source:: [[../Learning Outcomes/lo1.md|LO1]]
`,
      'Learning Outcomes/lo1.md': simpleLO('550e8400-e29b-41d4-a716-446655440010', [
        { path: '../Lenses/my-lens.md' },
      ]),
      'Lenses/my-lens.md': `---
id: 550e8400-e29b-41d4-a716-446655440001
summary_for_tutor: Covers the sharp left turn problem and capabilities generalization.
---

#### Text
content:: Hello world.
`,
    });

    const result = processContent(files);
    const mod = result.modules.find(m => m.slug === 'test-module');
    expect(mod).toBeDefined();
    const lensSection = mod!.sections.find(s => s.contentId === '550e8400-e29b-41d4-a716-446655440001');
    expect(lensSection?.summaryForTutor).toBe('Covers the sharp left turn problem and capabilities generalization.');
  });
});

describe('flattenLens', () => {
  it('wraps an article lens as a single-section FlattenedModule', () => {
    const files = new Map([
      ['Lenses/Four Background Claims.md', `---
id: c3d4e5f6-a7b8-9012-cdef-345678901234
---

#### Text
content::
This article explains the four key premises.

#### Article
source:: [[../articles/soares-four-background-claims]]
from:: # I. AI could be a really big deal
to:: # II. We may be able to influence
`],
      ['articles/soares-four-background-claims.md', `---
title: "Four Background Claims"
author: "Nate Soares"
source_url: "https://example.com/four-claims"
---

# I. AI could be a really big deal

First section content here.

# II. We may be able to influence

Second section content.
`],
    ]);

    const result = flattenLens('Lenses/Four Background Claims.md', files);

    expect(result.errors.filter(e => e.severity === 'error')).toHaveLength(0);
    expect(result.module).toBeDefined();
    expect(result.module!.slug).toBe('lens/four-background-claims');
    expect(result.module!.title).toBe('Four Background Claims');
    expect(result.module!.contentId).toBe('c3d4e5f6-a7b8-9012-cdef-345678901234');
    expect(result.module!.sections).toHaveLength(1);
    expect(result.module!.sections[0].type).toBe('lens');
    expect(result.module!.sections[0].contentId).toBe('c3d4e5f6-a7b8-9012-cdef-345678901234');
  });

  it('joins YAML list authors with comma and space', () => {
    const files = new Map([
      ['Lenses/multi-author.md', `---
id: d4e5f6a7-b8c9-0123-def4-567890123456
---

#### Article
source:: [[../articles/multi-author]]
`],
      ['articles/multi-author.md', `---
title: "AI Is Grown, Not Built"
author:
  - "Eliezer Yudkowsky"
  - "Nate Soares"
source_url: "https://example.com/article"
published: 2024-01-01
---

Article body here.
`],
    ]);

    const result = flattenLens('Lenses/multi-author.md', files);

    expect(result.errors.filter(e => e.severity === 'error')).toHaveLength(0);
    expect(result.module).toBeDefined();
    const articleSeg = result.module!.sections[0].segments[0] as ArticleSegment;
    expect(articleSeg.author).toBe('Eliezer Yudkowsky, Nate Soares');
  });

  it('wraps a video lens as a single-section FlattenedModule', () => {
    const files = new Map([
      ['Lenses/Kurzgesagt software demo.md', `---
id: a1b2c3d4-e5f6-7890-abcd-ef1234567890
---

#### Text
content::
Watch this introduction.

#### Video
source:: [[../video_transcripts/kurzgesagt-ai-humanitys-final-invention.md]]
from:: 0:00
to:: 1:00
`],
      ['video_transcripts/kurzgesagt-ai-humanitys-final-invention.md', `---
title: "AI - Humanity's Final Invention?"
channel: "Kurzgesagt"
url: "https://www.youtube.com/watch?v=fa8k8IQ1_X0"
---

0:00 Hello and welcome
0:30 Today we discuss
1:00 The end
`],
      ['video_transcripts/kurzgesagt-ai-humanitys-final-invention.timestamps.json', `[
        {"text": "Hello", "start": "0:00.00"},
        {"text": "and", "start": "0:00.50"},
        {"text": "welcome", "start": "0:00.70"},
        {"text": "Today", "start": "0:30.00"},
        {"text": "we", "start": "0:30.50"},
        {"text": "discuss", "start": "0:30.70"},
        {"text": "The", "start": "1:00.00"},
        {"text": "end", "start": "1:00.50"}
      ]`],
    ]);

    const result = flattenLens('Lenses/Kurzgesagt software demo.md', files);

    expect(result.errors.filter(e => e.severity === 'error')).toHaveLength(0);
    expect(result.module).toBeDefined();
    expect(result.module!.slug).toBe('lens/kurzgesagt-software-demo');
    expect(result.module!.sections).toHaveLength(1);
    expect(result.module!.sections[0].type).toBe('lens');
  });

  it('wraps a text-only lens as a lens-type section', () => {
    const files = new Map([
      ['Lenses/Simple Page.md', `---
id: 55555555-6666-7777-8888-999999999999
---
#### Text
content::
Some page content here.

#### Chat
instructions::
What did you think?
`],
    ]);

    const result = flattenLens('Lenses/Simple Page.md', files);

    expect(result.errors.filter(e => e.severity === 'error')).toHaveLength(0);
    expect(result.module).toBeDefined();
    expect(result.module!.slug).toBe('lens/simple-page');
    expect(result.module!.title).toBe('Simple Page');
    expect(result.module!.sections).toHaveLength(1);
    expect(result.module!.sections[0].type).toBe('lens');
    expect(result.module!.sections[0].segments.length).toBeGreaterThanOrEqual(2);
  });

  it('uses frontmatter title for standalone lens when present', () => {
    const files = new Map([
      ['Lenses/Simple Page.md', `---
id: 55555555-6666-7777-8888-999999999999
title: My Custom Title
---
#### Text
content::
Some page content here.
`],
    ]);

    const result = flattenLens('Lenses/Simple Page.md', files);

    expect(result.errors.filter(e => e.severity === 'error')).toHaveLength(0);
    expect(result.module!.title).toBe('My Custom Title');
    expect(result.module!.sections[0].meta.title).toBe('My Custom Title');
  });

  it('returns null for ignored lenses', () => {
    const files = new Map([
      ['Lenses/Ignored.md', `---
id: 11111111-2222-3333-4444-555555555555
tags: [validator-ignore]
---
#### Text
content::
Hello
`],
    ]);

    const tierMap = new Map([['Lenses/Ignored.md', 'ignored' as const]]);
    const result = flattenLens('Lenses/Ignored.md', files, tierMap);

    expect(result.module).toBeNull();
  });

  it('returns null for lenses with parse errors', () => {
    const files = new Map([
      ['Lenses/Bad.md', `not a valid lens file at all`],
    ]);

    const result = flattenLens('Lenses/Bad.md', files);

    expect(result.module).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('populates collapsed_before and collapsed_after for article excerpts', () => {
    const files = new Map([
      ['Lenses/test-collapsed.md', `---
id: collapsed-test-id
---

#### Article
source:: [[../articles/collapsed-article.md|Article]]
from:: "The key insight"
to:: "this concept."
`],
      ['articles/collapsed-article.md', `---
title: Test Article
author: Jane Doe
---

Introduction paragraph before the excerpt.

The key insight is that AI alignment requires careful
consideration of human values. Understanding
this concept.

Conclusion paragraph after the excerpt.
`],
    ]);

    const result = flattenLens('Lenses/test-collapsed.md', files);

    expect(result.errors.filter(e => e.severity === 'error')).toHaveLength(0);
    const section = result.module!.sections[0];
    const excerpt = section.segments.find(s => s.type === 'article') as ArticleSegment;
    expect(excerpt).toBeDefined();
    expect(excerpt.content).toContain('key insight');

    // The content before the from:: anchor should be collapsed_before
    expect(excerpt.collapsed_before).toBeDefined();
    expect(excerpt.collapsed_before).toContain('Introduction paragraph');

    // The content after the to:: anchor should be collapsed_after
    expect(excerpt.collapsed_after).toBeDefined();
    expect(excerpt.collapsed_after).toContain('Conclusion paragraph');
  });
});

// -- Step 4a: Pure boundary functions --

describe('splitAtBoundaries', () => {
  const makeSection = (title: string): Section => ({
    type: 'lens',
    meta: { title },
    segments: [{ type: 'text', content: title }],
    optional: false,
    contentId: null,
    learningOutcomeId: null,
    learningOutcomeName: null,
  });

  it('no boundaries → single group with all sections', () => {
    const items: FlatItem[] = [makeSection('A'), makeSection('B')];
    const groups = splitAtBoundaries(items, 'parent', 'Parent');

    expect(groups).toHaveLength(1);
    expect(groups[0].sections).toHaveLength(2);
    expect(groups[0].parentSlug).toBeUndefined();
  });

  it('splits at boundary markers into groups', () => {
    const items: FlatItem[] = [
      { __boundary: true, title: 'Welcome' },
      makeSection('A'),
      { __boundary: true, title: 'Research' },
      makeSection('B'),
      makeSection('C'),
    ];

    const groups = splitAtBoundaries(items, 'big', 'Big Module');

    expect(groups).toHaveLength(2);
    expect(groups[0].slug).toBe('big/welcome');
    expect(groups[0].parentSlug).toBe('big');
    expect(groups[0].parentTitle).toBe('Big Module');
    expect(groups[0].sections).toHaveLength(1);
    expect(groups[1].slug).toBe('big/research');
    expect(groups[1].sections).toHaveLength(2);
  });

  it('preserves customSlug on groups', () => {
    const items: FlatItem[] = [
      { __boundary: true, title: 'Research Methods', customSlug: 'research' },
      makeSection('A'),
    ];

    const groups = splitAtBoundaries(items, 'big', 'Big');

    expect(groups[0].slug).toBe('big/research');
  });
});

describe('validateBoundaries', () => {
  const makeSection = (title: string): Section => ({
    type: 'lens',
    meta: { title },
    segments: [{ type: 'text', content: title }],
    optional: false,
    contentId: null,
    learningOutcomeId: null,
    learningOutcomeName: null,
  });

  it('sections before first boundary → error', () => {
    const items: FlatItem[] = [
      makeSection('Orphan'),
      { __boundary: true, title: 'Group' },
      makeSection('A'),
    ];

    const errs = validateBoundaries(items, 'test.md');

    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0].message).toContain('outside');
  });

  it('consecutive boundaries → error', () => {
    const items: FlatItem[] = [
      { __boundary: true, title: 'A' },
      { __boundary: true, title: 'B' },
      makeSection('Content'),
    ];

    const errs = validateBoundaries(items, 'test.md');

    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0].message).toContain('empty');
  });

  it('trailing boundary with no sections → error', () => {
    const items: FlatItem[] = [
      { __boundary: true, title: 'A' },
      makeSection('Content'),
      { __boundary: true, title: 'B' },
    ];

    const errs = validateBoundaries(items, 'test.md');

    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0].message).toContain('empty');
  });

  it('all content in boundaries → no errors', () => {
    const items: FlatItem[] = [
      { __boundary: true, title: 'A' },
      makeSection('Content A'),
      { __boundary: true, title: 'B' },
      makeSection('Content B'),
    ];

    const errs = validateBoundaries(items, 'test.md');

    expect(errs).toHaveLength(0);
  });

  it('no boundaries at all → no errors', () => {
    const items: FlatItem[] = [makeSection('A'), makeSection('B')];

    const errs = validateBoundaries(items, 'test.md');

    expect(errs).toHaveLength(0);
  });
});

// -- Step 4b: Full submodule fixtures --

describe('flattenModule submodules', () => {
  it('F1: no submodules → single module, no parentSlug (regression)', () => {
    const files = buildFiles({
      'modules/intro.md': `---
slug: intro
title: Intro
---

# Learning Outcome: Topic
source:: [[../Learning Outcomes/lo1.md|LO1]]
`,
      'Learning Outcomes/lo1.md': simpleLO('lo-1-id', [
        { path: '../Lenses/lens1.md' },
      ]),
      'Lenses/lens1.md': pageLens('lens-1-id', 'Content', 'Hello world.'),
    });

    const result = flattenModule('modules/intro.md', files);

    expect(result.modules).toHaveLength(1);
    expect(result.modules[0].slug).toBe('intro');
    expect(result.modules[0].parentSlug).toBeUndefined();
    expect(result.modules[0].sections).toHaveLength(1);
  });

  it('F2: module-level submodules → 2 FlattenedModules with parentSlug', () => {
    const files = buildFiles({
      'modules/big.md': `---
slug: big
title: Big Module
---

# Submodule: Welcome
slug:: welcome

## Lens: Welcome to AI Safety
source:: [[../Lenses/welcome.md]]

# Submodule: Research Methods

## Learning Outcome:
source:: [[../Learning Outcomes/lo1.md|LO1]]
`,
      'Lenses/welcome.md': pageLens('page-id-1', 'Welcome', 'We begin by examining...'),
      'Learning Outcomes/lo1.md': simpleLO('lo-1-id', [
        { path: '../Lenses/lens1.md' },
      ]),
      'Lenses/lens1.md': pageLens('lens-1-id', 'Research', 'Research content.'),
    });

    const result = flattenModule('modules/big.md', files);

    expect(result.modules).toHaveLength(2);
    expect(result.modules[0].slug).toBe('big/welcome');
    expect(result.modules[0].parentSlug).toBe('big');
    expect(result.modules[0].parentTitle).toBe('Big Module');
    expect(result.modules[0].sections.length).toBeGreaterThan(0);
    expect(result.modules[1].slug).toBe('big/research-methods');
    expect(result.modules[1].parentSlug).toBe('big');
  });

  it('F3: LO-level submodules → 2 FlattenedModules', () => {
    const files = buildFiles({
      'modules/split.md': `---
slug: split
title: Split Module
---

# Learning Outcome:
source:: [[../Learning Outcomes/lo-split.md|Split LO]]
`,
      'Learning Outcomes/lo-split.md': loWithSubmodules('lo-split-id', [
        { title: 'Basics', lensRefs: ['../Lenses/lens1.md'] },
        { title: 'Deep Dive', lensRefs: ['../Lenses/lens2.md'] },
      ]),
      'Lenses/lens1.md': pageLens('lens-1-id', 'Basics Content', 'Basic stuff.'),
      'Lenses/lens2.md': pageLens('lens-2-id', 'Deep Content', 'Deep stuff.'),
    });

    const result = flattenModule('modules/split.md', files);

    expect(result.modules).toHaveLength(2);
    expect(result.modules[0].slug).toBe('split/basics');
    expect(result.modules[0].parentSlug).toBe('split');
    expect(result.modules[0].sections).toHaveLength(1);
    expect(result.modules[1].slug).toBe('split/deep-dive');
    expect(result.modules[1].parentSlug).toBe('split');
    expect(result.modules[1].sections).toHaveLength(1);
  });

  it('F4: LO with # Submodule: (h1) groups → all content inside submodules', () => {
    // Real-world pattern: LO uses # Submodule: (h1) with ## Lens: (h2) children.
    // All content must be inside submodules (no orphaned top-level lenses).
    const files = buildFiles({
      'modules/approaches.md': `---
slug: existing-approaches
title: Existing Approaches
---

# Learning Outcome:
source:: [[../Learning Outcomes/lo-approaches.md|Approaches LO]]
`,
      'Learning Outcomes/lo-approaches.md': `---
id: lo-approaches-id
---

# Submodule: Mechanistic Interpretability

## Lens:
source:: [[../Lenses/lens-mi1.md]]

## Lens:
source:: [[../Lenses/lens-mi2.md]]

# Submodule: Evals

## Lens:
source:: [[../Lenses/lens-evals1.md]]
`,
      'Lenses/lens-mi1.md': pageLens('mi1-id', 'Mech Interp', 'MI content 1.'),
      'Lenses/lens-mi2.md': pageLens('mi2-id', 'MI for Safety', 'MI content 2.'),
      'Lenses/lens-evals1.md': pageLens('evals1-id', 'AI Evaluations', 'Evals content.'),
    });

    const result = flattenModule('modules/approaches.md', files);

    // Should not have hard errors
    expect(result.errors.filter(e => e.severity === 'error')).toHaveLength(0);

    // Should produce 2 submodule groups
    expect(result.modules).toHaveLength(2);

    // MI submodule: 2 sections (2 lenses)
    const mi = result.modules.find(m => m.slug.includes('mechanistic'));
    expect(mi).toBeDefined();
    expect(mi!.sections).toHaveLength(2);
    expect(mi!.parentSlug).toBe('existing-approaches');

    // Evals submodule: 1 section
    const evals = result.modules.find(m => m.slug.includes('evals'));
    expect(evals).toBeDefined();
    expect(evals!.sections).toHaveLength(1);
    expect(evals!.parentSlug).toBe('existing-approaches');
  });

  it('F5: orphaned content before first submodule → error', () => {
    const files = buildFiles({
      'modules/bad.md': `---
slug: bad
title: Bad
---

# Lens: Orphan
source:: [[../Lenses/orphan.md]]

# Submodule: Group A

## Learning Outcome:
source:: [[../Learning Outcomes/lo1.md|LO1]]
`,
      'Lenses/orphan.md': pageLens('orphan-id', 'Orphan', 'This is orphaned.'),
      'Learning Outcomes/lo1.md': simpleLO('lo-1-id', [
        { path: '../Lenses/lens1.md' },
      ]),
      'Lenses/lens1.md': pageLens('lens-1-id', 'Content', 'Hello.'),
    });

    const result = flattenModule('modules/bad.md', files);

    expect(result.errors.some(e =>
      e.severity === 'error' &&
      e.message.toLowerCase().includes('outside')
    )).toBe(true);
  });

  it('F7: consecutive boundaries → error', () => {
    const files = buildFiles({
      'modules/empty-sub.md': `---
slug: empty-sub
title: Empty Sub
---

# Submodule: A

# Submodule: B

## Learning Outcome:
source:: [[../Learning Outcomes/lo1.md|LO1]]
`,
      'Learning Outcomes/lo1.md': simpleLO('lo-1-id', [
        { path: '../Lenses/lens1.md' },
      ]),
      'Lenses/lens1.md': pageLens('lens-1-id', 'Content', 'Hello.'),
    });

    const result = flattenModule('modules/empty-sub.md', files);

    expect(result.errors.some(e =>
      e.severity === 'error' &&
      e.message.toLowerCase().includes('empty')
    )).toBe(true);
  });

  it('F8: submodule ## Lens: produces lens sections with text segments', () => {
    const files = buildFiles({
      'modules/big.md': `---
slug: big
title: Big Module
---

# Submodule: Welcome
slug:: welcome

## Lens: Welcome to AI Safety
source:: [[../Lenses/welcome.md]]

# Submodule: Research
slug:: research

## Lens: Research Methods
source:: [[../Lenses/research.md]]
`,
      'Lenses/welcome.md': `---
id: page-id-1
---

#### Text
content:: We begin by examining AI safety.

#### Text
content:: This is the second paragraph.
`,
      'Lenses/research.md': `---
id: page-id-2
---

#### Text
content:: Research content here.
`,
    });

    const result = flattenModule('modules/big.md', files);

    // Filter out "missing source" errors from the submodule children parsing
    const criticalErrors = result.errors.filter(e =>
      e.severity === 'error' && !e.message.includes('Content found before first section header')
    );
    expect(criticalErrors).toHaveLength(0);
    expect(result.modules).toHaveLength(2);

    // Welcome submodule should have 1 lens section with 2 text segments
    const welcome = result.modules[0];
    expect(welcome.slug).toBe('big/welcome');
    expect(welcome.sections).toHaveLength(1);
    expect(welcome.sections[0].type).toBe('lens');
    expect(welcome.sections[0].segments).toHaveLength(2);
    expect(welcome.sections[0].segments[0].type).toBe('text');
    expect((welcome.sections[0].segments[0] as any).content).toContain('AI safety');
    expect((welcome.sections[0].segments[1] as any).content).toContain('second paragraph');

    // Research submodule should have 1 page section with 1 text segment
    const research = result.modules[1];
    expect(research.slug).toBe('big/research');
    expect(research.sections).toHaveLength(1);
    expect(research.sections[0].segments).toHaveLength(1);
    expect((research.sections[0].segments[0] as any).content).toContain('Research content');
  });

  it('F9: custom slug:: on submodule', () => {
    const files = buildFiles({
      'modules/custom.md': `---
slug: custom
title: Custom
---

# Submodule: Research Methods
slug:: research

## Learning Outcome:
source:: [[../Learning Outcomes/lo1.md|LO1]]
`,
      'Learning Outcomes/lo1.md': simpleLO('lo-1-id', [
        { path: '../Lenses/lens1.md' },
      ]),
      'Lenses/lens1.md': pageLens('lens-1-id', 'Content', 'Hello.'),
    });

    const result = flattenModule('modules/custom.md', files);

    expect(result.modules).toHaveLength(1);
    expect(result.modules[0].slug).toBe('custom/research');
  });

  it('F11: child submodules share parent contentId', () => {
    const files = buildFiles({
      'modules/approaches.md': `---
slug: existing-approaches
title: Existing Approaches
contentId: e2883472-3994-43a1-88a2-b4f64f70b210
---

# Submodule: Mechanistic Interpretability

## Learning Outcome:
source:: [[../Learning Outcomes/lo1.md|LO1]]

# Submodule: Evals

## Learning Outcome:
source:: [[../Learning Outcomes/lo2.md|LO2]]
`,
      'Learning Outcomes/lo1.md': simpleLO('lo-1-id', [
        { path: '../Lenses/lens1.md' },
      ]),
      'Learning Outcomes/lo2.md': simpleLO('lo-2-id', [
        { path: '../Lenses/lens2.md' },
      ]),
      'Lenses/lens1.md': pageLens('lens-1-id', 'MI', 'MI content.'),
      'Lenses/lens2.md': pageLens('lens-2-id', 'Evals', 'Evals content.'),
    });

    const result = flattenModule('modules/approaches.md', files);

    expect(result.errors.filter(e => e.severity === 'error')).toHaveLength(0);
    expect(result.modules).toHaveLength(2);
    // All submodules share the parent's contentId
    for (const mod of result.modules) {
      expect(mod.contentId).toBe('e2883472-3994-43a1-88a2-b4f64f70b210');
    }
  });

  it('F12: test section inside submodule appears in flattened output', () => {
    const files = buildFiles({
      'modules/approaches.md': `---
slug: existing-approaches
title: Existing Approaches
---

# Learning Outcome:
source:: [[../Learning Outcomes/lo-with-test.md|LO With Test]]
`,
      'Learning Outcomes/lo-with-test.md': `---
id: lo-test-id
---

# Submodule: Mechanistic Interpretability

## Lens:
source:: [[../Lenses/lens-mi.md]]

# Submodule: Agent Foundations

## Lens:
source:: [[../Lenses/lens-af.md]]

## Test:
id:: test-inline-id

#### Text
content:: We'll be asking you some questions about this module

#### Question
feedback:: true
content:: Explain each of these terms in one sentence.
assessment-instructions:: Check that the student gives clear definitions.
max-chars:: 900
`,
      'Lenses/lens-mi.md': pageLens('mi-id', 'Mech Interp', 'MI content.'),
      'Lenses/lens-af.md': pageLens('af-id', 'Agent Foundations', 'AF content.'),
    });

    const result = flattenModule('modules/approaches.md', files);

    expect(result.errors.filter(e => e.severity === 'error')).toHaveLength(0);
    expect(result.modules).toHaveLength(2);

    // Agent Foundations submodule should have the test section
    const af = result.modules.find(m => m.slug.includes('agent'));
    expect(af).toBeDefined();

    // Should have 1 lens + 1 test = 2 sections
    expect(af!.sections).toHaveLength(2);

    const testSection = af!.sections.find(s => s.type === 'test');
    expect(testSection).toBeDefined();
    expect(testSection!.learningOutcomeId).toBe('lo-test-id');
    expect(testSection!.feedback).toBe(true);
    expect(testSection!.segments).toHaveLength(2); // text + question

    // MI submodule should NOT have a test (only 1 lens)
    const mi = result.modules.find(m => m.slug.includes('mechanistic'));
    expect(mi).toBeDefined();
    expect(mi!.sections).toHaveLength(1);
    expect(mi!.sections.every(s => s.type !== 'test')).toBe(true);
  });
});

describe('processContent with submodules', () => {
  it('F10: course referencing split module expands progression', () => {
    const files = buildFiles({
      'modules/big.md': `---
slug: big
title: Big Module
---

# Submodule: Welcome
slug:: welcome

## Lens: Welcome Page
source:: [[../Lenses/welcome.md]]

# Submodule: Research

## Learning Outcome:
source:: [[../Learning Outcomes/lo1.md|LO1]]
`,
      'Lenses/welcome.md': pageLens('welcome-id', 'Welcome', 'Welcome content.'),
      'Learning Outcomes/lo1.md': simpleLO('lo-1-id', [
        { path: '../Lenses/lens1.md' },
      ]),
      'Lenses/lens1.md': pageLens('lens-1-id', 'Research Content', 'Research.'),
      'courses/test.md': `---
slug: test-course
title: Test Course
---

# Module: [[../modules/big]]

# Meeting: Some Name
`,
    });

    const result = processContent(files);

    // Should have 2 submodules in the modules list
    const submodules = result.modules.filter(m => m.parentSlug === 'big');
    expect(submodules).toHaveLength(2);
    expect(submodules[0].slug).toBe('big/welcome');
    expect(submodules[1].slug).toBe('big/research');

    // Course progression should auto-expand 'big' into submodule slugs
    const course = result.courses[0];
    expect(course).toBeDefined();
    const moduleSlugs = course.progression
      .filter(p => p.type === 'module')
      .map(p => p.slug);
    expect(moduleSlugs).toContain('big/welcome');
    expect(moduleSlugs).toContain('big/research');
    expect(moduleSlugs).not.toContain('big');
  });
});

describe('text segment wikilink resolution', () => {
  it('resolves wikilinks in text segment content', () => {
    const files = new Map<string, string>([
      ['modules/test-module.md', `---
slug: test-module
title: "Test Module"
---
# Lens: Welcome
id:: welcome-id

#### Text
content:: See [[../Lenses/Target Lens]] for more.
`],
      ['Lenses/Target Lens.md', `---
id: target-lens-id
title: "Target Lens Title"
---
#### Text
content:: hello
`],
    ]);

    const result = flattenModule('modules/test-module.md', files);
    const textSeg = result.module!.sections[0].segments[0];
    expect(textSeg.type).toBe('text');
    expect((textSeg as any).content).toBe('See [Target Lens Title](lens:target-lens-id) for more.');
  });
});
