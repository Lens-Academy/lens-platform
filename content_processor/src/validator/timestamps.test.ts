// src/validator/timestamps.test.ts
import { describe, it, expect } from 'vitest';
import { validateTimestamps } from './timestamps.js';

describe('validateTimestamps', () => {
  it('returns no errors for valid timestamps array', () => {
    const content = JSON.stringify([
      { text: 'Humans', start: '0:00.40' },
      { text: 'rule', start: '0:00.88' },
      { text: 'Earth', start: '0:01.32' },
    ]);

    const errors = validateTimestamps(content, 'video_transcripts/test.timestamps.json');
    expect(errors).toHaveLength(0);
  });

  it('reports error for invalid JSON', () => {
    const content = '{ not valid json';

    const errors = validateTimestamps(content, 'video_transcripts/test.timestamps.json');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].severity).toBe('error');
    expect(errors[0].message.toLowerCase()).toContain('json');
  });

  it('reports error when not an array', () => {
    const content = JSON.stringify({ text: 'hello', start: '0:00' });

    const errors = validateTimestamps(content, 'video_transcripts/test.timestamps.json');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message.toLowerCase()).toContain('array');
  });

  it('reports error for entry missing text field', () => {
    const content = JSON.stringify([
      { start: '0:00.40' },
    ]);

    const errors = validateTimestamps(content, 'video_transcripts/test.timestamps.json');
    expect(errors.some(e => e.message.toLowerCase().includes('text'))).toBe(true);
  });

  it('reports error for entry missing start field', () => {
    const content = JSON.stringify([
      { text: 'Hello' },
    ]);

    const errors = validateTimestamps(content, 'video_transcripts/test.timestamps.json');
    expect(errors.some(e => e.message.toLowerCase().includes('start'))).toBe(true);
  });

  it('reports error for invalid timestamp format in start', () => {
    const content = JSON.stringify([
      { text: 'Hello', start: 'not-a-timestamp' },
    ]);

    const errors = validateTimestamps(content, 'video_transcripts/test.timestamps.json');
    expect(errors.some(e => e.message.toLowerCase().includes('timestamp'))).toBe(true);
    expect(errors[0].severity).toBe('error');
  });

  it('reports warning for non-monotonic timestamps', () => {
    const content = JSON.stringify([
      { text: 'First', start: '0:05.00' },
      { text: 'Second', start: '0:03.00' },
      { text: 'Third', start: '0:07.00' },
    ]);

    const errors = validateTimestamps(content, 'video_transcripts/test.timestamps.json');
    expect(errors.some(e =>
      e.severity === 'warning' && e.message.toLowerCase().includes('monotonic')
    )).toBe(true);
  });

  it('reports warning for empty array', () => {
    const content = JSON.stringify([]);

    const errors = validateTimestamps(content, 'video_transcripts/test.timestamps.json');
    expect(errors.some(e => e.severity === 'warning')).toBe(true);
  });
});

// GAP 18: Numeric start values should be caught
describe('validateTimestamps - numeric start field', () => {
  it('reports error when start field is a number instead of string', () => {
    const content = JSON.stringify([
      { text: 'Hello', start: 0.4 },
      { text: 'World', start: 0.88 },
    ]);

    const errors = validateTimestamps(content, 'video_transcripts/test.timestamps.json');
    expect(errors.some(e =>
      e.severity === 'error' &&
      e.message.includes('Entry 0') &&
      e.message.includes('string')
    )).toBe(true);
  });
});
