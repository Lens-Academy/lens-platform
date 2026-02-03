// src/flattener/index.test.ts
import { describe, it, expect } from 'vitest';
import { flattenModule } from './index.js';

describe('flattenModule', () => {
  it('resolves learning outcome references', () => {
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

## Lens: Basic
source:: [[../Lenses/lens1.md|Lens]]
`],
      ['Lenses/lens1.md', `---
id: 550e8400-e29b-41d4-a716-446655440002
---

### Text: Content

#### Text
content:: The actual content here.
`],
    ]);

    const result = flattenModule('modules/intro.md', files);

    expect(result.module).toBeDefined();
    expect(result.module?.slug).toBe('intro');
    expect(result.module?.title).toBe('Intro');
    expect(result.module?.sections).toHaveLength(1);
    expect(result.module?.sections[0].type).toBe('page');
    expect(result.module?.sections[0].meta.title).toBe('Topic');
    expect(result.module?.sections[0].learningOutcomeId).toBe('550e8400-e29b-41d4-a716-446655440001');
    expect(result.module?.sections[0].segments).toHaveLength(1);
    expect(result.module?.sections[0].segments[0].type).toBe('text');
    expect((result.module?.sections[0].segments[0] as { type: 'text'; content: string }).content).toBe('The actual content here.');
    expect(result.errors).toHaveLength(0);
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
    // Module should still be returned with error field for partial success
    expect(result.module).toBeDefined();
    expect(result.module?.slug).toBe('broken');
    expect(result.module?.error).toContain('not found');
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

  it('handles optional learning outcomes', () => {
    const files = new Map([
      ['modules/optional.md', `---
slug: optional
title: Optional Module
---

# Learning Outcome: Required Topic
source:: [[../Learning Outcomes/lo1.md|LO1]]

# Learning Outcome: Optional Topic
source:: [[../Learning Outcomes/lo2.md|LO2]]
optional:: true
`],
      ['Learning Outcomes/lo1.md', `---
id: 550e8400-e29b-41d4-a716-446655440001
---

## Lens: Lens 1
source:: [[../Lenses/lens1.md|Lens]]
`],
      ['Learning Outcomes/lo2.md', `---
id: 550e8400-e29b-41d4-a716-446655440002
---

## Lens: Lens 2
source:: [[../Lenses/lens2.md|Lens]]
`],
      ['Lenses/lens1.md', `---
id: 550e8400-e29b-41d4-a716-446655440010
---

### Text: Content 1

#### Text
content:: First content.
`],
      ['Lenses/lens2.md', `---
id: 550e8400-e29b-41d4-a716-446655440011
---

### Text: Content 2

#### Text
content:: Second content.
`],
    ]);

    const result = flattenModule('modules/optional.md', files);

    expect(result.module).toBeDefined();
    expect(result.module?.sections).toHaveLength(2);
    expect(result.module?.sections[0].optional).toBe(false);
    expect(result.module?.sections[1].optional).toBe(true);
  });
});
