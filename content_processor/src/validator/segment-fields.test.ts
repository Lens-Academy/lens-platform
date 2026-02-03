// src/validator/segment-fields.test.ts
import { describe, it, expect } from 'vitest';
import { validateSegmentFields } from './segment-fields.js';

describe('validateSegmentFields', () => {
  describe('text segment', () => {
    it('allows content and optional fields', () => {
      const warnings = validateSegmentFields(
        'text',
        { content: 'Some text', optional: 'true' },
        'test.md',
        10
      );

      expect(warnings).toHaveLength(0);
    });

    it('warns about from:: in text segment', () => {
      const warnings = validateSegmentFields(
        'text',
        { content: 'Some text', from: 'Start here' },
        'test.md',
        10
      );

      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain('from');
      expect(warnings[0].message).toContain('text');
      expect(warnings[0].severity).toBe('warning');
    });

    it('warns about to:: in text segment', () => {
      const warnings = validateSegmentFields(
        'text',
        { content: 'Some text', to: 'End here' },
        'test.md',
        10
      );

      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain('to');
    });
  });

  describe('chat segment', () => {
    it('allows instructions, optional, and hide fields', () => {
      const warnings = validateSegmentFields(
        'chat',
        {
          instructions: 'Do something',
          optional: 'false',
          hidePreviousContentFromUser: 'true',
          hidePreviousContentFromTutor: 'false',
        },
        'test.md',
        10
      );

      expect(warnings).toHaveLength(0);
    });

    it('warns about from:: in chat segment', () => {
      const warnings = validateSegmentFields(
        'chat',
        { instructions: 'Do something', from: '1:00' },
        'test.md',
        10
      );

      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain('from');
      expect(warnings[0].message).toContain('chat');
    });

    it('warns about to:: in chat segment', () => {
      const warnings = validateSegmentFields(
        'chat',
        { instructions: 'Do something', to: '2:00' },
        'test.md',
        10
      );

      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain('to');
    });
  });

  describe('article-excerpt segment', () => {
    it('allows from, to, and optional fields', () => {
      const warnings = validateSegmentFields(
        'article-excerpt',
        { from: 'Start', to: 'End', optional: 'true' },
        'test.md',
        10
      );

      expect(warnings).toHaveLength(0);
    });

    it('does not warn about from/to in excerpt segment', () => {
      const warnings = validateSegmentFields(
        'article-excerpt',
        { from: 'Start', to: 'End' },
        'test.md',
        10
      );

      expect(warnings).toHaveLength(0);
    });
  });

  describe('video-excerpt segment', () => {
    it('allows from, to, and optional fields', () => {
      const warnings = validateSegmentFields(
        'video-excerpt',
        { from: '1:00', to: '5:00', optional: 'false' },
        'test.md',
        10
      );

      expect(warnings).toHaveLength(0);
    });
  });

  describe('unknown segment type', () => {
    it('returns no warnings for unknown segment type', () => {
      const warnings = validateSegmentFields(
        'unknown-type',
        { content: 'value', from: '1:00' },
        'test.md',
        10
      );

      expect(warnings).toHaveLength(0);
    });
  });

  it('includes file and line in warnings', () => {
    const warnings = validateSegmentFields(
      'text',
      { content: 'value', from: 'start' },
      'Lenses/test.md',
      42
    );

    expect(warnings[0].file).toBe('Lenses/test.md');
    expect(warnings[0].line).toBe(42);
  });
});
