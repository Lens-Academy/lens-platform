import { describe, it, expect } from 'vitest';
import { resolveTextLinks } from './resolve-text-links.js';

describe('resolveTextLinks', () => {
  const files = new Map<string, string>([
    ['Lenses/My Lens.md', '---\nid: aaaa-bbbb\ntitle: "My Lens Title"\ntldr: "A short summary"\n---\n#### Text\ncontent:: hello'],
    ['modules/My Module.md', '---\nslug: my-module\ntitle: "My Module Title"\n---\n# Lens: Welcome'],
  ]);

  it('resolves [[lens]] to markdown link with lens: scheme', () => {
    const content = 'See [[../Lenses/My Lens]]';
    const result = resolveTextLinks(content, 'modules/test.md', files);
    expect(result.content).toBe('See [My Lens Title](lens:aaaa-bbbb)');
    expect(result.errors).toHaveLength(0);
  });

  it('resolves [[lens|display]] with pipe alias', () => {
    const content = 'Check [[../Lenses/My Lens|this lens]]';
    const result = resolveTextLinks(content, 'modules/test.md', files);
    expect(result.content).toBe('Check [this lens](lens:aaaa-bbbb)');
  });

  it('resolves [[module]] to module: scheme', () => {
    const content = 'See [[../modules/My Module]]';
    const result = resolveTextLinks(content, 'Lenses/test.md', files);
    expect(result.content).toBe('See [My Module Title](module:my-module)');
  });

  it('resolves [[module|display]] with pipe alias', () => {
    const content = 'Read [[../modules/My Module|Module 1]]';
    const result = resolveTextLinks(content, 'Lenses/test.md', files);
    expect(result.content).toBe('Read [Module 1](module:my-module)');
  });

  it('returns error for unresolved wikilink', () => {
    const content = 'See [[../Lenses/Nonexistent]]';
    const result = resolveTextLinks(content, 'modules/test.md', files);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('not found');
    expect(result.content).toBe('See [[../Lenses/Nonexistent]]');
  });

  it('handles multiple wikilinks in one string', () => {
    const content = 'See [[../Lenses/My Lens]] and [[../modules/My Module]]';
    const result = resolveTextLinks(content, 'modules/test.md', files);
    expect(result.content).toBe('See [My Lens Title](lens:aaaa-bbbb) and [My Module Title](module:my-module)');
  });

  it('leaves content without wikilinks unchanged', () => {
    const content = 'No links here, just **bold** text.';
    const result = resolveTextLinks(content, 'modules/test.md', files);
    expect(result.content).toBe(content);
  });

  it('uses filename as fallback display text when title is missing', () => {
    const filesNoTitle = new Map<string, string>([
      ['Lenses/Untitled.md', '---\nid: cccc-dddd\n---\n#### Text\ncontent:: hello'],
    ]);
    const content = 'See [[../Lenses/Untitled]]';
    const result = resolveTextLinks(content, 'modules/test.md', filesNoTitle);
    expect(result.content).toBe('See [Untitled](lens:cccc-dddd)');
  });
});
