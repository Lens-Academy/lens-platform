// src/validator/field-values.test.ts
import { describe, it, expect } from 'vitest';
import { validateFieldValues } from './field-values.js';

describe('validateFieldValues', () => {
  describe('boolean field validation', () => {
    it('warns about optional:: field with non-boolean value', () => {
      const warnings = validateFieldValues(
        { optional: 'yes' },
        'test.md',
        10
      );

      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain("'optional'");
      expect(warnings[0].suggestion).toContain("'true' or 'false'");
      expect(warnings[0].severity).toBe('warning');
    });

    it('warns about hidePreviousContentFromUser:: with non-boolean value', () => {
      const warnings = validateFieldValues(
        { hidePreviousContentFromUser: '1' },
        'test.md',
        10
      );

      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain("'hidePreviousContentFromUser'");
    });

    it('warns about hidePreviousContentFromTutor:: with non-boolean value', () => {
      const warnings = validateFieldValues(
        { hidePreviousContentFromTutor: 'yes' },
        'test.md',
        10
      );

      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain("'hidePreviousContentFromTutor'");
    });

    it('warns about multiple boolean fields with non-boolean values', () => {
      const warnings = validateFieldValues(
        { optional: 'yes', hidePreviousContentFromUser: '1' },
        'test.md',
        10
      );

      expect(warnings).toHaveLength(2);
    });

    it('does not warn about boolean field with "true"', () => {
      const warnings = validateFieldValues(
        { optional: 'true' },
        'test.md',
        10
      );

      expect(warnings).toHaveLength(0);
    });

    it('does not warn about boolean field with "false"', () => {
      const warnings = validateFieldValues(
        { optional: 'false' },
        'test.md',
        10
      );

      expect(warnings).toHaveLength(0);
    });

    it('accepts case-insensitive boolean values (True, FALSE)', () => {
      const warnings = validateFieldValues(
        { optional: 'True', hidePreviousContentFromUser: 'FALSE' },
        'test.md',
        10
      );

      expect(warnings).toHaveLength(0);
    });

    it('does not warn about non-boolean fields with any value', () => {
      const warnings = validateFieldValues(
        { content: 'some text', instructions: 'do something', source: '[[file.md]]' },
        'test.md',
        10
      );

      expect(warnings).toHaveLength(0);
    });
  });
});
