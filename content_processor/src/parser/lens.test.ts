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

  it('parses text segment with multiline content', () => {
    const content = `---
id: test-id
---

### Text: Introduction

#### Text
content::
Line one of content.
Line two of content.
Line three of content.

#### Chat
instructions:: Do something
`;

    const result = parseLens(content, 'Lenses/test.md');

    expect(result.lens?.sections[0].segments[0].type).toBe('text');
    expect(result.lens?.sections[0].segments[0].content).toContain('Line one');
    expect(result.lens?.sections[0].segments[0].content).toContain('Line two');
    expect(result.lens?.sections[0].segments[0].content).toContain('Line three');
  });

  it('parses video-excerpt with only to:: (from defaults to 0:00)', () => {
    const content = `---
id: test-id
---

### Video: Test Video
source:: [[../video_transcripts/test.md|Video]]

#### Video-excerpt
to:: 14:49
`;

    const result = parseLens(content, 'Lenses/test.md');

    expect(result.lens?.sections[0].segments[0].type).toBe('video-excerpt');
    expect(result.lens?.sections[0].segments[0].fromTimeStr).toBe('0:00');
    expect(result.lens?.sections[0].segments[0].toTimeStr).toBe('14:49');
  });

  it('parses chat segment with multiline instructions', () => {
    const content = `---
id: test-id
---

### Text: Discussion

#### Chat
instructions::
First line of instructions.
Second line with more details.

Topics to cover:
- Topic one
- Topic two

hidePreviousContentFromUser:: false
`;

    const result = parseLens(content, 'Lenses/test.md');

    const chatSegment = result.lens?.sections[0].segments[0];
    expect(chatSegment?.type).toBe('chat');
    expect(chatSegment?.instructions).toContain('First line');
    expect(chatSegment?.instructions).toContain('Topic one');
    expect(chatSegment?.instructions).toContain('Topic two');
  });

  it('parses article-excerpt with only from:: (to end of article)', () => {
    const content = `---
id: test-id
---

### Article: Test Article
source:: [[../articles/test.md|Article]]

#### Article-excerpt
from:: "Start here"
`;

    const result = parseLens(content, 'Lenses/test.md');

    expect(result.errors).toHaveLength(0);
    expect(result.lens?.sections[0].segments[0].type).toBe('article-excerpt');
    expect(result.lens?.sections[0].segments[0].fromAnchor).toBe('Start here');
    expect(result.lens?.sections[0].segments[0].toAnchor).toBeUndefined();
  });

  it('parses article-excerpt with only to:: (from start of article)', () => {
    const content = `---
id: test-id
---

### Article: Test Article
source:: [[../articles/test.md|Article]]

#### Article-excerpt
to:: "End here"
`;

    const result = parseLens(content, 'Lenses/test.md');

    expect(result.errors).toHaveLength(0);
    expect(result.lens?.sections[0].segments[0].type).toBe('article-excerpt');
    expect(result.lens?.sections[0].segments[0].fromAnchor).toBeUndefined();
    expect(result.lens?.sections[0].segments[0].toAnchor).toBe('End here');
  });

  it('parses empty article-excerpt (entire article)', () => {
    const content = `---
id: test-id
---

### Article: Test Article
source:: [[../articles/test.md|Article]]

#### Article-excerpt
`;

    const result = parseLens(content, 'Lenses/test.md');

    expect(result.errors).toHaveLength(0);
    expect(result.lens?.sections[0].segments[0].type).toBe('article-excerpt');
    expect(result.lens?.sections[0].segments[0].fromAnchor).toBeUndefined();
    expect(result.lens?.sections[0].segments[0].toAnchor).toBeUndefined();
  });

  it('parses chat segment with title', () => {
    const content = `---
id: test-id
---

### Text: Discussion

#### Chat: Discussion on AI Basics
instructions:: Talk about AI basics.
`;

    const result = parseLens(content, 'Lenses/test.md');

    const chatSegment = result.lens?.sections[0].segments[0];
    expect(chatSegment?.type).toBe('chat');
    expect(chatSegment?.title).toBe('Discussion on AI Basics');
    expect(chatSegment?.instructions).toBe('Talk about AI basics.');
  });

  // Task 7.2: Field in wrong segment type
  it('warns about from:: field in text segment', () => {
    const content = `---
id: test-id
---

### Text: Wrong Field

#### Text
content:: Some text.
from:: "This is wrong"
`;

    const result = parseLens(content, 'Lenses/test.md');

    expect(result.errors.some(e =>
      e.severity === 'warning' &&
      e.message.includes('from') &&
      e.message.includes('text')
    )).toBe(true);
  });

  it('warns about to:: field in chat segment', () => {
    const content = `---
id: test-id
---

### Text: Wrong Field

#### Chat
instructions:: Do something.
to:: "This is wrong"
`;

    const result = parseLens(content, 'Lenses/test.md');

    expect(result.errors.some(e =>
      e.severity === 'warning' &&
      e.message.includes('to') &&
      e.message.includes('chat')
    )).toBe(true);
  });

  it('does not warn about from/to in article-excerpt', () => {
    const content = `---
id: test-id
---

### Article: Test Article
source:: [[../articles/test.md|Article]]

#### Article-excerpt
from:: "Start"
to:: "End"
`;

    const result = parseLens(content, 'Lenses/test.md');

    // No warnings about from/to in article-excerpt
    expect(result.errors.filter(e =>
      e.severity === 'warning' &&
      (e.message.includes('from') || e.message.includes('to'))
    )).toHaveLength(0);
  });

  // Task 7.3: Empty content field warning
  it('warns about empty content:: field in text segment', () => {
    const content = `---
id: test-id
---

### Text: Empty Content

#### Text
content::
`;

    const result = parseLens(content, 'Lenses/test.md');

    expect(result.errors.some(e =>
      e.severity === 'warning' &&
      e.message.toLowerCase().includes('empty')
    )).toBe(true);
  });

  it('warns about whitespace-only content:: field', () => {
    const content = `---
id: test-id
---

### Text: Whitespace Only

#### Text
content::
`;

    const result = parseLens(content, 'Lenses/test.md');

    expect(result.errors.some(e =>
      e.severity === 'warning' &&
      e.message.toLowerCase().includes('empty')
    )).toBe(true);
  });

  it('does not warn about content:: with actual text', () => {
    const content = `---
id: test-id
---

### Text: Has Content

#### Text
content:: This is real content.
`;

    const result = parseLens(content, 'Lenses/test.md');

    // No empty content warnings
    expect(result.errors.filter(e =>
      e.severity === 'warning' &&
      e.message.toLowerCase().includes('empty')
    )).toHaveLength(0);
  });

  // Task 7.5: Empty segment warning
  describe('empty segment warnings', () => {
    it('warns about empty segment with no fields', () => {
      const content = `---
id: test-id
---

### Text: Has Empty

#### Chat

#### Text
content:: Real content here.
`;

      const result = parseLens(content, 'Lenses/test.md');

      expect(result.errors.some(e =>
        e.severity === 'warning' &&
        e.message.toLowerCase().includes('empty') &&
        e.message.toLowerCase().includes('chat')
      )).toBe(true);
    });

    it('warns about segment with only whitespace', () => {
      const content = `---
id: test-id
---

### Text: Has Empty

#### Text



#### Chat
instructions:: Do something.
`;

      const result = parseLens(content, 'Lenses/test.md');

      expect(result.errors.some(e =>
        e.severity === 'warning' &&
        e.message.toLowerCase().includes('empty')
      )).toBe(true);
    });

    it('does not warn about segment with fields', () => {
      const content = `---
id: test-id
---

### Text: Has Content

#### Text
content:: Some content.

#### Chat
instructions:: Do something.
`;

      const result = parseLens(content, 'Lenses/test.md');

      // No empty segment warnings
      expect(result.errors.filter(e =>
        e.severity === 'warning' &&
        e.message.toLowerCase().includes('empty') &&
        e.message.toLowerCase().includes('segment')
      )).toHaveLength(0);
    });
  });

  // Task 7.6: Section with no segments warning
  describe('section with no segments warnings', () => {
    it('warns about section with no segments', () => {
      const content = `---
id: test-id
---

### Article: Empty Section
source:: [[../articles/test.md|Article]]
`;

      const result = parseLens(content, 'Lenses/test.md');

      expect(result.errors.some(e =>
        e.severity === 'warning' &&
        e.message.toLowerCase().includes('no segments')
      )).toBe(true);
    });

    it('warns about text section with no segments', () => {
      const content = `---
id: test-id
---

### Text: Empty Text Section
`;

      const result = parseLens(content, 'Lenses/test.md');

      expect(result.errors.some(e =>
        e.severity === 'warning' &&
        e.message.toLowerCase().includes('no segments')
      )).toBe(true);
    });

    it('does not warn about section with segments', () => {
      const content = `---
id: test-id
---

### Article: Has Content
source:: [[../articles/test.md|Article]]

#### Article-excerpt
from:: "Start"
to:: "End"
`;

      const result = parseLens(content, 'Lenses/test.md');

      // No warnings about no segments
      expect(result.errors.filter(e =>
        e.severity === 'warning' &&
        e.message.toLowerCase().includes('no segments')
      )).toHaveLength(0);
    });
  });

  // Task 7.7: Boolean field with non-boolean value
  describe('boolean field value validation', () => {
    it('warns about optional:: field with non-boolean value', () => {
      const content = `---
id: test-id
---

### Text: Test

#### Text
content:: Some content.
optional:: yes
`;

      const result = parseLens(content, 'Lenses/test.md');

      expect(result.errors.some(e =>
        e.severity === 'warning' &&
        e.message.includes("'optional'") &&
        e.message.includes('non-boolean')
      )).toBe(true);
    });

    it('warns about hidePreviousContentFromUser:: with non-boolean value', () => {
      const content = `---
id: test-id
---

### Text: Test

#### Chat
instructions:: Do something.
hidePreviousContentFromUser:: 1
`;

      const result = parseLens(content, 'Lenses/test.md');

      expect(result.errors.some(e =>
        e.severity === 'warning' &&
        e.message.includes("'hidePreviousContentFromUser'") &&
        e.message.includes('non-boolean')
      )).toBe(true);
    });

    it('does not warn about boolean fields with valid values', () => {
      const content = `---
id: test-id
---

### Text: Test

#### Chat
instructions:: Do something.
hidePreviousContentFromUser:: true
hidePreviousContentFromTutor:: false
optional:: true
`;

      const result = parseLens(content, 'Lenses/test.md');

      // No warnings about boolean values
      expect(result.errors.filter(e =>
        e.severity === 'warning' &&
        e.message.includes('non-boolean')
      )).toHaveLength(0);
    });
  });
});
