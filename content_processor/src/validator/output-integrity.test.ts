import { describe, it, expect } from 'vitest';
import { validateOutputIntegrity } from './output-integrity.js';
import type { FlattenedModule } from '../index.js';

function makeModule(overrides: Partial<FlattenedModule> = {}): FlattenedModule {
  return {
    slug: 'test-module',
    title: 'Test Module',
    contentId: null,
    sections: [],
    ...overrides,
  };
}

describe('validateOutputIntegrity', () => {
  it('returns no errors for module with valid sections and segments', () => {
    const module = makeModule({
      sections: [{
        type: 'page',
        meta: { title: 'Intro' },
        segments: [{ type: 'text', content: 'Hello world.' }],
        contentId: null,
        learningOutcomeId: null,
        learningOutcomeName: null,
        videoId: null,
      }],
    });

    const errors = validateOutputIntegrity([module]);
    expect(errors).toHaveLength(0);
  });

  it('errors on section with zero segments', () => {
    const module = makeModule({
      sections: [{
        type: 'page',
        meta: { title: 'Empty Page' },
        segments: [],
        contentId: null,
        learningOutcomeId: null,
        learningOutcomeName: null,
        videoId: null,
      }],
    });

    const errors = validateOutputIntegrity([module]);
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe('error');
    expect(errors[0].message).toContain('Empty Page');
    expect(errors[0].message.toLowerCase()).toContain('no segments');
  });

  it('errors on text segment with empty content', () => {
    const module = makeModule({
      sections: [{
        type: 'page',
        meta: { title: 'Page' },
        segments: [{ type: 'text', content: '' }],
        contentId: null,
        learningOutcomeId: null,
        learningOutcomeName: null,
        videoId: null,
      }],
    });

    const errors = validateOutputIntegrity([module]);
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe('error');
    expect(errors[0].message.toLowerCase()).toContain('empty');
    expect(errors[0].message.toLowerCase()).toContain('text');
  });

  it('errors on text segment with whitespace-only content', () => {
    const module = makeModule({
      sections: [{
        type: 'page',
        meta: { title: 'Page' },
        segments: [{ type: 'text', content: '   \n  ' }],
        contentId: null,
        learningOutcomeId: null,
        learningOutcomeName: null,
        videoId: null,
      }],
    });

    const errors = validateOutputIntegrity([module]);
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe('error');
  });

  it('errors on article-excerpt segment with empty content', () => {
    const module = makeModule({
      sections: [{
        type: 'lens-article',
        meta: { title: 'Article' },
        segments: [{ type: 'article-excerpt', content: '' }],
        contentId: null,
        learningOutcomeId: null,
        learningOutcomeName: null,
        videoId: null,
      }],
    });

    const errors = validateOutputIntegrity([module]);
    expect(errors).toHaveLength(1);
    expect(errors[0].message.toLowerCase()).toContain('empty');
  });

  it('errors on video-excerpt segment with empty transcript', () => {
    const module = makeModule({
      sections: [{
        type: 'lens-video',
        meta: { title: 'Video' },
        segments: [{ type: 'video-excerpt', from: 0, to: 60, transcript: '' }],
        contentId: null,
        learningOutcomeId: null,
        learningOutcomeName: null,
        videoId: null,
      }],
    });

    const errors = validateOutputIntegrity([module]);
    expect(errors).toHaveLength(1);
    expect(errors[0].message.toLowerCase()).toContain('empty');
  });

  it('uses file path from slugToPath map instead of slug', () => {
    const module = makeModule({
      slug: 'demo',
      sections: [{
        type: 'page',
        meta: { title: 'Welcome' },
        segments: [],
        contentId: null,
        learningOutcomeId: null,
        learningOutcomeName: null,
        videoId: null,
      }],
    });

    const slugToPath = new Map([['demo', 'modules/software-demo.md']]);
    const errors = validateOutputIntegrity([module], slugToPath);
    expect(errors).toHaveLength(1);
    expect(errors[0].file).toBe('modules/software-demo.md');
  });

  it('falls back to slug when no slugToPath provided', () => {
    const module = makeModule({
      slug: 'demo',
      sections: [{
        type: 'page',
        meta: { title: 'Welcome' },
        segments: [],
        contentId: null,
        learningOutcomeId: null,
        learningOutcomeName: null,
        videoId: null,
      }],
    });

    const errors = validateOutputIntegrity([module]);
    expect(errors).toHaveLength(1);
    expect(errors[0].file).toBe('demo');
  });

  it('reports errors across multiple modules', () => {
    const module1 = makeModule({
      slug: 'mod-a',
      sections: [{
        type: 'page',
        meta: { title: 'Empty Section' },
        segments: [],
        contentId: null,
        learningOutcomeId: null,
        learningOutcomeName: null,
        videoId: null,
      }],
    });
    const module2 = makeModule({
      slug: 'mod-b',
      sections: [{
        type: 'page',
        meta: { title: 'Page' },
        segments: [{ type: 'text', content: '' }],
        contentId: null,
        learningOutcomeId: null,
        learningOutcomeName: null,
        videoId: null,
      }],
    });

    const errors = validateOutputIntegrity([module1, module2]);
    expect(errors).toHaveLength(2);
    expect(errors[0].file).toContain('mod-a');
    expect(errors[1].file).toContain('mod-b');
  });

  it('does not error on chat segment (no content field to check)', () => {
    const module = makeModule({
      sections: [{
        type: 'page',
        meta: { title: 'Page' },
        segments: [{ type: 'chat' }],
        contentId: null,
        learningOutcomeId: null,
        learningOutcomeName: null,
        videoId: null,
      }],
    });

    const errors = validateOutputIntegrity([module]);
    expect(errors).toHaveLength(0);
  });
});
