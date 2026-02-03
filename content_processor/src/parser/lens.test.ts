// src/parser/lens.test.ts
import { describe, it, expect } from 'vitest';
import { parseLens } from './lens.js';

describe('parseLens', () => {
  it('parses lens with text segment (H3 section, H4 segment)', () => {
    const content = `---
id: 550e8400-e29b-41d4-a716-446655440002
---

### Text: Introduction

#### Text
content:: This is introductory content.
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    expect(result.lens?.id).toBe('550e8400-e29b-41d4-a716-446655440002');
    expect(result.lens?.sections).toHaveLength(1);
    expect(result.lens?.sections[0].type).toBe('text');
    expect(result.lens?.sections[0].segments[0].type).toBe('text');
    expect(result.lens?.sections[0].segments[0].content).toBe('This is introductory content.');
  });

  it('parses article section with excerpt', () => {
    const content = `---
id: 550e8400-e29b-41d4-a716-446655440002
---

### Article: Deep Dive
source:: [[../articles/deep-dive.md|Article]]

#### Article-excerpt
from:: "The key insight is"
to:: "understanding this concept."
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    expect(result.lens?.sections[0].type).toBe('lens-article');
    expect(result.lens?.sections[0].source).toBe('[[../articles/deep-dive.md|Article]]');
    expect(result.lens?.sections[0].segments[0].type).toBe('article-excerpt');
    // Note: from/to are parsed as strings here, converted to anchors during bundling
    expect(result.lens?.sections[0].segments[0].fromAnchor).toBe('The key insight is');
    expect(result.lens?.sections[0].segments[0].toAnchor).toBe('understanding this concept.');
  });

  it('parses video section with timestamp excerpt', () => {
    const content = `---
id: 550e8400-e29b-41d4-a716-446655440002
---

### Video: Expert Interview
source:: [[../video_transcripts/interview.md|Video]]

#### Video-excerpt
from:: 1:30
to:: 5:45
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    expect(result.lens?.sections[0].type).toBe('lens-video');
    expect(result.lens?.sections[0].source).toBe('[[../video_transcripts/interview.md|Video]]');
    expect(result.lens?.sections[0].segments[0].type).toBe('video-excerpt');
    // Parsed as strings, converted to seconds during bundling
    expect(result.lens?.sections[0].segments[0].fromTimeStr).toBe('1:30');
    expect(result.lens?.sections[0].segments[0].toTimeStr).toBe('5:45');
  });

  it('requires source field in article/video sections', () => {
    const content = `---
id: 550e8400-e29b-41d4-a716-446655440002
---

### Article: No Source

#### Article-excerpt
from:: "Start"
to:: "End"
`;

    const result = parseLens(content, 'Lenses/bad.md');

    expect(result.errors.some(e => e.message.includes('source'))).toBe(true);
  });
});
