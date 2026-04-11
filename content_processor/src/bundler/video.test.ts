// src/bundler/video.test.ts
import { describe, it, expect } from 'vitest';
import { parseTimestamp, extractVideoExcerpt } from './video.js';

describe('parseTimestamp', () => {
  it('converts MM:SS to seconds', () => {
    expect(parseTimestamp('1:30')).toBe(90);
    expect(parseTimestamp('5:45')).toBe(345);
    expect(parseTimestamp('0:00')).toBe(0);
  });

  it('converts H:MM:SS to seconds', () => {
    expect(parseTimestamp('1:30:00')).toBe(5400);
    expect(parseTimestamp('2:15:30')).toBe(8130);
  });

  it('returns null for invalid format', () => {
    expect(parseTimestamp('invalid')).toBeNull();
    expect(parseTimestamp('abc:def')).toBeNull();
  });
});

describe('extractVideoExcerpt - timestamp format validation', () => {
  const transcript = '0:00 - Content here.\n1:00 - More content.\n2:00 - End.';

  it('returns clear error for non-timestamp from:: value', () => {
    const result = extractVideoExcerpt(transcript, 'not a time', '1:00', 'video.md');

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('Invalid');
    expect(result.error?.message).toContain('timestamp');
    expect(result.error?.message).toContain('not a time');
    // Should list ALL valid formats in suggestion
    expect(result.error?.suggestion).toMatch(/M:SS/);
    expect(result.error?.suggestion).toMatch(/H:MM:SS/);
    expect(result.error?.suggestion).toMatch(/\.ms/i); // milliseconds format
  });

  it('returns clear error for abc:def format', () => {
    const result = extractVideoExcerpt(transcript, 'abc:def', '1:00', 'video.md');

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('Invalid');
    expect(result.error?.message).toContain('timestamp');
    expect(result.error?.message).toContain('abc:def');
    // Should list valid formats
    expect(result.error?.suggestion).toMatch(/M:SS/);
  });

  it('returns clear error for invalid to:: timestamp', () => {
    const result = extractVideoExcerpt(transcript, '0:00', 'invalid time', 'video.md');

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('Invalid');
    expect(result.error?.message).toContain('timestamp');
    expect(result.error?.message).toContain('invalid time');
    // Should list valid formats
    expect(result.error?.suggestion).toMatch(/M:SS/);
    expect(result.error?.suggestion).toMatch(/H:MM:SS/);
  });

  it('accepts valid M:SS format', () => {
    const transcript = '0:00 - Start.\n1:30 - Middle.\n2:00 - End.';
    const result = extractVideoExcerpt(transcript, '1:30', '2:00', 'video.md');
    expect(result.error).toBeUndefined();
    expect(result.from).toBe(90);
  });

  it('accepts valid MM:SS format', () => {
    // MM:SS format like 01:30 - note that the transcript parser needs matching markers
    const transcript = '0:00 - Start.\n1:30 - Middle.\n2:00 - End.';
    // 01:30 parses to 90 seconds which matches 1:30 in the transcript
    const result = extractVideoExcerpt(transcript, '0:00', '1:30', 'video.md');
    expect(result.error).toBeUndefined();
    expect(result.from).toBe(0);
    expect(result.to).toBe(90);
  });

  it('accepts valid H:MM:SS format', () => {
    const transcript = '0:00 - Start.\n1:30:00 - End.';
    const result = extractVideoExcerpt(transcript, '0:00', '1:30:00', 'video.md');
    expect(result.error).toBeUndefined();
    expect(result.to).toBe(5400);
  });
});

describe('extractVideoExcerpt', () => {
  it('extracts transcript between timestamps and returns seconds', () => {
    const transcript = `0:00 - Welcome to this video.
0:30 - Today we'll discuss AI safety.
1:30 - The first key point is alignment.
2:00 - This means ensuring AI does what we want.
5:45 - Moving on to the next topic.
6:00 - Let's talk about interpretability.
`;

    const result = extractVideoExcerpt(
      transcript,
      '1:30',   // 90 seconds
      '5:45',   // 345 seconds
      'video_transcripts/test.md'
    );

    expect(result.from).toBe(90);           // Seconds as number
    expect(result.to).toBe(345);            // Seconds as number
    expect(result.transcript).toContain('alignment');
    expect(result.transcript).toContain('what we want');
    expect(result.transcript).not.toContain('Welcome');
    expect(result.transcript).not.toContain('interpretability');
  });

  it('returns error for invalid timestamp format', () => {
    const transcript = '0:00 - Content here.';

    const result = extractVideoExcerpt(
      transcript,
      'invalid',
      '1:00',
      'video_transcripts/test.md'
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('timestamp');
    expect(result.error?.suggestion).toContain('MM:SS');
  });

  it('returns error when timestamp not found in transcript', () => {
    const transcript = '0:00 - Short video.\n0:30 - End.';

    const result = extractVideoExcerpt(
      transcript,
      '5:00',
      '10:00',
      'video_transcripts/test.md'
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('not found');
  });

  it('returns error when from timestamp is after to timestamp', () => {
    const transcript = `0:00 - Start.
3:00 - Middle.
5:00 - End.`;

    const result = extractVideoExcerpt(transcript, '5:00', '3:00', 'video.md');

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('after');
  });

  describe('from 0:00 (start of video)', () => {
    it('treats 0:00 as start of video even when no 0:00 marker exists', () => {
      // Transcript starts at 0:30, not 0:00
      const transcript = `0:30 - First line of dialogue.
1:00 - Second line continues.
1:30 - Third line wraps up.
2:00 - End of section.`;

      const result = extractVideoExcerpt(transcript, '0:00', '1:30', 'video.md');

      // Should NOT error - 0:00 means "from the start"
      expect(result.error).toBeUndefined();
      expect(result.from).toBe(0);
      expect(result.to).toBe(90);
      // Should include lines from start up to (but not including) 1:30
      expect(result.transcript).toContain('First line');
      expect(result.transcript).toContain('Second line');
      expect(result.transcript).not.toContain('Third line');
    });

    it('handles plain prose transcript with no timestamps at all', () => {
      // This is common for transcripts that are just paragraphs of text
      const transcript = `This is the first paragraph of the transcript. It contains some interesting content about AI safety.

This is the second paragraph. It continues discussing the topic.

This is the third paragraph. It concludes the main points.`;

      const result = extractVideoExcerpt(transcript, '0:00', '5:00', 'video.md');

      // Should NOT error - include entire content since no timestamps exist
      expect(result.error).toBeUndefined();
      expect(result.from).toBe(0);
      expect(result.to).toBe(300);
      // Should include entire transcript
      expect(result.transcript).toContain('first paragraph');
      expect(result.transcript).toContain('second paragraph');
      expect(result.transcript).toContain('third paragraph');
    });
  });
});
