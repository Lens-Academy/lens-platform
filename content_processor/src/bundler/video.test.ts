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
});
