// src/parser/lens.test.ts
import { describe, it, expect } from 'vitest';
import { parseLens } from './lens.js';

describe('parseLens', () => {
  it('parses lens with page section (H3 section, H4 segment)', () => {
    const content = `---
id: 550e8400-e29b-41d4-a716-446655440002
---

### Page: Introduction

#### Text
content:: This is introductory content.
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    expect(result.lens?.id).toBe('550e8400-e29b-41d4-a716-446655440002');
    expect(result.lens?.sections).toHaveLength(1);
    expect(result.lens?.sections[0].type).toBe('page');
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

### Page: Introduction

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

### Page: Discussion

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

### Page: Discussion

#### Chat: Discussion on AI Basics
instructions:: Talk about AI basics.
`;

    const result = parseLens(content, 'Lenses/test.md');

    const chatSegment = result.lens?.sections[0].segments[0];
    expect(chatSegment?.type).toBe('chat');
    expect(chatSegment?.title).toBe('Discussion on AI Basics');
    expect(chatSegment?.instructions).toBe('Talk about AI basics.');
  });

  it('parses segment type case-insensitively (#### Chat, #### CHAT, #### chat all work)', () => {
    const content = `---
id: test-id
---

### Page: Mixed Case

#### Chat
instructions:: lowercase implicit
#### Chat:
instructions:: with trailing colon
#### CHAT: Uppercase
instructions:: uppercase variant
`;

    const result = parseLens(content, 'Lenses/test.md');

    const segments = result.lens?.sections[0].segments ?? [];
    expect(segments).toHaveLength(3);
    expect(segments[0].type).toBe('chat');
    expect(segments[1].type).toBe('chat');
    expect(segments[2].type).toBe('chat');
    expect(result.errors.filter(e => e.severity === 'error')).toHaveLength(0);
  });

  // Task 7.2: Field in wrong segment type
  it('warns about from:: field in text segment', () => {
    const content = `---
id: test-id
---

### Page: Wrong Field

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

### Page: Wrong Field

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

### Page: Empty Content

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

### Page: Whitespace Only

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

### Page: Has Content

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

### Page: Has Empty

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

### Page: Has Empty

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

### Page: Has Content

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

### Page: Empty Text Section
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

### Page: Test

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

### Page: Test

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

### Page: Test

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

  // Task 6: Empty segment validation - required fields per segment type
  describe('empty segment validation - required fields', () => {
    it('errors on text segment without content:: field', () => {
      const content = `---
id: test-id
---

### Page: Missing Content
#### Text
optional:: true
`;

      const result = parseLens(content, 'Lenses/test.md');

      expect(result.errors.some(e =>
        e.severity === 'error' &&
        e.message.includes('content') &&
        e.message.includes('missing')
      )).toBe(true);
    });

    it('errors on chat segment without instructions:: field', () => {
      const content = `---
id: test-id
---

### Page: Missing Instructions
#### Chat
optional:: true
`;

      const result = parseLens(content, 'Lenses/test.md');

      expect(result.errors.some(e =>
        e.severity === 'error' &&
        e.message.includes('instructions') &&
        e.message.includes('missing')
      )).toBe(true);
    });

    it('errors on article-excerpt segment in section without source:: field', () => {
      const content = `---
id: test-id
---

### Article: Missing Source
#### Article-excerpt
from:: "Start"
to:: "End"
`;

      const result = parseLens(content, 'Lenses/test.md');

      expect(result.errors.some(e =>
        e.severity === 'error' &&
        e.message.includes('source')
      )).toBe(true);
    });

    it('errors on video-excerpt segment in section without source:: field', () => {
      const content = `---
id: test-id
---

### Video: Missing Source
#### Video-excerpt
from:: 0:00
to:: 1:00
`;

      const result = parseLens(content, 'Lenses/test.md');

      expect(result.errors.some(e =>
        e.severity === 'error' &&
        e.message.includes('source')
      )).toBe(true);
    });

    it('accepts valid segments with all required fields', () => {
      const content = `---
id: test-id
---

### Page: Valid Page
#### Text
content:: Some content here.

#### Chat
instructions:: Do something here.

### Article: Valid Article
source:: [[../articles/test.md|Article]]
#### Article-excerpt
from:: "Start"
to:: "End"

### Video: Valid Video
source:: [[../video_transcripts/test.md|Video]]
#### Video-excerpt
from:: 0:00
to:: 1:00
`;

      const result = parseLens(content, 'Lenses/test.md');

      // No errors about missing required fields
      const missingFieldErrors = result.errors.filter(e =>
        e.severity === 'error' &&
        e.message.toLowerCase().includes('missing')
      );
      expect(missingFieldErrors).toHaveLength(0);
    });
  });

  // Task 7: Unknown segment type detection (H4 segments)
  describe('unknown H4 segment type detection', () => {
    it('errors on #### Quiz (unknown segment type)', () => {
      const content = `---
id: test-id
---

### Page: Test Page
#### Quiz
question:: What is AI?
`;

      const result = parseLens(content, 'Lenses/test.md');

      expect(result.errors.some(e =>
        e.severity === 'error' &&
        e.message.includes('Unknown segment type') &&
        e.message.includes('Quiz')
      )).toBe(true);
      // Should include suggestion with valid types
      expect(result.errors.some(e =>
        e.suggestion?.includes('text') &&
        e.suggestion?.includes('chat') &&
        e.suggestion?.includes('article-excerpt') &&
        e.suggestion?.includes('video-excerpt')
      )).toBe(true);
    });

    it('errors on #### Unknown (unknown segment type)', () => {
      const content = `---
id: test-id
---

### Page: Test Page
#### Unknown
content:: This uses an invalid segment type.
`;

      const result = parseLens(content, 'Lenses/test.md');

      expect(result.errors.some(e =>
        e.severity === 'error' &&
        e.message.includes('Unknown segment type') &&
        e.message.includes('Unknown')
      )).toBe(true);
    });

    it('errors on #### Summary (unknown segment type)', () => {
      const content = `---
id: test-id
---

### Page: Test Page
#### Summary
content:: This segment type does not exist.
`;

      const result = parseLens(content, 'Lenses/test.md');

      expect(result.errors.some(e =>
        e.severity === 'error' &&
        e.message.includes('Unknown segment type') &&
        e.message.includes('Summary')
      )).toBe(true);
    });

    it('accepts valid segment type #### Text', () => {
      const content = `---
id: test-id
---

### Page: Test Page
#### Text
content:: Valid text segment.
`;

      const result = parseLens(content, 'Lenses/test.md');

      expect(result.errors.filter(e =>
        e.message.includes('Unknown segment type')
      )).toHaveLength(0);
    });

    it('accepts valid segment type #### Chat', () => {
      const content = `---
id: test-id
---

### Page: Test Page
#### Chat
instructions:: Valid chat segment.
`;

      const result = parseLens(content, 'Lenses/test.md');

      expect(result.errors.filter(e =>
        e.message.includes('Unknown segment type')
      )).toHaveLength(0);
    });

    it('accepts valid segment type #### Article-excerpt', () => {
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

      expect(result.errors.filter(e =>
        e.message.includes('Unknown segment type')
      )).toHaveLength(0);
    });

    it('accepts valid segment type #### Video-excerpt', () => {
      const content = `---
id: test-id
---

### Video: Test Video
source:: [[../video_transcripts/test.md|Video]]
#### Video-excerpt
from:: 0:00
to:: 1:00
`;

      const result = parseLens(content, 'Lenses/test.md');

      expect(result.errors.filter(e =>
        e.message.includes('Unknown segment type')
      )).toHaveLength(0);
    });

    it('handles case-insensitive matching (#### TEXT is valid)', () => {
      const content = `---
id: test-id
---

### Page: Test Page
#### TEXT
content:: Case insensitive text segment.
`;

      const result = parseLens(content, 'Lenses/test.md');

      expect(result.errors.filter(e =>
        e.message.includes('Unknown segment type')
      )).toHaveLength(0);
      expect(result.lens?.sections[0].segments[0].type).toBe('text');
    });

    it('handles case-insensitive matching (#### CHAT is valid)', () => {
      const content = `---
id: test-id
---

### Page: Test Page
#### CHAT
instructions:: Case insensitive chat segment.
`;

      const result = parseLens(content, 'Lenses/test.md');

      expect(result.errors.filter(e =>
        e.message.includes('Unknown segment type')
      )).toHaveLength(0);
      expect(result.lens?.sections[0].segments[0].type).toBe('chat');
    });
  });

  describe('invalid H3 section types', () => {
    it('returns error for ### Text (unknown section type)', () => {
      const content = `---
id: test-id
---

### Text
#### Text
content:: Text is not a valid H3 section type.
`;

      const result = parseLens(content, 'Lenses/test.md');

      expect(result.errors.some(e =>
        e.severity === 'error' &&
        e.message.includes('Unknown section type')
      )).toBe(true);
    });

    it('returns error for any unknown H3 section type', () => {
      const content = `---
id: test-id
---

### Something Random Here
#### Text
content:: Whatever.
`;

      const result = parseLens(content, 'Lenses/test.md');

      expect(result.errors.some(e =>
        e.severity === 'error' &&
        e.message.includes('Unknown section type')
      )).toBe(true);
    });

    it('returns error for ### Text: (renamed to ### Page:)', () => {
      const content = `---
id: test-id
---

### Text: Old Syntax
#### Text
content:: This uses the old ### Text syntax.
`;

      const result = parseLens(content, 'Lenses/test.md');

      expect(result.errors.some(e =>
        e.severity === 'error' &&
        e.message.includes('Unknown section type') &&
        e.message.includes('Text')
      )).toBe(true);
    });

    it('returns error for ### Chat: (Chat is only valid at H4 segment level)', () => {
      const content = `---
id: test-id
---

### Chat: Invalid Section
instructions:: This incorrectly uses Chat as a section type.
`;

      const result = parseLens(content, 'Lenses/test.md');

      expect(result.errors.some(e =>
        e.severity === 'error' &&
        e.message.includes('Unknown section type') &&
        e.message.includes('Chat')
      )).toBe(true);
    });

    it('accepts valid section types: Page, Article, Video', () => {
      const content = `---
id: test-id
---

### Page: Valid Page
#### Text
content:: Page content.

### Article: Valid Article
source:: [[../articles/test.md|Article]]
#### Article-excerpt

### Video: Valid Video
source:: [[../video_transcripts/test.md|Video]]
#### Video-excerpt
from:: 0:00
to:: 1:00
`;

      const result = parseLens(content, 'Lenses/test.md');

      // No errors about unknown section types
      expect(result.errors.filter(e =>
        e.message.includes('Unknown section type')
      )).toHaveLength(0);
    });
  });

  describe('mixed section type detection', () => {
    it('warns when lens has both Article and Video sections', () => {
      const content = `---
id: test-id
---

### Article: Reading
source:: [[../articles/test.md|Article]]

#### Article-excerpt

### Video: Watching
source:: [[../video_transcripts/test.md|Video]]

#### Video-excerpt
from:: 0:00
to:: 5:00
`;

      const result = parseLens(content, 'Lenses/test.md');

      expect(result.errors.some(e =>
        e.severity === 'warning' &&
        e.message.includes('mixed') || e.message.includes('conflicting')
      )).toBe(true);
    });

    it('does not warn when lens has only Page sections', () => {
      const content = `---
id: test-id
---

### Page: Intro
#### Text
content:: Hello.

### Page: Discussion
#### Chat
instructions:: Discuss.
`;

      const result = parseLens(content, 'Lenses/test.md');

      expect(result.errors.filter(e =>
        e.message.includes('mixed') || e.message.includes('conflicting')
      )).toHaveLength(0);
    });

    it('does not warn when lens has Page + Article (Page is neutral)', () => {
      const content = `---
id: test-id
---

### Page: Intro
#### Text
content:: Hello.

### Article: Reading
source:: [[../articles/test.md|Article]]
#### Article-excerpt
`;

      const result = parseLens(content, 'Lenses/test.md');

      expect(result.errors.filter(e =>
        e.message.includes('mixed') || e.message.includes('conflicting')
      )).toHaveLength(0);
    });
  });

  describe('non-string id validation', () => {
    it('errors when id is a number', () => {
      const content = `---
id: 12345
---

### Page: Test
#### Text
content:: Hello.
`;

      const result = parseLens(content, 'Lenses/test.md');

      expect(result.errors.some(e =>
        e.severity === 'error' &&
        e.message.includes('id') &&
        e.message.includes('string')
      )).toBe(true);
    });

    it('errors when id is a boolean', () => {
      const content = `---
id: true
---

### Page: Test
#### Text
content:: Hello.
`;

      const result = parseLens(content, 'Lenses/test.md');

      expect(result.errors.some(e =>
        e.severity === 'error' &&
        e.message.includes('id') &&
        e.message.includes('string')
      )).toBe(true);
    });
  });

  it('warns when single colon is used instead of :: in segment fields', () => {
    const content = `---
id: test-id
---

### Page: Test

#### Text
content: This uses single colon.
`;

    const result = parseLens(content, 'Lenses/test.md');

    expect(result.errors.some(e =>
      e.severity === 'warning' &&
      e.message.includes('content') &&
      e.message.includes('::')
    )).toBe(true);
  });

  describe('segment/section type mismatch', () => {
    it('warns about article-excerpt in a Page section', () => {
      const content = `---
id: test-id
---

### Page: Introduction

#### Article-excerpt
from:: "Start"
to:: "End"
`;

      const result = parseLens(content, 'Lenses/test.md');

      expect(result.errors.some(e =>
        e.severity === 'warning' &&
        e.message.includes('article-excerpt') &&
        e.message.includes('Page')
      )).toBe(true);
    });

    it('warns about video-excerpt in a Page section', () => {
      const content = `---
id: test-id
---

### Page: Introduction

#### Video-excerpt
from:: 0:00
to:: 5:00
`;

      const result = parseLens(content, 'Lenses/test.md');

      expect(result.errors.some(e =>
        e.severity === 'warning' &&
        e.message.includes('video-excerpt') &&
        e.message.includes('Page')
      )).toBe(true);
    });

    it('warns about video-excerpt in an Article section', () => {
      const content = `---
id: test-id
---

### Article: Test
source:: [[../articles/test.md|Article]]

#### Video-excerpt
from:: 0:00
to:: 5:00
`;

      const result = parseLens(content, 'Lenses/test.md');

      expect(result.errors.some(e =>
        e.severity === 'warning' &&
        e.message.includes('video-excerpt') &&
        e.message.includes('Article')
      )).toBe(true);
    });

    it('does not warn about article-excerpt in Article section', () => {
      const content = `---
id: test-id
---

### Article: Test
source:: [[../articles/test.md|Article]]

#### Article-excerpt
from:: "Start"
to:: "End"
`;

      const result = parseLens(content, 'Lenses/test.md');

      expect(result.errors.filter(e =>
        e.message.includes('not valid in')
      )).toHaveLength(0);
    });
  });

  describe('timestamp format validation', () => {
    it('warns about invalid from:: timestamp format', () => {
      const content = `---
id: test-id
---

### Video: Test
source:: [[../video_transcripts/test.md|Video]]

#### Video-excerpt
from:: 1 hour 30 min
to:: 5:45
`;

      const result = parseLens(content, 'Lenses/test.md');

      expect(result.errors.some(e =>
        e.severity === 'warning' &&
        e.message.includes('from') &&
        e.message.includes('timestamp')
      )).toBe(true);
    });

    it('warns about invalid to:: timestamp format', () => {
      const content = `---
id: test-id
---

### Video: Test
source:: [[../video_transcripts/test.md|Video]]

#### Video-excerpt
from:: 0:00
to:: five minutes
`;

      const result = parseLens(content, 'Lenses/test.md');

      expect(result.errors.some(e =>
        e.severity === 'warning' &&
        e.message.includes('to') &&
        e.message.includes('timestamp')
      )).toBe(true);
    });

    it('accepts valid timestamp formats', () => {
      const content = `---
id: test-id
---

### Video: Test
source:: [[../video_transcripts/test.md|Video]]

#### Video-excerpt
from:: 1:30
to:: 5:45
`;

      const result = parseLens(content, 'Lenses/test.md');

      expect(result.errors.filter(e =>
        e.message.includes('timestamp')
      )).toHaveLength(0);
    });
  });

  it('handles capitalized boolean values in chat segment', () => {
    const content = `---
id: 550e8400-e29b-41d4-a716-446655440002
---

### Page: Introduction

#### Chat
instructions:: Discuss the key concepts.
hidePreviousContentFromUser:: True
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    const chatSeg = result.lens?.sections[0].segments[0];
    expect(chatSeg?.type).toBe('chat');
    expect((chatSeg as any).hidePreviousContentFromUser).toBe(true);
  });

  it('handles uppercase TRUE in optional field', () => {
    const content = `---
id: 550e8400-e29b-41d4-a716-446655440002
---

### Page: Introduction

#### Text
content:: Some content here.
optional:: TRUE
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    const textSeg = result.lens?.sections[0].segments[0];
    expect(textSeg?.type).toBe('text');
    expect((textSeg as any).optional).toBe(true);
  });

  it('warns about free text between section header and first segment', () => {
    const content = `---
id: 550e8400-e29b-41d4-a716-446655440002
---

### Page: Introduction
This text appears before any #### segment header.
It should not be silently ignored.

#### Text
content:: Actual segment content here.
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    expect(result.errors.some(e =>
      e.severity === 'warning' &&
      e.message.includes('before first segment')
    )).toBe(true);
    expect(result.lens?.sections[0].segments).toHaveLength(1);
  });

  it('does not warn about blank lines between section header and first segment', () => {
    const content = `---
id: 550e8400-e29b-41d4-a716-446655440002
---

### Page: Introduction

#### Text
content:: Actual segment content here.
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    // Filter to only "ignored" warnings from parseSegments (not from sections.ts parseFields)
    const segmentIgnoredWarnings = result.errors.filter(e =>
      e.message.includes('before first segment')
    );
    expect(segmentIgnoredWarnings).toHaveLength(0);
  });

  it('does not warn about field:: lines before first segment (they belong to section-level parsing)', () => {
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

    // source:: is a section-level field, not free text — should NOT warn about it
    const segmentIgnoredWarnings = result.errors.filter(e =>
      e.message.includes('before first segment')
    );
    expect(segmentIgnoredWarnings).toHaveLength(0);
  });
});
