// tests/golden-master.test.ts
import { describe, it, expect } from 'vitest';
import { loadFixture } from './fixture-loader.js';
import { processContent } from '../src/index.js';

describe('golden master - Python compatibility', () => {
  it('matches Python output for actual-content fixture', async () => {
    const fixture = await loadFixture('golden/actual-content');
    const result = processContent(fixture.input);

    // Deep equality check against Python-generated expected.json
    expect(result).toEqual(fixture.expected);
  });

  it('matches Python output for software-demo fixture', async () => {
    const fixture = await loadFixture('golden/software-demo');
    const result = processContent(fixture.input);

    expect(result).toEqual(fixture.expected);
  });
});
