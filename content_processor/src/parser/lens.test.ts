// src/parser/lens.test.ts
import { describe, it, expect } from 'vitest';
import { parseLens, stripCriticMarkup, stripAuthoringMarkup, stripObsidianComments } from './lens.js';

describe('parseLens', () => {
  it('parses lens with text segment (flat format)', () => {
    const content = `---
id: 550e8400-e29b-41d4-a716-446655440002
---

#### Text
content:: This is introductory content.
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    expect(result.lens?.id).toBe('550e8400-e29b-41d4-a716-446655440002');
    expect(result.lens?.segments).toHaveLength(1);
    expect(result.lens?.segments[0].type).toBe('text');
    expect((result.lens?.segments[0] as any).content).toBe('This is introductory content.');
  });

  it('parses article segment with source and anchors', () => {
    const content = `---
id: 550e8400-e29b-41d4-a716-446655440002
---

#### Article
source:: [[../articles/deep-dive.md|Article]]
from:: "The key insight is"
to:: "understanding this concept."
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    expect(result.lens?.segments[0].type).toBe('article');
    expect((result.lens?.segments[0] as any).source).toBe('[[../articles/deep-dive.md|Article]]');
    expect((result.lens?.segments[0] as any).fromAnchor).toBe('The key insight is');
    expect((result.lens?.segments[0] as any).toAnchor).toBe('understanding this concept.');
  });

  it('parses video segment with timestamps', () => {
    const content = `---
id: 550e8400-e29b-41d4-a716-446655440002
---

#### Video
source:: [[../video_transcripts/interview.md|Video]]
from:: 1:30
to:: 5:45
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    expect(result.lens?.segments[0].type).toBe('video');
    expect((result.lens?.segments[0] as any).source).toBe('[[../video_transcripts/interview.md|Video]]');
    expect((result.lens?.segments[0] as any).fromTimeStr).toBe('1:30');
    expect((result.lens?.segments[0] as any).toTimeStr).toBe('5:45');
  });

  it('errors when first article segment has no source', () => {
    const content = `---
id: 550e8400-e29b-41d4-a716-446655440002
---

#### Article
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

#### Text
content::
Line one of content.
Line two of content.
Line three of content.
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    const textSeg = result.lens?.segments[0];
    expect(textSeg?.type).toBe('text');
    expect((textSeg as any).content).toContain('Line one of content.');
    expect((textSeg as any).content).toContain('Line three of content.');
  });

  it('parses video with only to:: (from defaults to 0:00)', () => {
    const content = `---
id: test-id
---

#### Video
source:: [[../video_transcripts/interview.md|Video]]
to:: 5:45
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    const seg = result.lens?.segments[0];
    expect(seg?.type).toBe('video');
    expect((seg as any).fromTimeStr).toBe('0:00');
    expect((seg as any).toTimeStr).toBe('5:45');
  });

  it('parses chat segment with multiline instructions', () => {
    const content = `---
id: test-id
---

#### Chat: Discussion Time
instructions::
First line of instructions.
Second line of instructions.
Third line of instructions.
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    const chatSeg = result.lens?.segments[0];
    expect(chatSeg?.type).toBe('chat');
    expect((chatSeg as any).instructions).toContain('First line of instructions.');
    expect((chatSeg as any).title).toBe('Discussion Time');
  });

  it('parses article with only from:: (to end of article)', () => {
    const content = `---
id: test-id
---

#### Article
source:: [[../articles/deep-dive.md|Article]]
from:: "Start here"
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    const seg = result.lens?.segments[0];
    expect(seg?.type).toBe('article');
    expect((seg as any).fromAnchor).toBe('Start here');
    expect((seg as any).toAnchor).toBeUndefined();
  });

  it('parses article with only to:: (from start of article)', () => {
    const content = `---
id: test-id
---

#### Article
source:: [[../articles/deep-dive.md|Article]]
to:: "End here"
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    const seg = result.lens?.segments[0];
    expect(seg?.type).toBe('article');
    expect((seg as any).fromAnchor).toBeUndefined();
    expect((seg as any).toAnchor).toBe('End here');
  });

  it('parses empty article (entire article via source inheritance)', () => {
    const content = `---
id: test-id
---

#### Article
source:: [[../articles/deep-dive.md|Article]]

#### Article
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    expect(result.lens?.segments).toHaveLength(2);
    // Second article inherits source from first
    expect((result.lens?.segments[1] as any).source).toBe('[[../articles/deep-dive.md|Article]]');
    expect((result.lens?.segments[1] as any).fromAnchor).toBeUndefined();
    expect((result.lens?.segments[1] as any).toAnchor).toBeUndefined();
  });

  it('parses chat segment with title', () => {
    const content = `---
id: test-id
---

#### Chat: Final Discussion
instructions:: Discuss what you learned.
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    const chatSeg = result.lens?.segments[0];
    expect(chatSeg?.type).toBe('chat');
    expect((chatSeg as any).title).toBe('Final Discussion');
  });

  it('parses segment type case-insensitively', () => {
    const content = `---
id: test-id
---

#### Chat
instructions:: Discussion.

#### CHAT
instructions:: Another discussion.

#### chat
instructions:: Yet another.
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    expect(result.lens?.segments).toHaveLength(3);
    for (const seg of result.lens!.segments) {
      expect(seg.type).toBe('chat');
    }
  });

  it('warns about from:: field in text segment', () => {
    const content = `---
id: test-id
---

#### Text
content:: Some text.
from:: "This should not be here"
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    expect(result.errors.some(e =>
      e.message.includes('from') && e.message.toLowerCase().includes('text')
    )).toBe(true);
  });

  it('warns about to:: field in chat segment', () => {
    const content = `---
id: test-id
---

#### Chat
instructions:: Some instructions.
to:: "This should not be here"
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    expect(result.errors.some(e =>
      e.message.includes('to') && e.message.toLowerCase().includes('chat')
    )).toBe(true);
  });

  it('does not warn about from/to in article', () => {
    const content = `---
id: test-id
---

#### Article
source:: [[../articles/deep-dive.md|Article]]
from:: "The key insight"
to:: "End of section"
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    const fieldWarnings = result.errors.filter(e =>
      e.message.includes('from') && e.message.toLowerCase().includes('article')
    );
    expect(fieldWarnings).toHaveLength(0);
  });

  it('warns about empty content:: field in text segment', () => {
    const content = `---
id: test-id
---

#### Text
content::
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    expect(result.errors.some(e =>
      e.message.includes('empty content::')
    )).toBe(true);
  });

  it('warns about whitespace-only content:: field', () => {
    const content = `---
id: test-id
---

#### Text
content::
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    expect(result.errors.some(e =>
      e.message.includes('empty content::')
    )).toBe(true);
  });

  it('does not warn about content:: with actual text', () => {
    const content = `---
id: test-id
---

#### Text
content:: Actual content here.
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    const contentWarnings = result.errors.filter(e =>
      e.message.includes('empty content::')
    );
    expect(contentWarnings).toHaveLength(0);
  });

  describe('empty segment warnings', () => {
    it('warns about empty segment with no fields', () => {
      const content = `---
id: test-id
---

#### Chat
`;

      const result = parseLens(content, 'Lenses/lens1.md');

      expect(result.errors.some(e =>
        e.message.includes('Empty') || e.message.includes('missing instructions::')
      )).toBe(true);
    });

    it('does not warn about segment with fields', () => {
      const content = `---
id: test-id
---

#### Chat
instructions:: Discuss the topic.
`;

      const result = parseLens(content, 'Lenses/lens1.md');

      const emptyWarnings = result.errors.filter(e =>
        e.message.includes('Empty')
      );
      expect(emptyWarnings).toHaveLength(0);
    });
  });

  describe('lens with no segments', () => {
    it('warns about lens with no segments', () => {
      const content = `---
id: test-id
---
`;

      const result = parseLens(content, 'Lenses/lens1.md');

      expect(result.errors.some(e =>
        e.message.includes('no segments')
      )).toBe(true);
    });
  });

  describe('field value validation', () => {
    it('warns about optional:: field with non-boolean value', () => {
      const content = `---
id: test-id
---

#### Text
content:: Some text.
optional:: yes
`;

      const result = parseLens(content, 'Lenses/lens1.md');

      expect(result.errors.some(e =>
        e.message.includes('optional') && e.message.includes('boolean')
      )).toBe(true);
    });

    it('warns about hidePreviousContentFromUser:: with non-boolean value', () => {
      const content = `---
id: test-id
---

#### Chat
instructions:: Discuss.
hidePreviousContentFromUser:: yes
`;

      const result = parseLens(content, 'Lenses/lens1.md');

      expect(result.errors.some(e =>
        e.message.includes('hidePreviousContentFromUser') &&
        e.message.includes('boolean')
      )).toBe(true);
    });

    it('does not warn about boolean fields with valid values', () => {
      const content = `---
id: test-id
---

#### Chat
instructions:: Discuss.
optional:: true
hidePreviousContentFromUser:: false
`;

      const result = parseLens(content, 'Lenses/lens1.md');

      const booleanWarnings = result.errors.filter(e =>
        e.message.includes('boolean')
      );
      expect(booleanWarnings).toHaveLength(0);
    });
  });

  describe('missing required fields', () => {
    it('errors on text segment without content:: field', () => {
      const content = `---
id: test-id
---

#### Text
optional:: true
`;

      const result = parseLens(content, 'Lenses/lens1.md');

      expect(result.errors.some(e =>
        e.severity === 'error' && e.message.includes('content::')
      )).toBe(true);
    });

    it('errors on chat segment without instructions:: field', () => {
      const content = `---
id: test-id
---

#### Chat
optional:: true
`;

      const result = parseLens(content, 'Lenses/lens1.md');

      expect(result.errors.some(e =>
        e.severity === 'error' && e.message.includes('instructions::')
      )).toBe(true);
    });

    it('accepts valid segments with all required fields', () => {
      const content = `---
id: test-id
---

#### Text
content:: Some text here.

#### Chat
instructions:: Some instructions here.

#### Article
source:: [[../articles/deep-dive.md|Article]]
from:: "Start"
to:: "End"

#### Video
source:: [[../video_transcripts/video.md|Video]]
from:: 1:30
to:: 5:45
`;

      const result = parseLens(content, 'Lenses/lens1.md');

      const errors = result.errors.filter(e => e.severity === 'error');
      expect(errors).toHaveLength(0);
      expect(result.lens?.segments).toHaveLength(4);
    });
  });

  describe('unknown segment types', () => {
    it('errors on #### Quiz (unknown segment type)', () => {
      const content = `---
id: test-id
---

#### Quiz
content:: What is AI Safety?
`;

      const result = parseLens(content, 'Lenses/lens1.md');

      expect(result.errors.some(e =>
        e.severity === 'error' && e.message.includes('Unknown segment type: Quiz')
      )).toBe(true);
    });

    it('errors on #### Unknown (unknown segment type)', () => {
      const content = `---
id: test-id
---

#### Unknown
content:: What is AI Safety?
`;

      const result = parseLens(content, 'Lenses/lens1.md');

      expect(result.errors.some(e =>
        e.severity === 'error' && e.message.includes('Unknown segment type')
      )).toBe(true);
    });

    it('accepts valid segment type #### Text', () => {
      const content = `---
id: test-id
---

#### Text
content:: Some content.
`;

      const result = parseLens(content, 'Lenses/lens1.md');

      const unknownErrors = result.errors.filter(e =>
        e.message.includes('Unknown segment type')
      );
      expect(unknownErrors).toHaveLength(0);
    });

    it('accepts valid segment type #### Chat', () => {
      const content = `---
id: test-id
---

#### Chat
instructions:: Some instructions.
`;

      const result = parseLens(content, 'Lenses/lens1.md');

      const unknownErrors = result.errors.filter(e =>
        e.message.includes('Unknown segment type')
      );
      expect(unknownErrors).toHaveLength(0);
    });

    it('accepts valid segment type #### Article', () => {
      const content = `---
id: test-id
---

#### Article
source:: [[../articles/deep-dive.md|Article]]
from:: "Start"
to:: "End"
`;

      const result = parseLens(content, 'Lenses/lens1.md');

      const unknownErrors = result.errors.filter(e =>
        e.message.includes('Unknown segment type')
      );
      expect(unknownErrors).toHaveLength(0);
    });

    it('accepts valid segment type #### Video', () => {
      const content = `---
id: test-id
---

#### Video
source:: [[../video_transcripts/video.md|Video]]
from:: 1:30
to:: 5:45
`;

      const result = parseLens(content, 'Lenses/lens1.md');

      const unknownErrors = result.errors.filter(e =>
        e.message.includes('Unknown segment type')
      );
      expect(unknownErrors).toHaveLength(0);
    });

    it('handles case-insensitive matching (#### TEXT is valid)', () => {
      const content = `---
id: test-id
---

#### TEXT
content:: Some content.
`;

      const result = parseLens(content, 'Lenses/lens1.md');

      const unknownErrors = result.errors.filter(e =>
        e.message.includes('Unknown segment type')
      );
      expect(unknownErrors).toHaveLength(0);
    });
  });

  describe('frontmatter id validation', () => {
    it('errors when id is a number', () => {
      const content = `---
id: 12345
---

#### Text
content:: Some content.
`;

      const result = parseLens(content, 'Lenses/lens1.md');

      expect(result.errors.some(e =>
        e.message.includes("'id' must be a string")
      )).toBe(true);
    });

    it('errors when id is a boolean', () => {
      const content = `---
id: true
---

#### Text
content:: Some content.
`;

      const result = parseLens(content, 'Lenses/lens1.md');

      expect(result.errors.some(e =>
        e.message.includes("'id' must be a string")
      )).toBe(true);
    });
  });

  it('warns when known field uses single colon instead of :: in segment', () => {
    const content = `---
id: test-id
---

#### Text
content: Some text here
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    expect(result.errors.some(e =>
      e.message.includes("'content:'") && e.message.includes('single colon')
    )).toBe(true);
  });

  it('does NOT warn for unknown words with single colon in segment', () => {
    const content = `---
id: test-id
---

#### Text
content:: Some text mentioning Note: this is important
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    const singleColonWarnings = result.errors.filter(e =>
      e.message.includes('single colon')
    );
    expect(singleColonWarnings).toHaveLength(0);
  });

  describe('source inheritance', () => {
    it('inherits source from previous article segment', () => {
      const content = `---
id: test-id
---

#### Article
source:: [[../articles/deep-dive.md|Article]]
from:: "Start"
to:: "End"

#### Article
from:: "Later"
to:: "End of section"
`;

      const result = parseLens(content, 'Lenses/lens1.md');

      expect(result.lens?.segments).toHaveLength(2);
      expect((result.lens?.segments[1] as any).source).toBe('[[../articles/deep-dive.md|Article]]');
    });

    it('inherits source from previous video segment', () => {
      const content = `---
id: test-id
---

#### Video
source:: [[../video_transcripts/video.md|Video]]
from:: 1:30
to:: 5:45

#### Video
from:: 10:00
to:: 15:00
`;

      const result = parseLens(content, 'Lenses/lens1.md');

      expect(result.lens?.segments).toHaveLength(2);
      expect((result.lens?.segments[1] as any).source).toBe('[[../video_transcripts/video.md|Video]]');
    });

    it('errors when first article segment has no source', () => {
      const content = `---
id: test-id
---

#### Article
from:: "Start"
to:: "End"
`;

      const result = parseLens(content, 'Lenses/lens1.md');

      expect(result.errors.some(e =>
        e.message.includes('First article segment must have a source')
      )).toBe(true);
    });

    it('errors when first video segment has no source', () => {
      const content = `---
id: test-id
---

#### Video
from:: 1:30
to:: 5:45
`;

      const result = parseLens(content, 'Lenses/lens1.md');

      expect(result.errors.some(e =>
        e.message.includes('First video segment must have a source')
      )).toBe(true);
    });

    it('new source overrides inherited source', () => {
      const content = `---
id: test-id
---

#### Article
source:: [[../articles/first.md|First]]
from:: "Start"
to:: "End"

#### Article
source:: [[../articles/second.md|Second]]
from:: "Other"
to:: "End"
`;

      const result = parseLens(content, 'Lenses/lens1.md');

      expect(result.lens?.segments).toHaveLength(2);
      expect((result.lens?.segments[0] as any).source).toBe('[[../articles/first.md|First]]');
      expect((result.lens?.segments[1] as any).source).toBe('[[../articles/second.md|Second]]');
    });
  });

  describe('timestamp validation', () => {
    it('warns about invalid from:: timestamp format', () => {
      const content = `---
id: test-id
---

#### Video
source:: [[../video_transcripts/video.md|Video]]
from:: abc
to:: 5:45
`;

      const result = parseLens(content, 'Lenses/lens1.md');

      expect(result.errors.some(e =>
        e.message.includes('Invalid timestamp') && e.message.includes('from::')
      )).toBe(true);
    });

    it('warns about invalid to:: timestamp format', () => {
      const content = `---
id: test-id
---

#### Video
source:: [[../video_transcripts/video.md|Video]]
from:: 1:30
to:: not-a-time
`;

      const result = parseLens(content, 'Lenses/lens1.md');

      expect(result.errors.some(e =>
        e.message.includes('Invalid timestamp') && e.message.includes('to::')
      )).toBe(true);
    });

    it('accepts valid timestamp formats', () => {
      const content = `---
id: test-id
---

#### Video
source:: [[../video_transcripts/video.md|Video]]
from:: 1:30
to:: 1:30:00
`;

      const result = parseLens(content, 'Lenses/lens1.md');

      const timestampErrors = result.errors.filter(e =>
        e.message.includes('Invalid timestamp')
      );
      expect(timestampErrors).toHaveLength(0);
    });
  });

  it('handles capitalized boolean values in chat segment', () => {
    const content = `---
id: 550e8400-e29b-41d4-a716-446655440002
---

#### Chat
instructions:: Discuss the key concepts.
hidePreviousContentFromUser:: True
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    const chatSeg = result.lens?.segments[0];
    expect(chatSeg?.type).toBe('chat');
    expect((chatSeg as any).hidePreviousContentFromUser).toBe(true);
  });

  it('handles uppercase TRUE in optional field', () => {
    const content = `---
id: 550e8400-e29b-41d4-a716-446655440002
---

#### Text
content:: Some content here.
optional:: TRUE
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    const textSeg = result.lens?.segments[0];
    expect(textSeg?.type).toBe('text');
    expect((textSeg as any).optional).toBe(true);
  });

  it('warns about free text before first segment', () => {
    const content = `---
id: 550e8400-e29b-41d4-a716-446655440002
---
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
    expect(result.lens?.segments).toHaveLength(1);
  });

  it('does not warn about blank lines before first segment', () => {
    const content = `---
id: 550e8400-e29b-41d4-a716-446655440002
---

#### Text
content:: Actual segment content here.
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    const segmentIgnoredWarnings = result.errors.filter(e =>
      e.message.includes('before first segment')
    );
    expect(segmentIgnoredWarnings).toHaveLength(0);
  });

  describe('roleplay segment parsing', () => {
    it('parses roleplay segment with required fields', () => {
      const content = `---
id: 550e8400-e29b-41d4-a716-446655440002
---

#### Roleplay
id:: a1b2c3d4-e5f6-7890-abcd-ef1234567890
content:: You are meeting a tech CEO who is skeptical about AI safety regulations.
ai-instructions:: You are a tech CEO who believes AI regulation is unnecessary. Be dismissive but not hostile.
`;

      const result = parseLens(content, 'Lenses/lens1.md');

      expect(result.errors.filter(e => e.severity === 'error')).toHaveLength(0);
      expect(result.lens?.segments).toHaveLength(1);

      const rp = result.lens?.segments[0] as any;
      expect(rp.type).toBe('roleplay');
      expect(rp.id).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
      expect(rp.content).toContain('tech CEO');
      expect(rp.aiInstructions).toContain('dismissive');
    });

    it('parses roleplay segment with optional fields', () => {
      const content = `---
id: 550e8400-e29b-41d4-a716-446655440002
---

#### Roleplay
id:: a1b2c3d4-e5f6-7890-abcd-ef1234567890
content:: Scenario briefing.
ai-instructions:: Character instructions.
opening-message:: Hello! I hear you wanted to discuss AI safety?
assessment-instructions:: Check if the student addresses safety concerns.
optional:: true
feedback:: true
`;

      const result = parseLens(content, 'Lenses/lens1.md');

      const rp = result.lens?.segments[0] as any;
      expect(rp.openingMessage).toContain('Hello!');
      expect(rp.assessmentInstructions).toContain('safety concerns');
      expect(rp.optional).toBe(true);
      expect(rp.feedback).toBe(true);
    });

    it('reports error when roleplay segment is missing content:: field', () => {
      const content = `---
id: test-id
---

#### Roleplay
id:: a1b2c3d4-e5f6-7890-abcd-ef1234567890
ai-instructions:: Some instructions.
`;

      const result = parseLens(content, 'Lenses/lens1.md');

      expect(result.errors.some(e =>
        e.message.includes('content::')
      )).toBe(true);
    });

    it('reports error when roleplay segment is missing ai-instructions:: field', () => {
      const content = `---
id: test-id
---

#### Roleplay
id:: a1b2c3d4-e5f6-7890-abcd-ef1234567890
content:: Scenario briefing.
`;

      const result = parseLens(content, 'Lenses/lens1.md');

      expect(result.errors.some(e =>
        e.message.includes('ai-instructions::')
      )).toBe(true);
    });

    it('reports error when roleplay segment is missing id:: field', () => {
      const content = `---
id: test-id
---

#### Roleplay
content:: Scenario briefing.
ai-instructions:: Character instructions.
`;

      const result = parseLens(content, 'Lenses/lens1.md');

      expect(result.errors.some(e =>
        e.message.includes('id::')
      )).toBe(true);
    });
  });

  it('parses tldr from frontmatter', () => {
    const content = `---
id: test-id
tldr: This is a brief summary of the lens content.
---

#### Text
content:: Some content.
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    expect(result.lens?.tldr).toBe('This is a brief summary of the lens content.');
  });

  it('sets tldr to undefined when not present', () => {
    const content = `---
id: test-id
---

#### Text
content:: Some content.
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    expect(result.lens?.tldr).toBeUndefined();
  });

  it('emits error when tldr exceeds 80 words', () => {
    const longTldr = Array(81).fill('word').join(' ');
    const content = `---
id: test-id
tldr: ${longTldr}
---

#### Text
content:: Some content.
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    expect(result.errors.some(e =>
      e.message.includes('tldr exceeds 80 words')
    )).toBe(true);
  });

  it('accepts tldr at exactly 80 words', () => {
    const exactTldr = Array(80).fill('word').join(' ');
    const content = `---
id: test-id
tldr: ${exactTldr}
---

#### Text
content:: Some content.
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    const tldrErrors = result.errors.filter(e =>
      e.message.includes('tldr exceeds')
    );
    expect(tldrErrors).toHaveLength(0);
  });

  it('strips CriticMarkup from parsed content', () => {
    const content = `---
id: test-id
---

#### Text
content:: This is {++added++} text with {--deleted--} and {>>comment<<}.
`;

    const result = parseLens(content, 'Lenses/lens1.md');

    const textSeg = result.lens?.segments[0] as any;
    // Additions removed, deletions kept, comments removed
    expect(textSeg.content).toBe('This is  text with deleted and .');
  });
});

describe('stripCriticMarkup', () => {
  it('removes comments {>>...<<}', () => {
    expect(stripCriticMarkup('text {>>comment<<} more')).toBe('text  more');
  });
  it('removes additions {++...++}', () => {
    expect(stripCriticMarkup('text {++added++} more')).toBe('text  more');
  });
  it('keeps inner content for deletions {--...--}', () => {
    expect(stripCriticMarkup('text {--deleted--} more')).toBe('text deleted more');
  });
  it('keeps old text for substitutions {~~old~>new~~}', () => {
    expect(stripCriticMarkup('text {~~old~>new~~} more')).toBe('text old more');
  });
  it('keeps inner content for highlights {==...==}', () => {
    expect(stripCriticMarkup('text {==highlight==} more')).toBe('text highlight more');
  });
  it('handles all patterns combined', () => {
    const input = 'a {>>c<<} {++d++} {--e--} {~~f~>g~~} {==h==}';
    expect(stripCriticMarkup(input)).toBe('a   e f h');
  });
  it('handles multiline patterns', () => {
    expect(stripCriticMarkup('{>>line1\nline2<<}')).toBe('');
  });
  it('passes through clean content unchanged', () => {
    expect(stripCriticMarkup('clean text')).toBe('clean text');
  });
  describe('with metadata annotations', () => {
    it('removes comment with metadata', () => {
      expect(stripCriticMarkup('text {>>{@user 2024-01-01}@@comment<<} more')).toBe('text  more');
    });
    it('strips metadata from deletion, keeps inner content', () => {
      expect(stripCriticMarkup('{--{@user 2024-01-01}@@deleted--}')).toBe('deleted');
    });
    it('removes addition with metadata', () => {
      expect(stripCriticMarkup('{++{@user 2024-01-01}@@added++}')).toBe('');
    });
    it('strips metadata from substitution, keeps old text', () => {
      expect(stripCriticMarkup('{~~{@user}@@old~>new~~}')).toBe('old');
    });
    it('strips metadata from highlight, keeps inner content', () => {
      expect(stripCriticMarkup('{=={@user}@@highlight==}')).toBe('highlight');
    });
  });
});

describe('stripAuthoringMarkup', () => {
  it('trims trailing whitespace left by inline markup removal', () => {
    expect(stripAuthoringMarkup('text {++added++}\n')).toBe('text\n');
  });
  it('trims trailing whitespace on each line independently', () => {
    expect(stripAuthoringMarkup('line1 {++a++}  \nline2 {++b++}  ')).toBe('line1\nline2');
  });
});

describe('stripObsidianComments', () => {
  it('removes inline comments', () => {
    expect(stripObsidianComments('text %%comment%% more')).toBe('text  more');
  });
  it('removes block (multiline) comments', () => {
    expect(stripObsidianComments('text %%\nline1\nline2\n%% more')).toBe('text  more');
  });
  it('removes multiple comments in one string', () => {
    expect(stripObsidianComments('%%a%% text %%b%%')).toBe(' text ');
  });
  it('passes through clean content unchanged', () => {
    expect(stripObsidianComments('clean text')).toBe('clean text');
  });
});
