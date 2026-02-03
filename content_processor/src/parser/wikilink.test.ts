// src/parser/wikilink.test.ts
import { describe, it, expect } from 'vitest';
import { parseWikilink, resolveWikilinkPath, findFileWithExtension } from './wikilink';

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

  it('resolves path without .md extension', () => {
    const resolved = resolveWikilinkPath(
      '../modules/introduction',
      'courses/default.md'
    );

    expect(resolved).toBe('modules/introduction');
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
