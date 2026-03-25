import { describe, it, expect } from 'vitest';
import { resolveTextLinks, populateCardModuleSlugs, resolveInlineLensModuleSlugs } from './resolve-text-links.js';
import type { Section } from '../index.js';

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

  describe('::card links', () => {
    const files = new Map<string, string>([
      ['Lenses/My Lens.md', '---\nid: aaaa-bbbb\ntitle: "My Lens Title"\ntldr: "A short summary"\n---\n#### Text\ncontent:: hello world foo bar baz'],
      ['modules/My Module.md', '---\nslug: my-module\ntitle: "My Module Title"\n---\n# Lens: Welcome'],
    ]);

    it('resolves ::card[[lens]] to HTML div with JSON metadata', () => {
      const content = '::card[[../Lenses/My Lens]]';
      const result = resolveTextLinks(content, 'modules/test.md', files);
      expect(result.content).toContain('data-lens-card=');
      const match = result.content.match(/data-lens-card='([^']+)'/);
      expect(match).not.toBeNull();
      const data = JSON.parse(match![1]);
      expect(data.contentId).toBe('aaaa-bbbb');
      expect(data.title).toBe('My Lens Title');
      expect(data.tldr).toBe('A short summary');
      expect(data.targetType).toBe('lens');
    });

    it('resolves ::card[[module]] to HTML div with module metadata', () => {
      const content = '::card[[../modules/My Module]]';
      const result = resolveTextLinks(content, 'Lenses/test.md', files);
      const match = result.content.match(/data-lens-card='([^']+)'/);
      const data = JSON.parse(match![1]);
      expect(data.targetType).toBe('module');
      expect(data.slug).toBe('my-module');
      expect(data.title).toBe('My Module Title');
    });

    it('handles mixed inline and card links', () => {
      const content = 'See [[../Lenses/My Lens|link]] and:\n::card[[../Lenses/My Lens]]';
      const result = resolveTextLinks(content, 'modules/test.md', files);
      expect(result.content).toContain('[link](lens:aaaa-bbbb)');
      expect(result.content).toContain('data-lens-card=');
    });

    it('returns error for unresolved ::card link', () => {
      const content = '::card[[../Lenses/Nonexistent]]';
      const result = resolveTextLinks(content, 'modules/test.md', files);
      expect(result.errors).toHaveLength(1);
    });
  });
});

describe('populateCardModuleSlugs', () => {
  it('populates moduleSlug in card data from contentId→moduleSlug map', () => {
    const cardData = JSON.stringify({
      contentId: 'aaaa-bbbb',
      targetType: 'lens',
      title: 'My Lens',
      tldr: 'Summary',
      moduleSlug: null,
    }).replace(/'/g, '&#39;');

    const section: Section = {
      type: 'lens',
      meta: { title: 'Host Section' },
      contentId: 'host-id',
      learningOutcomeId: null,
      learningOutcomeName: null,
      segments: [
        { type: 'text', content: `<div data-lens-card='${cardData}'></div>` },
      ],
    };

    const mapping = new Map([['aaaa-bbbb', 'target-module']]);
    populateCardModuleSlugs([section], mapping);

    const match = (section.segments[0] as { content: string }).content.match(/data-lens-card='([^']+)'/);
    const data = JSON.parse(match![1].replace(/&#39;/g, "'"));
    expect(data.moduleSlug).toBe('target-module');
  });

  it('leaves moduleSlug null when contentId not in mapping', () => {
    const cardData = JSON.stringify({
      contentId: 'unknown-id',
      targetType: 'lens',
      title: 'Unknown',
      moduleSlug: null,
    }).replace(/'/g, '&#39;');

    const section: Section = {
      type: 'lens',
      meta: { title: 'Host' },
      contentId: 'host-id',
      learningOutcomeId: null,
      learningOutcomeName: null,
      segments: [
        { type: 'text', content: `<div data-lens-card='${cardData}'></div>` },
      ],
    };

    const mapping = new Map<string, string>();
    populateCardModuleSlugs([section], mapping);

    const match = (section.segments[0] as { content: string }).content.match(/data-lens-card='([^']+)'/);
    const data = JSON.parse(match![1].replace(/&#39;/g, "'"));
    expect(data.moduleSlug).toBeNull();
  });
});

describe('resolveInlineLensModuleSlugs', () => {
  it('adds moduleSlug to inline lens links', () => {
    const section: Section = {
      type: 'lens',
      meta: { title: 'Host' },
      contentId: 'host-id',
      learningOutcomeId: null,
      learningOutcomeName: null,
      segments: [
        { type: 'text', content: 'See [My Lens](lens:aaaa-bbbb)' },
      ],
    };

    const mapping = new Map([['aaaa-bbbb', 'other-module']]);
    resolveInlineLensModuleSlugs([section], mapping);

    expect((section.segments[0] as { content: string }).content).toBe(
      'See [My Lens](lens:aaaa-bbbb@other-module)'
    );
  });

  it('leaves inline lens links unchanged when contentId not in mapping', () => {
    const section: Section = {
      type: 'lens',
      meta: { title: 'Host' },
      contentId: 'host-id',
      learningOutcomeId: null,
      learningOutcomeName: null,
      segments: [
        { type: 'text', content: 'See [My Lens](lens:unknown-id)' },
      ],
    };

    resolveInlineLensModuleSlugs([section], new Map());

    expect((section.segments[0] as { content: string }).content).toBe(
      'See [My Lens](lens:unknown-id)'
    );
  });
});
