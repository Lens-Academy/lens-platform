// src/parser/wikilink.test.ts
import { describe, it, expect } from 'vitest';
import { parseWikilink, resolveWikilinkPath } from './wikilink';

describe('parseWikilink', () => {
  it('extracts path and display text', () => {
    const result = parseWikilink('[[../Learning Outcomes/lo1.md|My LO]]');

    expect(result?.path).toBe('../Learning Outcomes/lo1.md');
    expect(result?.display).toBe('My LO');
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
});
