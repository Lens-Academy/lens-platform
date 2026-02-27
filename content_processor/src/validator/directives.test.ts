// src/validator/directives.test.ts
import { describe, it, expect } from 'vitest';
import { validateDirectives, detectDirectivesInNonArticle } from './directives.js';
import { processContent } from '../index.js';

describe('validateDirectives', () => {
  // === Task 1: Unclosed container directive ===
  describe('unclosed container directives', () => {
    it('returns no errors for content without directives', () => {
      const body = 'Just some plain text.\n\nAnother paragraph.';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors).toHaveLength(0);
    });

    it('returns no errors for properly closed :::note', () => {
      const body = ':::note\nSome note content.\n:::\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      const unclosedErrors = errors.filter(e => e.message.includes('unclosed') || e.message.includes('Unclosed'));
      expect(unclosedErrors).toHaveLength(0);
    });

    it('returns error for :::note without closing :::', () => {
      const body = ':::note\nSome note content.\nMore content.';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors.some(e => e.severity === 'error' && /unclosed|Unclosed/.test(e.message))).toBe(true);
    });

    it('reports correct absolute line number', () => {
      const body = 'Line 0\n:::note\nContent.\n';
      const errors = validateDirectives(body, 'articles/test.md', 10);
      const unclosed = errors.find(e => /unclosed|Unclosed/.test(e.message));
      // :::note is on line index 1, so absolute = 10 + 1 = 11
      expect(unclosed?.line).toBe(11);
    });

    it('detects unclosed outer container with nested closed inner', () => {
      const body = ':::note\n:::collapse\nInner content.\n:::\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      // The inner :::collapse is closed but outer :::note is not
      expect(errors.some(e => e.severity === 'error' && /unclosed|Unclosed/.test(e.message))).toBe(true);
    });

    it('does not false-positive inside fenced code blocks', () => {
      const body = '```\n:::note\nThis is code, not a directive.\n```\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors).toHaveLength(0);
    });
  });

  // === Task 2: {open} on closing ::: ===
  describe('{open} on closing marker', () => {
    it('detects {open} on closing :::', () => {
      const body = ':::note\nContent.\n:::{open}\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors.some(e => e.severity === 'error' && e.message.includes('{open}'))).toBe(true);
    });

    it('suggests moving attribute to opening line', () => {
      const body = ':::note\nContent.\n:::{open}\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      const err = errors.find(e => e.message.includes('{open}'));
      expect(err?.suggestion).toMatch(/:::note\{open\}/);
    });

    it('reports correct line number for closing marker attribute', () => {
      const body = ':::note\nContent.\n:::{open}\n';
      const errors = validateDirectives(body, 'articles/test.md', 10);
      const err = errors.find(e => e.message.includes('{open}'));
      // :::{open} is on line index 2, absolute = 10 + 2 = 12
      expect(err?.line).toBe(12);
    });
  });

  // === Task 3: Unsupported directive names ===
  describe('unsupported directive names', () => {
    it('errors for :::warning (container)', () => {
      const body = ':::warning\nSome text.\n:::\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors.some(e => e.severity === 'error' && e.message.includes('warning'))).toBe(true);
    });

    it('errors for ::tip[text] (leaf)', () => {
      const body = '::tip[Some tip text]\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors.some(e => e.severity === 'error' && e.message.includes('tip'))).toBe(true);
    });

    it('errors for :info[text] (text/inline)', () => {
      const body = 'Some text :info[inline info] more text.\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors.some(e => e.severity === 'error' && e.message.includes('info'))).toBe(true);
    });

    it('no error for supported directives', () => {
      const body = ':::note\nContent.\n:::\n:::collapse\nContent.\n:::\n::note[text]\n:note[text]\n:collapse[text]\n::footnote[text]\n:footnote[text]\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      const unsupported = errors.filter(e => e.message.includes('not supported') || e.message.includes('Unsupported'));
      expect(unsupported).toHaveLength(0);
    });

    it('suggests supported directives', () => {
      const body = ':::warning\nContent.\n:::\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      const err = errors.find(e => e.message.includes('warning'));
      expect(err?.suggestion).toMatch(/note|collapse/);
    });
  });

  // === Task 4: Empty container ===
  describe('empty container warning', () => {
    it('warns for :::note with no content', () => {
      const body = ':::note\n:::\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors.some(e => e.severity === 'warning' && /empty|Empty/.test(e.message))).toBe(true);
    });

    it('warns for :::note with only blank lines', () => {
      const body = ':::note\n\n\n:::\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors.some(e => e.severity === 'warning' && /empty|Empty/.test(e.message))).toBe(true);
    });

    it('no warning for :::note with actual content', () => {
      const body = ':::note\nActual content.\n:::\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      const emptyWarnings = errors.filter(e => /empty|Empty/.test(e.message));
      expect(emptyWarnings).toHaveLength(0);
    });
  });

  // === Task 5: Attribute typos ===
  describe('attribute typo warnings', () => {
    it('warns for {opens}', () => {
      const body = ':::note{opens}\nContent.\n:::\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors.some(e => e.severity === 'warning' && e.suggestion?.includes('{open}'))).toBe(true);
    });

    it('warns for {Open}', () => {
      const body = ':::note{Open}\nContent.\n:::\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors.some(e => e.severity === 'warning' && e.suggestion?.includes('{open}'))).toBe(true);
    });

    it('warns for {opened}', () => {
      const body = ':note{opened}[text]\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors.some(e => e.severity === 'warning' && e.suggestion?.includes('{open}'))).toBe(true);
    });

    it('warns for {open=true}', () => {
      const body = ':::note{open=true}\nContent.\n:::\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors.some(e => e.severity === 'warning' && e.suggestion?.includes('{open}'))).toBe(true);
    });

    it('warns for {open} on note (note is always visible)', () => {
      const body = ':::note{open}\nContent.\n:::\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors.some(e => e.severity === 'warning' && e.message.includes('does not support'))).toBe(true);
    });

    it('no warning for no attribute', () => {
      const body = ':::note\nContent.\n:::\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      const typos = errors.filter(e => e.message.includes('attribute') && e.severity === 'warning');
      expect(typos).toHaveLength(0);
    });
  });

  // === Bugfix: unsupported form for directive name ===
  describe('unsupported directive form', () => {
    it('warns for ::collapse[text] (collapse does not support leaf form)', () => {
      const body = '::collapse[hidden text]\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors.some(e => e.severity === 'warning' && e.message.includes('collapse') && e.message.includes('leaf'))).toBe(true);
    });

    it('no warning for ::note[text] (note supports leaf form)', () => {
      const body = '::note[a note]\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      const formErrors = errors.filter(e => e.message.includes('leaf'));
      expect(formErrors).toHaveLength(0);
    });
  });

  // === Bugfix: tilde code fences ===
  describe('tilde code fences', () => {
    it('does not false-positive inside ~~~ fenced code blocks', () => {
      const body = '~~~\n:::note\nThis is code, not a directive.\n~~~\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors).toHaveLength(0);
    });

    it('does not false-positive inside ~~~lang fenced code blocks', () => {
      const body = '~~~markdown\n:::warning\nExample.\n~~~\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors).toHaveLength(0);
    });
  });

  // === Bugfix: empty attribute {} ===
  describe('empty attribute {}', () => {
    it('produces clear message for :::note{}', () => {
      const body = ':::note{}\nContent.\n:::\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors.some(e => e.severity === 'warning' && e.message.includes('empty'))).toBe(true);
    });
  });

  // === Bugfix: unclosed brackets in leaf/text directives ===
  describe('unclosed brackets', () => {
    it('errors for ::note[ without closing ]', () => {
      const body = '::note[This is a note with two colons\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors.some(e => e.severity === 'error' && /unclosed|Unclosed/.test(e.message) && e.message.includes('bracket'))).toBe(true);
    });

    it('no error for ::note[properly closed]', () => {
      const body = '::note[This is a proper note]\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      const bracketErrors = errors.filter(e => e.message.includes('bracket'));
      expect(bracketErrors).toHaveLength(0);
    });

    it('errors for :note[ without closing ] in text directive', () => {
      const body = 'Some text :note[unclosed bracket here\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors.some(e => e.severity === 'error' && /unclosed|Unclosed/.test(e.message) && e.message.includes('bracket'))).toBe(true);
    });

    it('correct line number for unclosed bracket', () => {
      const body = 'Line one.\n::note[unclosed\nLine three.\n';
      const errors = validateDirectives(body, 'articles/test.md', 10);
      const err = errors.find(e => e.message.includes('bracket'));
      expect(err?.line).toBe(11);
    });
  });

  // === Bugfix: near-miss directive names ===
  describe('near-miss directive names', () => {
    it('errors for :collapses[text] (typo of :collapse)', () => {
      const body = ':collapses[for him wouldn\'t be surprising or shocking]\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors.some(e => e.severity === 'error' && e.message.includes('collapses') && e.suggestion?.includes('collapse'))).toBe(true);
    });

    it('errors for ::notes[text] (typo of ::note)', () => {
      const body = '::notes[This is almost a note]\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors.some(e => e.severity === 'error' && e.suggestion?.includes('note'))).toBe(true);
    });

    it('errors for :::notes (typo of :::note)', () => {
      const body = ':::notes\nContent.\n:::\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors.some(e => e.severity === 'error' && e.suggestion?.includes('note'))).toBe(true);
    });

    it('no false positive for unrelated English text with brackets', () => {
      const body = 'The player:scores[1-0] in the first half.\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors).toHaveLength(0);
    });

    it('no false positive for markdown links with colons', () => {
      const body = 'See the [documentation](https://example.com) for details.\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors).toHaveLength(0);
    });
  });

  // === Bugfix: unrecognized attributes + post-bracket attrs on leaf directives ===
  describe('unrecognized and post-bracket attributes', () => {
    it('warns for unrecognized attribute {hello} on leaf ::note', () => {
      const body = '::note[This is a note with two colons]{hello}\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors.some(e => e.severity === 'warning' && e.message.includes('{hello}'))).toBe(true);
    });

    it('warns for unrecognized attribute {foo} on container :::note', () => {
      const body = ':::note{foo}\nContent.\n:::\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors.some(e => e.severity === 'warning' && e.message.includes('{foo}'))).toBe(true);
    });

    it('warns for unrecognized attribute {bar} on text :note', () => {
      const body = 'Some text :note[inline]{bar} more.\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors.some(e => e.severity === 'warning' && e.message.includes('{bar}'))).toBe(true);
    });

    it('warns for {opens} on leaf ::note with post-bracket attr', () => {
      const body = '::note[text]{opens}\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors.some(e => e.severity === 'warning' && e.suggestion?.includes('{open}'))).toBe(true);
    });

    it('warns for {open} on leaf ::note (note no longer supports open)', () => {
      const body = '::note[text]{open}\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors.some(e => e.severity === 'warning' && e.message.includes('does not support'))).toBe(true);
    });
  });

  // === Footnote directive ===
  describe('footnote directive', () => {
    it('no error for :footnote[text] (text form)', () => {
      const body = 'Some text :footnote[extra detail] more text.\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      const footnoteErrors = errors.filter(e => e.message.includes('footnote'));
      expect(footnoteErrors).toHaveLength(0);
    });

    it('no error for ::footnote[text] (leaf form)', () => {
      const body = '::footnote[extra detail]\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      const footnoteErrors = errors.filter(e => e.message.includes('footnote'));
      expect(footnoteErrors).toHaveLength(0);
    });

    it('errors for :::footnote (container form not supported)', () => {
      const body = ':::footnote\nSome content.\n:::\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors.some(e => e.severity === 'error' && e.message.includes('footnote') && e.message.includes('container'))).toBe(true);
    });

    it('warns for :footnote[text]{open} (footnote does not support open)', () => {
      const body = ':footnote[text]{open}\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors.some(e => e.severity === 'warning' && e.message.includes('does not support'))).toBe(true);
    });
  });

  // === Task 6: {open} on collapse ===
  describe('{open} on collapse warning', () => {
    it('warns for :::collapse{open}', () => {
      const body = ':::collapse{open}\nContent.\n:::\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors.some(e => e.severity === 'warning' && e.message.includes('does not support'))).toBe(true);
    });

    it('warns for :collapse[text]{open}', () => {
      const body = ':collapse[text]{open}\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors.some(e => e.severity === 'warning' && e.message.includes('does not support'))).toBe(true);
    });

    it('warns for :::note{open} (note no longer supports open)', () => {
      const body = ':::note{open}\nContent.\n:::\n';
      const errors = validateDirectives(body, 'articles/test.md', 5);
      expect(errors.some(e => e.severity === 'warning' && e.message.includes('does not support'))).toBe(true);
    });
  });
});

// === Task 7: Directives in non-article content ===
describe('detectDirectivesInNonArticle', () => {
  it('warns for container directive in content', () => {
    const content = ':::note\nSome content.\n:::\n';
    const errors = detectDirectivesInNonArticle(content, 'Lenses/test.md', 10);
    expect(errors.some(e => e.severity === 'warning')).toBe(true);
  });

  it('warns for inline directive in content', () => {
    const content = 'Some text :note[inline] more text.';
    const errors = detectDirectivesInNonArticle(content, 'Lenses/test.md', 10);
    expect(errors.some(e => e.severity === 'warning')).toBe(true);
  });

  it('no warning for plain text', () => {
    const content = 'Just plain text with no directives.';
    const errors = detectDirectivesInNonArticle(content, 'Lenses/test.md', 10);
    expect(errors).toHaveLength(0);
  });

  it('no false positive inside fenced code blocks', () => {
    const content = '```\n:::note\nNot a directive.\n```\n';
    const errors = detectDirectivesInNonArticle(content, 'Lenses/test.md', 10);
    expect(errors).toHaveLength(0);
  });

  it('no false positive on URLs with colons', () => {
    const content = 'Visit https://example.com for more info.';
    const errors = detectDirectivesInNonArticle(content, 'Lenses/test.md', 10);
    expect(errors).toHaveLength(0);
  });
});

// === Task 8: Integration tests via processContent ===
describe('integration: directive validation via processContent', () => {
  it('reports unclosed directive in article file', () => {
    const files = new Map([
      ['articles/broken.md', [
        '---',
        'title: Test Article',
        'author: Test',
        'source_url: https://example.com',
        '---',
        ':::note',
        'Some content without closing marker.',
      ].join('\n')],
    ]);

    const result = processContent(files);
    expect(result.errors.some(e =>
      e.file === 'articles/broken.md' &&
      /unclosed|Unclosed/.test(e.message)
    )).toBe(true);
  });

  it('no directive errors for clean article', () => {
    const files = new Map([
      ['articles/clean.md', [
        '---',
        'title: Clean Article',
        'author: Test',
        'source_url: https://example.com',
        '---',
        ':::note',
        'This is a note.',
        ':::',
        '',
        'Regular content.',
      ].join('\n')],
    ]);

    const result = processContent(files);
    const directiveErrors = result.errors.filter(e =>
      e.file === 'articles/clean.md' &&
      (e.message.includes('directive') || e.message.includes('Directive'))
    );
    expect(directiveErrors).toHaveLength(0);
  });

  it('warns about directives in lens text segment', () => {
    const files = new Map([
      ['Lenses/test-lens.md', [
        '---',
        "id: '550e8400-e29b-41d4-a716-446655440000'",
        '---',
        '### Text: Intro',
        '#### Text',
        'content:: Here is some text with :note[inline directive] in it.',
      ].join('\n')],
    ]);

    const result = processContent(files);
    expect(result.errors.some(e =>
      e.file === 'Lenses/test-lens.md' &&
      e.severity === 'warning' &&
      e.message.includes('non-article')
    )).toBe(true);
  });
});
