// tests/fixtures.test.ts
import { describe, it, expect } from 'vitest';
import { loadFixture, listFixtures } from './fixture-loader.js';

describe('fixture loader', () => {
  it('lists available fixtures', async () => {
    const fixtures = await listFixtures();
    expect(fixtures.length).toBeGreaterThan(0);
    expect(fixtures).toContain('valid/minimal-module');
  });

  it('loads fixture input files', async () => {
    const fixture = await loadFixture('valid/minimal-module');
    expect(fixture.input.size).toBeGreaterThan(0);
    expect(fixture.input.has('modules/intro.md')).toBe(true);
  });

  it('loads expected output', async () => {
    const fixture = await loadFixture('valid/minimal-module');
    expect(fixture.expected).toBeDefined();
    expect(fixture.expected.modules).toBeDefined();
  });
});
