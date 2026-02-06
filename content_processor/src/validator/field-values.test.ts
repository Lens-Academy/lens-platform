// src/validator/field-values.test.ts
import { describe, it, expect } from 'vitest';
import { validateFieldValues, validateSlugFormat } from './field-values.js';

describe('validateSlugFormat', () => {
  describe('valid slugs', () => {
    it('accepts lowercase letters only', () => {
      const result = validateSlugFormat('basics', 'test.md', 1);
      expect(result).toBeNull();
    });

    it('accepts lowercase letters with hyphens', () => {
      const result = validateSlugFormat('my-valid-slug', 'test.md', 1);
      expect(result).toBeNull();
    });

    it('accepts lowercase letters with numbers', () => {
      const result = validateSlugFormat('intro-101', 'test.md', 1);
      expect(result).toBeNull();
    });

    it('accepts numbers only', () => {
      const result = validateSlugFormat('123', 'test.md', 1);
      expect(result).toBeNull();
    });
  });

  describe('invalid slugs', () => {
    it('rejects slugs with special characters', () => {
      const result = validateSlugFormat('!!!invalid@@@', 'test.md', 1);
      expect(result).not.toBeNull();
      expect(result!.severity).toBe('error');
      expect(result!.message).toContain('slug');
    });

    it('rejects slugs with spaces', () => {
      const result = validateSlugFormat('my slug', 'test.md', 1);
      expect(result).not.toBeNull();
      expect(result!.message).toContain('slug');
    });

    it('rejects slugs starting with hyphen', () => {
      const result = validateSlugFormat('-invalid', 'test.md', 1);
      expect(result).not.toBeNull();
      expect(result!.message).toContain('hyphen');
    });

    it('rejects slugs ending with hyphen', () => {
      const result = validateSlugFormat('invalid-', 'test.md', 1);
      expect(result).not.toBeNull();
      expect(result!.message).toContain('hyphen');
    });

    it('rejects uppercase letters', () => {
      const result = validateSlugFormat('UPPERCASE', 'test.md', 1);
      expect(result).not.toBeNull();
      expect(result!.message).toContain('uppercase');
    });

    it('rejects mixed case', () => {
      const result = validateSlugFormat('MySlug', 'test.md', 1);
      expect(result).not.toBeNull();
      expect(result!.message).toContain('uppercase');
    });

    it('provides suggestion for uppercase slugs', () => {
      const result = validateSlugFormat('UPPERCASE', 'test.md', 1);
      expect(result!.suggestion).toContain('uppercase');
    });
  });
});

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
