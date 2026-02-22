// src/parser/wikilink.test.ts
import { describe, it, expect } from 'vitest';
import { parseWikilink, resolveWikilinkPath, findFileWithExtension, hasRelativePath, findSimilarFiles, formatSuggestion } from './wikilink';

describe('parseWikilink', () => {
  it('extracts path and display text', () => {
    const result = parseWikilink('[[../Learning Outcomes/lo1.md|My LO]]');

    expect(result?.path).toBe('../Learning Outcomes/lo1.md');
    expect(result?.display).toBe('My LO');
  });

  describe('path traversal blocking', () => {
    it('returns error with suggestion for multiple consecutive ../ at start', () => {
      const result = parseWikilink('[[../../../../etc/passwd]]');
      expect(result?.error).toBe(`Path has too many '../' segments`);
      expect(result?.correctedPath).toBe('../etc/passwd');
    });

    it('returns error with suggestion for two consecutive ../ at start', () => {
      const result = parseWikilink('[[../../etc/passwd]]');
      expect(result?.error).toBe(`Path has too many '../' segments`);
      expect(result?.correctedPath).toBe('../etc/passwd');
    });

    it('returns error for wikilinks with ../ after a path segment', () => {
      const result = parseWikilink('[[articles/../../../secrets/key]]');
      expect(result).not.toBeNull();
      expect(result?.error).toBe('Path traversal not allowed');
    });

    it('returns error for wikilinks with ../ in middle trying to escape', () => {
      const result = parseWikilink('[[foo/bar/../../../etc/passwd]]');
      expect(result).not.toBeNull();
      expect(result?.error).toBe('Path traversal not allowed');
    });

    it('returns error for wikilinks containing ..\\', () => {
      const result = parseWikilink('[[..\\..\\..\\windows\\system32]]');
      expect(result).not.toBeNull();
      expect(result?.error).toBe('Path traversal not allowed');
    });

    it('returns error for wikilinks with single ..\\', () => {
      const result = parseWikilink('[[..\\windows\\system32]]');
      expect(result).not.toBeNull();
      expect(result?.error).toBe('Path traversal not allowed');
    });

    it('returns error for wikilinks with mixed path separators ..\\/', () => {
      const result = parseWikilink('[[..\\../etc/passwd]]');
      expect(result).not.toBeNull();
      expect(result?.error).toBe('Path traversal not allowed');
    });

    it('allows single ../ for legitimate relative references', () => {
      const result = parseWikilink('[[../Lenses/my-lens.md]]');
      expect(result?.path).toBe('../Lenses/my-lens.md');
    });

    it('allows normal paths like [[Articles/my-article]]', () => {
      const result = parseWikilink('[[Articles/my-article]]');
      expect(result?.path).toBe('Articles/my-article');
    });

    it('allows paths with legitimate dots like [[file.name.with.dots]]', () => {
      const result = parseWikilink('[[file.name.with.dots]]');
      expect(result?.path).toBe('file.name.with.dots');
    });

    it('allows paths with single dot like [[./relative/path]]', () => {
      const result = parseWikilink('[[./relative/path]]');
      expect(result?.path).toBe('./relative/path');
    });

    it('allows paths with dots in filenames like [[path/to/file.test.md]]', () => {
      const result = parseWikilink('[[path/to/file.test.md]]');
      expect(result?.path).toBe('path/to/file.test.md');
    });

    it('returns error with suggestion for embed wikilinks with multiple ../', () => {
      const result = parseWikilink('![[../../../etc/passwd]]');
      expect(result?.error).toBe(`Path has too many '../' segments`);
      expect(result?.correctedPath).toBe('../etc/passwd');
      expect(result?.isEmbed).toBe(true);
    });

    it('allows embed wikilinks with single ../', () => {
      const result = parseWikilink('![[../images/diagram.png]]');
      expect(result?.path).toBe('../images/diagram.png');
      expect(result?.isEmbed).toBe(true);
    });
  });

  it('handles wikilink without display text', () => {
    const result = parseWikilink('[[path/to/file.md]]');

    expect(result?.path).toBe('path/to/file.md');
    expect(result?.display).toBeUndefined();
  });

  it('returns null for non-wikilink', () => {
    expect(parseWikilink('not a wikilink')).toBeNull();
    expect(parseWikilink('[regular](link)')).toBeNull();
  });

  it('handles embed syntax ![[path]]', () => {
    const result = parseWikilink('![[images/diagram.png]]');

    expect(result?.path).toBe('images/diagram.png');
    expect(result?.isEmbed).toBe(true);
  });

  it('handles embed with display text ![[path|alt text]]', () => {
    const result = parseWikilink('![[images/diagram.png|Architecture diagram]]');

    expect(result?.path).toBe('images/diagram.png');
    expect(result?.display).toBe('Architecture diagram');
    expect(result?.isEmbed).toBe(true);
  });

  describe('syntax validation', () => {
    it('returns error for missing closing bracket [[Article]', () => {
      const result = parseWikilink('[[Article]');

      expect(result).not.toBeNull();
      expect(result?.error).toBe('Missing closing bracket ]]');
    });

    it('returns error for missing opening bracket [Article]]', () => {
      const result = parseWikilink('[Article]]');

      expect(result).not.toBeNull();
      expect(result?.error).toBe('Missing opening bracket [[');
    });

    it('returns error for empty wikilink [[]]', () => {
      const result = parseWikilink('[[]]');

      expect(result).not.toBeNull();
      expect(result?.error).toBe('Empty wikilink');
    });

    it('returns error for whitespace-only wikilink [[  ]]', () => {
      const result = parseWikilink('[[  ]]');

      expect(result).not.toBeNull();
      expect(result?.error).toBe('Empty wikilink');
    });

    it('returns error for empty embed wikilink ![[]]', () => {
      const result = parseWikilink('![[]]');

      expect(result).not.toBeNull();
      expect(result?.error).toBe('Empty wikilink');
    });

    it('valid wikilinks still work after validation changes', () => {
      const result = parseWikilink('[[Valid/path/to/file.md]]');

      expect(result?.path).toBe('Valid/path/to/file.md');
      expect(result?.error).toBeUndefined();
    });
  });
});

describe('resolveWikilinkPath', () => {
  it('resolves relative path from source file', () => {
    const resolved = resolveWikilinkPath(
      '../Learning Outcomes/lo1.md',
      'modules/intro.md'
    );

    expect(resolved).toBe('Learning Outcomes/lo1.md');
  });

  it('handles nested paths', () => {
    const resolved = resolveWikilinkPath(
      '../Lenses/category/lens1.md',
      'Learning Outcomes/lo1.md'
    );

    expect(resolved).toBe('Lenses/category/lens1.md');
  });

  it('resolves path without .md extension', () => {
    const resolved = resolveWikilinkPath(
      '../modules/introduction',
      'courses/default.md'
    );

    expect(resolved).toBe('modules/introduction');
  });
});

describe('hasRelativePath', () => {
  it('returns true for paths with slash', () => {
    expect(hasRelativePath('../Lenses/lens1.md')).toBe(true);
    expect(hasRelativePath('path/to/file.md')).toBe(true);
    expect(hasRelativePath('./file.md')).toBe(true);
  });

  it('returns false for paths without slash', () => {
    expect(hasRelativePath('filename.md')).toBe(false);
    expect(hasRelativePath('just-a-name')).toBe(false);
  });
});

describe('findFileWithExtension', () => {
  it('finds file with exact path', () => {
    const files = new Map([
      ['modules/intro.md', 'content'],
    ]);

    const result = findFileWithExtension('modules/intro.md', files);
    expect(result).toBe('modules/intro.md');
  });

  it('finds file by adding .md extension', () => {
    const files = new Map([
      ['modules/intro.md', 'content'],
    ]);

    const result = findFileWithExtension('modules/intro', files);
    expect(result).toBe('modules/intro.md');
  });

  it('returns null when file not found', () => {
    const files = new Map([
      ['modules/other.md', 'content'],
    ]);

    const result = findFileWithExtension('modules/intro', files);
    expect(result).toBeNull();
  });

  it('prefers exact match over .md extension', () => {
    const files = new Map([
      ['modules/intro', 'exact content'],
      ['modules/intro.md', 'md content'],
    ]);

    const result = findFileWithExtension('modules/intro', files);
    expect(result).toBe('modules/intro');
  });
});

describe('findSimilarFiles', () => {
  it('finds files with similar names (typo)', () => {
    const files = new Map([
      ['Lenses/simulators.md', 'content'],
      ['other/unrelated.md', 'content'],
    ]);

    const result = findSimilarFiles('Lenses/simulatrs.md', files, 'Lenses');
    expect(result).toContain('Lenses/simulators.md');
  });

  it('prioritizes files in expected directory', () => {
    const files = new Map([
      ['Lenses/my-lens.md', 'content'],
      ['articles/my-lens.md', 'content'],
    ]);

    const result = findSimilarFiles('Lenses/my-lens.md', files, 'Lenses');
    expect(result[0]).toBe('Lenses/my-lens.md');
  });

  it('only returns matches from expected directory when specified', () => {
    const files = new Map([
      ['articles/article.md', 'content'],
      ['Lenses/article.md', 'content'],
    ]);

    // Looking for an article, should only suggest files from articles/
    const result = findSimilarFiles('articles/articel.md', files, 'articles');
    expect(result).toContain('articles/article.md');
    expect(result).not.toContain('Lenses/article.md');
  });

  it('returns empty array when no similar files in expected directory', () => {
    const files = new Map([
      ['Lenses/lens1.md', 'content'],
    ]);

    // Looking for an article but only Lenses exist
    const result = findSimilarFiles('articles/article.md', files, 'articles');
    expect(result).toEqual([]);
  });

  it('handles nested directories in expected path', () => {
    const files = new Map([
      ['content/Lenses/my-lens.md', 'content'],
    ]);

    const result = findSimilarFiles('content/Lenses/my-lns.md', files, 'Lenses');
    expect(result).toContain('content/Lenses/my-lens.md');
  });

  it('limits results to 3 matches', () => {
    const files = new Map([
      ['Lenses/file1.md', 'content'],
      ['Lenses/file2.md', 'content'],
      ['Lenses/file3.md', 'content'],
      ['Lenses/file4.md', 'content'],
    ]);

    const result = findSimilarFiles('Lenses/file.md', files, 'Lenses');
    expect(result.length).toBeLessThanOrEqual(3);
  });
});

describe('formatSuggestion', () => {
  it('formats single file suggestion with relative path from source file', () => {
    // Source file is in Learning Outcomes/, suggested file is in Lenses/
    const result = formatSuggestion(['Lenses/my-lens.md'], 'Learning Outcomes/lo1.md');
    expect(result).toBe("Did you mean '../Lenses/my-lens.md'?");
  });

  it('formats multiple file suggestions with relative paths', () => {
    const result = formatSuggestion(['articles/file1.md', 'articles/file2.md'], 'Lenses/lens1.md');
    expect(result).toBe("Did you mean one of: '../articles/file1.md', '../articles/file2.md'?");
  });

  it('returns undefined for empty array', () => {
    const result = formatSuggestion([], 'some/file.md');
    expect(result).toBeUndefined();
  });
});
