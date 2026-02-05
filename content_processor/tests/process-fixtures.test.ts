// tests/process-fixtures.test.ts
import { describe, it, expect } from 'vitest';
import { listFixtures, loadFixture } from './fixture-loader.js';
import { processContent } from '../src/index.js';

describe('source path validation', () => {
  it('errors when source:: wikilink has no relative path (no slash)', () => {
    // source:: [[just-filename.md]] should error - we always expect relative paths
    const files = new Map([
      ['Learning Outcomes/lo1.md', `---
id: 550e8400-e29b-41d4-a716-446655440001
---

## Lens:
source:: [[lens1.md|Lens 1]]
`],
    ]);

    const result = processContent(files);

    // Should have an error about missing relative path
    const pathError = result.errors.find(
      e => e.message.includes('relative') || e.message.includes('/')
    );
    expect(pathError).toBeDefined();
    expect(pathError?.severity).toBe('error');
  });

  it('accepts source:: wikilink with relative path', () => {
    // source:: [[../Lenses/lens1.md]] is valid
    const files = new Map([
      ['Learning Outcomes/lo1.md', `---
id: 550e8400-e29b-41d4-a716-446655440001
---

## Lens:
source:: [[../Lenses/lens1.md|Lens 1]]
`],
      ['Lenses/lens1.md', `---
id: 550e8400-e29b-41d4-a716-446655440002
---

### Text: Content

#### Text
content:: Some content.
`],
    ]);

    const result = processContent(files);

    // Should NOT have an error about relative path
    const pathError = result.errors.find(
      e => e.message.includes('relative') || e.message.includes('/')
    );
    expect(pathError).toBeUndefined();
  });

  it('errors when lens source:: has no relative path', () => {
    // Lens files can also have source:: for articles/videos
    const files = new Map([
      ['Lenses/lens1.md', `---
id: 550e8400-e29b-41d4-a716-446655440001
---

### Article: Test Article
source:: [[article.md|Article]]

#### Article-excerpt
from:: "Start"
to:: "End"
`],
    ]);

    const result = processContent(files);

    // Should have an error about missing relative path
    const pathError = result.errors.find(
      e => e.message.includes('relative') || e.message.includes('/')
    );
    expect(pathError).toBeDefined();
    expect(pathError?.severity).toBe('error');
  });
});

describe('field typo detection', () => {
  it('warns about likely typos in lens segment fields', () => {
    // 'contnet' is a likely typo for 'content'
    const files = new Map([
      ['modules/test.md', `---
slug: test
title: Test
---

# Uncategorized:
## Lens:
source:: [[../Lenses/lens1.md|Lens 1]]
`],
      ['Lenses/lens1.md', `---
id: 550e8400-e29b-41d4-a716-446655440001
---

### Text: Content

#### Text
contnet:: This has a typo in the field name.
`],
    ]);

    const result = processContent(files);

    // Should have a warning about the typo
    const typoWarning = result.errors.find(
      e => e.severity === 'warning' && e.message.includes('contnet')
    );
    expect(typoWarning).toBeDefined();
    expect(typoWarning?.suggestion).toContain('content');
  });

  it('warns about typos in learning outcome fields', () => {
    // 'souce' is a likely typo for 'source'
    const files = new Map([
      ['Learning Outcomes/lo1.md', `---
id: 550e8400-e29b-41d4-a716-446655440001
---

## Lens:
souce:: [[../Lenses/lens1.md|Lens 1]]
`],
    ]);

    const result = processContent(files);

    // Should have a warning about the typo
    const typoWarning = result.errors.find(
      e => e.severity === 'warning' && e.message.includes('souce')
    );
    expect(typoWarning).toBeDefined();
    expect(typoWarning?.suggestion).toContain('source');
  });
});

describe('fixture processing', () => {
  it('processes all valid fixtures without errors', async () => {
    const fixtures = await listFixtures();
    const validFixtures = fixtures.filter(f => f.startsWith('valid/'));

    for (const fixtureName of validFixtures) {
      const fixture = await loadFixture(fixtureName);
      const result = processContent(fixture.input);

      expect(result.errors, `Fixture ${fixtureName} should have no errors`).toEqual([]);
    }
  });

  it('matches expected output for each valid fixture', async () => {
    const fixtures = await listFixtures();
    const validFixtures = fixtures.filter(f => f.startsWith('valid/'));

    for (const fixtureName of validFixtures) {
      const fixture = await loadFixture(fixtureName);
      const result = processContent(fixture.input);

      expect(result, `Fixture ${fixtureName}`).toEqual(fixture.expected);
    }
  });

  it('produces expected errors for invalid fixtures', async () => {
    const fixtures = await listFixtures();
    const invalidFixtures = fixtures.filter(f => f.startsWith('invalid/'));

    for (const fixtureName of invalidFixtures) {
      const fixture = await loadFixture(fixtureName);
      const result = processContent(fixture.input);

      expect(result.errors.length, `Fixture ${fixtureName} should have errors`).toBeGreaterThan(0);
      expect(result.errors, `Fixture ${fixtureName}`).toEqual(fixture.expected.errors);
    }
  });
});
