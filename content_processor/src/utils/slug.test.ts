import { describe, it, expect } from 'vitest';
import { fileNameToSlug } from './slug.js';

describe('fileNameToSlug', () => {
  it('converts spaces to hyphens and lowercases', () => {
    expect(fileNameToSlug('Four Background Claims')).toBe('four-background-claims');
  });

  it('strips .md extension if present', () => {
    expect(fileNameToSlug('Four Background Claims.md')).toBe('four-background-claims');
  });

  it('strips directory prefix', () => {
    expect(fileNameToSlug('Lenses/Four Background Claims.md')).toBe('four-background-claims');
  });

  it('collapses multiple hyphens', () => {
    expect(fileNameToSlug('AI - Humanity\'s Final Invention')).toBe('ai-humanitys-final-invention');
  });

  it('removes non-alphanumeric characters except hyphens', () => {
    expect(fileNameToSlug('What is (really) going on?')).toBe('what-is-really-going-on');
  });

  it('trims leading/trailing hyphens', () => {
    expect(fileNameToSlug('  --hello-- ')).toBe('hello');
  });

  it('handles single word', () => {
    expect(fileNameToSlug('intro')).toBe('intro');
  });

  it('returns fallback for pathological input', () => {
    expect(fileNameToSlug('!!!.md')).toBe('untitled');
  });
});
